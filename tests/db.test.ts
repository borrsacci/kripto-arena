// Veritabanı entegrasyon testleri: gerçek Postgres üzerinde (Supabase auth taklidiyle)
// para, yetki, kaldıraç, likidasyon, limit emir ve başarım kurallarını uçtan uca dener.
// Uzlaştırma (settle) da burada sahte piyasa verisiyle, gerçek SQL fonksiyonlarına karşı çalıştırılır.
// Çalıştırmak için: PGTEST_HOST=/tmp PGTEST_PORT=55432 npm test
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Candle } from '../supabase/functions/_shared/engine.ts';
import type { Market } from '../supabase/functions/_shared/market.ts';
import { settle, type Store } from '../supabase/functions/_shared/settle.ts';

const HOST = process.env.PGTEST_HOST;
const d = HOST ? describe : describe.skip;

let admin: pg.Client;
let dbName = '';

async function connect(db: string) {
  const c = new pg.Client({ host: HOST, port: Number(process.env.PGTEST_PORT ?? 5432), user: 'postgres', database: db });
  await c.connect();
  return c;
}

async function as<T = any>(uid: string | 'service' | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await admin.query('begin');
  try {
    if (uid === 'service') {
      await admin.query(`set local role service_role`);
    } else if (uid) {
      await admin.query(`set local role authenticated`);
      await admin.query(`select set_config('request.jwt.claim.sub',$1,true)`, [uid]);
    } else {
      await admin.query(`set local role anon`);
    }
    const r = await admin.query(sql, params);
    await admin.query('commit');
    return r.rows;
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
}

async function signup(username: string, display: string) {
  const id = randomUUID();
  await admin.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)`, [id, `${username}@users.kripto.app`, { username, display_name: display }]);
  return id;
}

const one = async <T = any>(sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0] as T;
const bal = async (uid: string) => Number((await one('select balance from profiles where id=$1', [uid])).balance);
const prof = async (uid: string) => one('select * from profiles where id=$1', [uid]);
const achs = async (uid: string) => (await admin.query('select code from achievements where user_id=$1 order by code', [uid])).rows.map((r) => r.code);
const expectErr = (p: Promise<unknown>, msg: RegExp) => expect(p).rejects.toThrow(msg);

const open = (u: string, sym: string, side: string, lev: number, margin: number, price: number, tp: number | null = null, sl: number | null = null) =>
  as('service', 'select * from svc_open_position($1,$2,$3,$4,$5,$6,$7,$8)', [u, sym, side, lev, margin, price, tp, sl]).then((r) => r[0]);
const close = (pos: string, price: number, fraction = 1, user: string | null = null, reason = 'manual') =>
  as('service', 'select svc_close_position($1,$2,$3,$4,now(),$5) as r', [pos, price, reason, fraction, user]).then((r) => r[0].r);

/** Veritabanına bağlı depo (sunucudaki supabase-js deposunun aynısı, aynı SQL fonksiyonlarıyla) */
const store: Store = {
  openPositions: async (u) =>
    as('service', `select id,user_id,symbol,side,liq_price::float8 as liq_price,tp::float8 as tp,sl::float8 as sl,checked_until from positions where status='open' and ($1::uuid is null or user_id=$1)`, [u ?? null])
      .then((rs) => rs.map((r) => ({ ...r, checked_until: r.checked_until.toISOString() }))),
  openOrders: async (u) =>
    as('service', `select id,user_id,symbol,side,price::float8 as price,checked_until from orders where status='open' and ($1::uuid is null or user_id=$1)`, [u ?? null])
      .then((rs) => rs.map((r) => ({ ...r, checked_until: r.checked_until.toISOString() }))),
  fillOrder: async (id, price, at, checked) => {
    const r = (await as('service', 'select * from svc_fill_order($1,$2,$3,$4)', [id, price, at, checked]))[0];
    return r?.id ? { ...r, liq_price: Number(r.liq_price), tp: r.tp && Number(r.tp), sl: r.sl && Number(r.sl), checked_until: r.checked_until.toISOString() } : null;
  },
  closePosition: async (id, price, reason, at) => {
    await as('service', 'select svc_close_position($1,$2,$3,1,$4)', [id, price, reason, at]);
  },
  markChecked: async (items) => {
    await as('service', 'select svc_mark_checked($1)', [JSON.stringify(items)]);
  },
};

/** Sahte piyasa: her coin için verilen saniyelik mum dizisi */
function fakeMarket(series: Record<string, Candle[]>): Market {
  return {
    price: async (s) => series[s].at(-1)!.c,
    prices: async (ss) => Object.fromEntries(ss.map((s) => [s, series[s].at(-1)!.c])),
    candlesSince: async (s, from) => (series[s] ?? []).filter((c) => c.t + c.ms > from),
  };
}
const candlesFrom = (start: number, path: [number, number, number, number][]): Candle[] =>
  path.map(([o, h, l, c], i) => ({ t: start + i * 1000, ms: 1000, o, h, l, c }));
/** Pozisyonun kontrol zamanını geçmişe çeker (mumlar o andan sonra gelmiş gibi) */
const rewind = async (table: 'positions' | 'orders', id: string, ms: number) =>
  (await one(`update ${table} set checked_until = $2 where id=$1 returning checked_until`, [id, new Date(ms)])).checked_until;

let A: string, B: string, C: string;

d('veritabanı kuralları', () => {
  beforeAll(async () => {
    admin = await connect('postgres');
    dbName = `t_${Date.now()}`;
    await admin.query(`create database ${dbName}`);
    await admin.end();
    admin = await connect(dbName);
    await admin.query(readFileSync('tests/db/supabase_stub.sql', 'utf8'));
    for (const f of readdirSync('supabase/migrations').sort()) await admin.query(readFileSync(`supabase/migrations/${f}`, 'utf8'));
  });
  afterAll(async () => {
    await admin?.end();
    const c = await connect('postgres');
    await c.query(`drop database if exists ${dbName}`);
    await c.end();
  });

  it('kayıt: ilk hesap admin, herkes 10.000 $ ile başlar', async () => {
    A = await signup('okan', 'Okan');
    B = await signup('caner', 'Caner');
    C = await signup('burak', 'Burak');
    expect(await one('select is_admin, status, balance::float, deposits::float from profiles where id=$1', [A]))
      .toEqual({ is_admin: true, status: 'active', balance: 10000, deposits: 10000 });
    expect((await prof(B)).is_admin).toBe(false);
    expect(await bal(B)).toBe(10000);
    expect(await as(null, `select username_available('okan') as a`)).toEqual([{ a: false }]);
  });

  it('yetki: kullanıcı fiyat veremez, tablolara yazamaz, başkasının hareketlerini göremez', async () => {
    await expectErr(as(B, `select svc_open_position($1,'BTC','long',10,100,1)`, [B]), /permission denied/);
    await expectErr(as(B, `select svc_close_position($1,1,'manual')`, [randomUUID()]), /permission denied/);
    await expectErr(as(B, `update profiles set balance = 1e9 where id=$1`, [B]), /permission denied/);
    await expectErr(as(B, `insert into achievements (user_id, code) values ($1,'lev_100')`, [B]), /permission denied/);
    await expectErr(as(B, `select admin_adjust_balance($1, 5000, null)`, [B]), /sadece admin/);
    await expectErr(as(null, `select * from profiles`), /permission denied/);
    expect(await as(B, `select user_id from transactions`)).toEqual([{ user_id: B }]);
    expect((await as(B, `select id from profiles`)).length).toBe(3); // sıralama için herkes görünür
    await expectErr(as(B, `select * from app_config`), /permission denied/);
  });

  let P1: any;
  it('piyasa emriyle long: marjin + komisyon düşer, likidasyon fiyatı doğru', async () => {
    P1 = await open(B, 'BTC', 'long', 10, 1000, 50000);
    expect(Number(P1.liq_price)).toBeCloseTo(45250);
    expect(Number(P1.qty)).toBeCloseTo(0.2);
    expect(Number(P1.open_fee)).toBe(5);
    expect(await bal(B)).toBe(8995);
    expect(await achs(B)).toEqual(['first_trade', 'lev_10']);
    await expectErr(open(B, 'BTC', 'long', 126, 100, 50000), /125x/);
    await expectErr(open(B, 'PEPE', 'long', 50, 100, 0.00001), /25x/);
    await expectErr(open(B, 'BTC', 'long', 10, 5, 50000), /En az 10/);
    await expectErr(open(B, 'BTC', 'long', 10, 9000, 50000), /Bakiye yetersiz/);
    await expectErr(open(B, 'XYZ', 'long', 10, 100, 1), /coin/);
  });

  it('kârla kapatma: ödeme, net kâr, ROE, istatistik ve başarımlar', async () => {
    const r = await close(P1.id, 55000, 1, B);
    expect(r.payout).toBeCloseTo(1994.5);
    expect(r.pnl).toBeCloseTo(989.5);
    expect(r.position.roe).toBeCloseTo(1);
    expect(await bal(B)).toBeCloseTo(10989.5);
    const p = await prof(B);
    expect([p.trades, p.wins, p.streak, Number(p.realized_pnl)]).toEqual([1, 1, 1, 989.5]);
    expect(Number(p.volume)).toBeCloseTo(10000 + 11000);
    // anında kârla kapatıldığı için "Tetikçi" de gelir
    expect(await achs(B)).toEqual(['first_trade', 'first_win', 'lev_10', 'roe_100', 'scalper']);
    expect(p.xp).toBe(50 + 30 + 50 + 100 + 60 + 5 + 10 + 10); // başarımlar + işlem XP'si
    await expectErr(close(P1.id, 56000, 1, B), /zaten kapanmış/);
  });

  it('başkasının pozisyonu kapatılamaz', async () => {
    const p = await open(C, 'ETH', 'short', 5, 2000, 3000);
    await expectErr(close(p.id, 2900, 1, B), /bulunamadı/);
    // kısmi kapanış: yarısı kapanır, kalan yarı açık kalır
    const r = await close(p.id, 2900, 0.5, C);
    expect(r.position.status).toBe('closed');
    expect(r.position.parent_id).toBe(p.id);
    expect(r.payout).toBeCloseTo(1000 + 166.6667 - 2.4167, 3);
    expect(r.pnl).toBeCloseTo(r.payout - 1000 - 2.5, 3);
    const rest = await one('select status, margin::float, qty::float, open_fee::float from positions where id=$1', [p.id]);
    expect(rest).toMatchObject({ status: 'open', margin: 1000, open_fee: 2.5 });
    expect(rest.qty).toBeCloseTo(10000 / 3000 / 2);
    expect(await achs(C)).toContain('first_short');
    await close(p.id, 2950, 1, C);
  });

  it('elle kapatırken fiyat likidasyonu geçmişse likide sayılır', async () => {
    const p = await open(C, 'SOL', 'long', 50, 500, 100);
    const before = await bal(C);
    const r = await close(p.id, 97, 1, C);
    expect(r.position.status).toBe('liquidated');
    expect(r.payout).toBe(0);
    expect(r.position.roe).toBe(-1);
    expect(await bal(C)).toBe(before);
    const pr = await prof(C);
    expect(pr.liquidations).toBe(1);
    expect(pr.streak).toBe(0);
    expect(pr.liq_pending).toBe(true);
    expect(await achs(C)).toEqual(expect.arrayContaining(['liquidated', 'lev_50']));
  });

  it('uzlaştırma: mumlarla likidasyon, TP ve SL (uygulama kapalıyken bile)', async () => {
    const t0 = Date.parse('2026-11-20T10:00:00Z');
    const liq = await open(A, 'ETH', 'long', 20, 1000, 3000); // liq = 2865
    const tp = await open(A, 'BTC', 'short', 10, 1000, 60000, 57000, 62000);
    const sl = await open(A, 'SOL', 'long', 5, 1000, 100, 120, 95);
    for (const p of [liq, tp, sl]) await rewind('positions', p.id, t0);
    const market = fakeMarket({
      ETH: candlesFrom(t0, [[3000, 3010, 2990, 3000], [3000, 3000, 2860, 2870], [2870, 3100, 2870, 3090]]),
      BTC: candlesFrom(t0, [[60000, 60100, 59000, 59100], [59100, 59200, 56900, 57100]]),
      SOL: candlesFrom(t0, [[100, 101, 99, 100], [100, 100, 94, 94.5]]),
    });
    const r = await settle(store, market, { now: t0 + 10_000 });
    expect(r).toMatchObject({ closed: 3, failed: [] });
    const rows = Object.fromEntries((await admin.query('select id, status, close_reason, close_price::float, closed_at from positions where id = any($1)', [[liq.id, tp.id, sl.id]])).rows.map((x) => [x.id, x]));
    expect(rows[liq.id]).toMatchObject({ status: 'liquidated', close_reason: 'liq', close_price: 2865 });
    expect(rows[liq.id].closed_at.getTime()).toBe(t0 + 1000); // tetiğin gerçekleştiği an
    expect(rows[tp.id]).toMatchObject({ status: 'closed', close_reason: 'tp', close_price: 57000 });
    expect(rows[sl.id]).toMatchObject({ status: 'closed', close_reason: 'sl', close_price: 95 });
    expect(await achs(A)).toEqual(expect.arrayContaining(['tp_hit', 'sl_hit', 'liquidated']));
    // tekrar çalıştırmak bir şey değiştirmez
    expect(await settle(store, market, { now: t0 + 10_000 })).toMatchObject({ closed: 0, filled: 0 });
  });

  it('limit emir: marjin ayrılır, fiyat gelince pozisyon açılır, sonra TP ile kapanır', async () => {
    const t0 = Date.parse('2026-11-21T10:00:00Z');
    const b0 = await bal(B);
    const o = (await as('service', `select * from svc_place_order($1,'SOL','long',10,1000,90,99,null)`, [B]))[0];
    expect(Number(o.fee)).toBeCloseTo(2);
    expect(await bal(B)).toBeCloseTo(b0 - 1002);
    await rewind('orders', o.id, t0);
    const market = fakeMarket({ SOL: candlesFrom(t0, [[100, 100, 95, 96], [96, 96, 89.5, 90], [90, 99.5, 90, 99]]) });
    const r = await settle(store, market, { now: t0 + 5000 });
    expect(r).toMatchObject({ filled: 1, closed: 1 });
    const pos = await one('select * from positions where order_id=$1', [o.id]);
    expect(Number(pos.entry_price)).toBe(90);
    expect(pos.opened_at.getTime()).toBe(t0 + 1000);
    expect(pos.close_reason).toBe('tp');
    expect(Number(pos.open_fee)).toBeCloseTo(2);
    expect((await one('select status from orders where id=$1', [o.id])).status).toBe('filled');
    expect(await achs(B)).toContain('limit_fill');
    // iptal: ayrılan para geri gelir
    const o2 = (await as('service', `select * from svc_place_order($1,'ETH','short',5,500,4000)`, [B]))[0];
    const b1 = await bal(B);
    await as(B, 'select cancel_order($1)', [o2.id]);
    expect(await bal(B)).toBeCloseTo(b1 + 500 + 0.5);
    await expectErr(as(B, 'select cancel_order($1)', [o2.id]), /iptal edildi/);
    await expectErr(as(C, 'select cancel_order($1)', [o.id]), /bulunamadı/);
  });

  it('likidasyondan sonraki ilk kârlı işlem "Küllerinden" verir', async () => {
    expect((await prof(C)).liq_pending).toBe(true);
    const p = await open(C, 'DOGE', 'long', 2, 100, 0.2);
    await close(p.id, 0.25, 1, C);
    expect(await achs(C)).toContain('comeback');
    expect((await prof(C)).liq_pending).toBe(false);
  });

  it('hedge ve 5 farklı coin başarımları', async () => {
    await open(C, 'XRP', 'long', 3, 100, 1);
    await open(C, 'XRP', 'short', 3, 100, 1);
    expect(await achs(C)).toContain('hedge');
    expect(await achs(C)).not.toContain('coins_5'); // ETH, SOL, DOGE, XRP
    await open(C, 'ADA', 'long', 2, 50, 1);
    expect(await achs(C)).toContain('coins_5');
  });

  it('işlem XP\'si günlük 400 ile sınırlı; 50 $ altı işlemlere XP yok', async () => {
    const before = (await prof(A)).xp;
    const p = await open(A, 'BTC', 'long', 1, 40, 50000);
    await close(p.id, 50000);
    expect((await prof(A)).xp).toBe(before);
    await admin.query(`update profiles set xp_today = 395, xp_day = (now() at time zone 'Europe/Istanbul')::date where id=$1`, [A]);
    const q = await open(A, 'BTC', 'long', 1, 100, 50000);
    await close(q.id, 50000);
    expect((await prof(A)).xp).toBe(before + 5);
  });

  it('günlük ödül ve seri', async () => {
    const r = (await as(B, 'select claim_daily() as r'))[0].r;
    expect(r).toEqual({ xp: 20, streak: 1 });
    await expectErr(as(B, 'select claim_daily()'), /zaten/);
    await admin.query(`update profiles set last_daily = (now() at time zone 'Europe/Istanbul')::date - 1, daily_streak = 6 where id=$1`, [B]);
    expect((await as(B, 'select claim_daily() as r'))[0].r).toEqual({ xp: 50, streak: 7 });
    expect(await achs(B)).toContain('daily_7');
  });

  it('kurtarma paketi: sadece bakiye bittiyse, açık işlem yokken, günde bir', async () => {
    await expectErr(as(B, 'select claim_bailout()'), /500 \$ altına/);
    // C'nin açık pozisyonları var
    await admin.query(`update profiles set balance = 100 where id=$1`, [C]);
    await expectErr(as(C, 'select claim_bailout()'), /açık pozisyon/);
    await admin.query(`update positions set status='closed', closed_at=now() where user_id=$1 and status='open'`, [C]);
    const dep = Number((await prof(C)).deposits);
    expect(Number((await as(C, 'select claim_bailout() as b'))[0].b)).toBe(5100);
    expect(Number((await prof(C)).deposits)).toBe(dep + 5000);
    await admin.query(`update profiles set balance = 100 where id=$1`, [C]);
    await expectErr(as(C, 'select claim_bailout()'), /24 saatte/);
  });

  it('admin: bakiye ekleme sermayeye sayılır, hesabı kapatılan işlem yapamaz', async () => {
    const dep = Number((await prof(B)).deposits);
    await as(A, `select admin_adjust_balance($1, 2500, 'ödül')`, [B]);
    expect(Number((await prof(B)).deposits)).toBe(dep + 2500);
    await expectErr(as(A, `select admin_adjust_balance($1, -1e9, null)`, [B]), /eksiye/);
    expect((await as(A, `select admin_grant_all(100, null) as n`))[0].n).toBe(3);
    await as(A, `select admin_set_status($1, 'disabled')`, [C]);
    await expectErr(open(C, 'BTC', 'long', 2, 100, 50000), /kapalı/);
    await expectErr(as(C, 'select claim_daily()'), /kapalı/);
    await as(A, `select admin_set_status($1, 'active')`, [C]);
    await as(A, `select admin_set_coin('DOGE', false)`);
    await expectErr(open(C, 'DOGE', 'long', 2, 100, 0.2), /işleme kapalı/);
  });

  it('dönemlik sıralama ve varlık kaydı', async () => {
    const rows = await as(B, `select user_id, pnl::float, trades from period_pnl('2026-01-01')`);
    const b = rows.find((r) => r.user_id === B)!;
    expect(b.trades).toBe(2); // BTC long + SOL limit/TP (iptal edilen emir sayılmaz)
    await as('service', `select svc_snapshot(date_trunc('hour', now()), $1)`, [JSON.stringify([{ user_id: B, equity: 12345.678 }])]);
    expect(Number((await one('select equity from equity_snapshots where user_id=$1', [B])).equity)).toBeCloseTo(12345.678);
  });

  it('bildirim anahtarları: sadece fonksiyonla kaydedilir, telefon hesap değiştirirse anahtar taşınır', async () => {
    const tok = 'fcm-token-'.padEnd(60, 'x');
    await as(B, 'select register_push_token($1)', [tok]);
    expect((await one('select user_id from push_tokens where token=$1', [tok])).user_id).toBe(B);
    await as(C, 'select register_push_token($1)', [tok]);
    expect((await one('select user_id from push_tokens where token=$1', [tok])).user_id).toBe(C);
    await expectErr(as(B, 'select * from push_tokens'), /permission denied/);
    await as(B, 'select unregister_push_token($1)', [tok]); // başkasının anahtarını silemez
    expect((await one('select count(*)::int as n from push_tokens')).n).toBe(1);
    await as(C, 'select set_push_enabled(false)');
    expect((await prof(C)).push_enabled).toBe(false);
    expect((await as('service', 'select token from push_tokens where user_id=$1', [C])).length).toBe(1);
  });

  it('para korunumu: bakiye = hareketlerin toplamı', async () => {
    // (C'nin bakiyesi testte elle değiştirildiği için A ve B kontrol edilir)
    const r = await admin.query(`select p.id, p.balance::numeric = coalesce(sum(t.amount),0) as ok from profiles p left join transactions t on t.user_id = p.id where p.id = any($1) group by p.id`, [[A, B]]);
    expect(r.rows).toHaveLength(2);
    for (const x of r.rows) expect(x.ok).toBe(true);
  });
});
