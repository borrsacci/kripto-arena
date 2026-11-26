import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '../supabase/functions/_shared/achievements.ts';
import { COINS } from '../supabase/functions/_shared/coins.ts';
import {
  type Candle, closeValue, levelFor, levelProgress, liqPrice, priceForRoe, preview, roe, scanOrder, scanPosition,
  feeDiscount, feesFor, tierFor, validateTpSl, xpForLevel,
} from '../supabase/functions/_shared/engine.ts';

const sec = (t: number, o: number, h: number, l: number, c: number): Candle => ({ t: t * 1000, ms: 1000, o, h, l, c });

describe('kaldıraç formülleri', () => {
  it('likidasyon fiyatı', () => {
    expect(liqPrice('long', 100, 10)).toBeCloseTo(90.5);
    expect(liqPrice('short', 100, 10)).toBeCloseTo(109.5);
    expect(liqPrice('long', 100, 100)).toBeCloseTo(99.5);
    expect(liqPrice('long', 100, 1)).toBeCloseTo(0.5);
  });

  it('likidasyon fiyatında marjinin neredeyse tamamı gider', () => {
    const p = preview('long', 1000, 20, 50000);
    expect(p.notional).toBe(20000);
    expect(p.fee).toBeCloseTo(10);
    const v = closeValue('long', p.qty, 50000, 1000, p.liq, 0);
    expect(v).toBeCloseTo(1000 * 20 * 0.005); // kalan bakım marjini
  });

  it('ROE ve ROE→fiyat dönüşümü tutarlı', () => {
    expect(roe('long', 100, 110, 10)).toBeCloseTo(1);
    expect(roe('short', 100, 110, 10)).toBeCloseTo(-1);
    expect(priceForRoe('short', 100, 10, 0.5)).toBeCloseTo(95);
    expect(roe('short', 100, priceForRoe('short', 100, 10, 0.5), 10)).toBeCloseTo(0.5);
  });

  it('TP/SL doğrulama', () => {
    expect(validateTpSl('long', 100, 90, 110, 95)).toBeNull();
    expect(validateTpSl('long', 100, 90, 99, null)).toMatch(/üstünde/);
    expect(validateTpSl('long', 100, 90, null, 89)).toMatch(/likidasyon/);
    expect(validateTpSl('short', 100, 110, 90, 105)).toBeNull();
    expect(validateTpSl('short', 100, 110, null, 99)).toMatch(/üstünde/);
  });
});

describe('mum taraması', () => {
  const base = { checked_until: 10_000, tp: null, sl: null };

  it('kontrol anından önceki mumlar dikkate alınmaz', () => {
    const cs = [sec(5, 100, 100, 80, 90), sec(10, 100, 101, 99, 100), sec(11, 100, 100, 95, 96)];
    expect(scanPosition({ ...base, side: 'long', liq_price: 90 }, cs)).toBeNull();
    expect(scanPosition({ ...base, side: 'long', liq_price: 96 }, cs)).toEqual({ reason: 'liq', price: 96, t: 11_000 });
  });

  it('SL likidasyondan önce gelirse SL fiyatından kapanır', () => {
    const cs = [sec(10, 100, 100, 85, 86)];
    expect(scanPosition({ ...base, side: 'long', liq_price: 90, sl: 95 }, cs)).toEqual({ reason: 'sl', price: 95, t: 10_000 });
    // SL likidasyonun ötesindeyse anlamsızdır: likidasyon olur
    expect(scanPosition({ ...base, side: 'long', liq_price: 90, sl: 88 }, cs)).toMatchObject({ reason: 'liq', price: 90 });
  });

  it('fiyat boşlukla SL\'nin ötesinde açılırsa açılış fiyatından kapanır', () => {
    const cs = [sec(10, 93, 94, 92, 93)];
    expect(scanPosition({ ...base, side: 'long', liq_price: 90, sl: 95 }, cs)).toEqual({ reason: 'sl', price: 93, t: 10_000 });
  });

  it('TP: short için fiyat aşağı inince', () => {
    const cs = [sec(10, 100, 101, 99, 100), sec(11, 100, 100, 94, 95)];
    expect(scanPosition({ ...base, side: 'short', liq_price: 110, tp: 95 }, cs)).toEqual({ reason: 'tp', price: 95, t: 11_000 });
  });

  it('TP ve SL aynı mumda: mumun rengine göre sıra', () => {
    const green = [sec(10, 100, 112, 94, 111)]; // önce dip
    const red = [sec(10, 100, 112, 94, 95)]; // önce tepe
    const p = { ...base, side: 'long' as const, liq_price: 80, tp: 110, sl: 95 };
    expect(scanPosition(p, green)?.reason).toBe('sl');
    expect(scanPosition(p, red)?.reason).toBe('tp');
    const s = { ...base, side: 'short' as const, liq_price: 120, tp: 95, sl: 110 };
    expect(scanPosition(s, green)?.reason).toBe('tp');
    expect(scanPosition(s, red)?.reason).toBe('sl');
  });

  it('limit emir dolumu', () => {
    const cs = [sec(10, 100, 101, 99, 100), sec(11, 100, 100, 97, 98)];
    expect(scanOrder({ side: 'long', price: 98, checked_until: 10_000 }, cs)).toEqual({ price: 98, t: 11_000, end: 12_000 });
    expect(scanOrder({ side: 'short', price: 100.5, checked_until: 10_000 }, cs)).toEqual({ price: 100.5, t: 10_000, end: 11_000 });
    // boşlukla açılış: daha iyi fiyattan dolar
    expect(scanOrder({ side: 'long', price: 99, checked_until: 0 }, [sec(10, 97, 98, 96, 97)])).toMatchObject({ price: 97 });
  });
});

describe('seviye ve lig', () => {
  it('XP eşikleri', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(99)).toBe(1);
    expect(levelFor(100)).toBe(2);
    expect(levelFor(4500)).toBe(10);
    expect(levelFor(4499)).toBe(9);
    for (let l = 1; l < 80; l++) expect(levelFor(xpForLevel(l))).toBe(l);
    expect(levelProgress(200).frac).toBeCloseTo(0.5);
    expect(tierFor(1).name).toBe('Çaylak');
    expect(tierFor(17).name).toBe('Altın');
    expect(tierFor(70).name).toBe('Efsane');
  });
});

describe('seviye indirimi', () => {
  it('her seviye %1, en fazla %40', () => {
    expect(feeDiscount(1)).toBe(0);
    expect(feeDiscount(10)).toBeCloseTo(0.09);
    expect(feeDiscount(41)).toBeCloseTo(0.4);
    expect(feeDiscount(80)).toBeCloseTo(0.4);
    expect(feesFor(4500).taker).toBeCloseTo(0.0005 * 0.91);
    expect(feesFor(0).maker).toBeCloseTo(0.0002);
  });
});

describe('arayüz ve veritabanı tanımları aynı', () => {
  const sql = readFileSync('supabase/migrations/20261125200000_init.sql', 'utf8');
  it('başarım XP değerleri', () => {
    const block = sql.split('insert into public.achievement_defs')[1].split(';')[0];
    const pairs = [...block.matchAll(/\('(\w+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])]);
    expect(Object.fromEntries(pairs)).toEqual(Object.fromEntries(ACHIEVEMENTS.map((x) => [x.code, x.xp])));
    // her başarımın SQL'de bir kazanılma koşulu olmalı
    for (const x of ACHIEVEMENTS) expect(sql.match(new RegExp(`'${x.code}'`, 'g'))!.length, x.code).toBeGreaterThanOrEqual(2);
  });
  it('coinler ve kaldıraç sınırları', () => {
    const block = sql.split('insert into public.coins')[1].split(';')[0];
    const pairs = [...block.matchAll(/\('(\w+)', (\d+), \d+\)/g)].map((m) => [m[1], Number(m[2])]);
    expect(pairs).toEqual(COINS.map((c) => [c.symbol, c.maxLev]));
  });
});
