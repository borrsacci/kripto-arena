// Zamanlayıcı (pg_cron, her 30 sn): herkesin açık pozisyon ve emirlerini mum verisiyle tarar,
// saatte bir herkesin toplam varlığını kaydeder (profil grafiği için).
import { feesFor, positionValue, type Side } from '../_shared/engine.ts';
import { cors, HttpError, json } from '../_shared/http.ts';
import { createMarket } from '../_shared/market.ts';
import { settle } from '../_shared/settle.ts';
import { ensureTickUrl, rpc, store, svc, tickSecret } from '../_lib/server.ts';

const market = createMarket();

async function snapshot() {
  const hour = new Date();
  hour.setUTCMinutes(0, 0, 0);
  const key = hour.toISOString();
  const { data: last } = await svc.from('app_config').select('value').eq('key', 'last_snapshot').maybeSingle();
  if (last?.value === key) return false;

  const [{ data: profiles }, { data: positions }, { data: orders }] = await Promise.all([
    svc.from('profiles').select('id,balance,xp').eq('status', 'active'),
    svc.from('positions').select('user_id,symbol,side,qty,entry_price,margin,liq_price').eq('status', 'open'),
    svc.from('orders').select('user_id,margin,fee').eq('status', 'open'),
  ]);
  const symbols = [...new Set((positions ?? []).map((p) => p.symbol as string))];
  const prices = symbols.length ? await market.prices(symbols) : {};
  if (symbols.some((s) => !(prices[s] > 0))) return false; // eksik fiyatla yanlış kayıt yapma

  const eq = new Map<string, number>();
  for (const p of profiles ?? []) eq.set(p.id, Number(p.balance));
  for (const o of orders ?? []) eq.set(o.user_id, (eq.get(o.user_id) ?? 0) + Number(o.margin) + Number(o.fee));
  const xp = new Map((profiles ?? []).map((p) => [p.id, Number(p.xp)]));
  for (const p of positions ?? []) {
    const fee = feesFor(xp.get(p.user_id) ?? 0).taker;
    const v = positionValue({ side: p.side as Side, qty: +p.qty, entry_price: +p.entry_price, margin: +p.margin, liq_price: +p.liq_price }, prices[p.symbol], fee);
    eq.set(p.user_id, (eq.get(p.user_id) ?? 0) + v);
  }
  const rows = [...eq].filter(([id]) => (profiles ?? []).some((p) => p.id === id)).map(([user_id, equity]) => ({ user_id, equity }));
  await rpc('svc_snapshot', { p_at: key, p_rows: rows });
  await svc.from('app_config').upsert({ key: 'last_snapshot', value: key });
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const secret = await tickSecret();
    if (!secret || req.headers.get('x-tick-secret') !== secret) throw new HttpError(403, 'Yetkisiz');
    ensureTickUrl().catch(() => {});
    const r = await settle(store, market);
    const snap = await snapshot().catch((e) => String(e));
    return json({ ...r, snapshot: snap });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
