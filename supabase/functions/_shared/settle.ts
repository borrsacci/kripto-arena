// Uzlaştırma: açık pozisyon ve limit emirleri, son kontrolden bu yana gelen mumlarla tarar;
// dolan emirleri pozisyona çevirir, TP / SL / likidasyona değen pozisyonları kapatır.
// Hem zamanlayıcı (her 30 sn, herkes için) hem de her kullanıcı işleminden önce (o kullanıcı için) çalışır.
import { type Candle, scanOrder, scanPosition, type Side } from './engine.ts';
import type { Market } from './market.ts';

export interface OpenPos {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  liq_price: number;
  tp: number | null;
  sl: number | null;
  checked_until: string;
}
export interface OpenOrder {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  price: number;
  checked_until: string;
}

export interface Store {
  openPositions(userId?: string): Promise<OpenPos[]>;
  openOrders(userId?: string): Promise<OpenOrder[]>;
  fillOrder(id: string, price: number, at: Date, checked: Date): Promise<OpenPos | null>;
  closePosition(id: string, price: number, reason: 'tp' | 'sl' | 'liq', at: Date): Promise<void>;
  markChecked(items: { k: 'p' | 'o'; id: string; t: string }[]): Promise<void>;
}

export interface SettleResult {
  filled: number;
  closed: number;
  /** piyasa verisi alınamayan coinler (bunlarda işlem yapılmamalı) */
  failed: string[];
}

/** Kontrol zamanını en az bu kadar ilerletmeden kaydetmeye gerek yok (gereksiz yazma ve canlı güncelleme olmasın) */
const MARK_EVERY = 10 * 60_000;

export async function settle(store: Store, market: Market, opts: { userId?: string; symbols?: string[]; now?: number } = {}): Promise<SettleResult> {
  const now = opts.now ?? Date.now();
  let [positions, orders] = await Promise.all([store.openPositions(opts.userId), store.openOrders(opts.userId)]);
  if (opts.symbols) {
    positions = positions.filter((p) => opts.symbols!.includes(p.symbol));
    orders = orders.filter((o) => opts.symbols!.includes(o.symbol));
  }
  const symbols = [...new Set([...positions.map((p) => p.symbol), ...orders.map((o) => o.symbol)])];
  const res: SettleResult = { filled: 0, closed: 0, failed: [] };
  const marks: { k: 'p' | 'o'; id: string; t: string }[] = [];

  await Promise.all(symbols.map(async (sym) => {
    const ps = positions.filter((p) => p.symbol === sym);
    const os = orders.filter((o) => o.symbol === sym);
    const from = Math.min(...ps.map((p) => Date.parse(p.checked_until)), ...os.map((o) => Date.parse(o.checked_until)));
    let candles: Candle[];
    try {
      candles = await market.candlesSince(sym, from, now);
    } catch {
      res.failed.push(sym);
      return;
    }
    if (!candles.length) return;
    const lastT = candles[candles.length - 1].t;

    for (const o of os) {
      const checked = Date.parse(o.checked_until);
      const hit = scanOrder({ side: o.side, price: Number(o.price), checked_until: checked }, candles);
      if (hit) {
        const pos = await store.fillOrder(o.id, hit.price, new Date(hit.t), new Date(hit.end));
        res.filled++;
        if (pos) ps.push(pos);
      } else if (lastT - checked >= MARK_EVERY) {
        marks.push({ k: 'o', id: o.id, t: new Date(lastT).toISOString() });
      }
    }

    for (const p of ps) {
      const checked = Date.parse(p.checked_until);
      const hit = scanPosition({
        side: p.side,
        liq_price: Number(p.liq_price),
        tp: p.tp == null ? null : Number(p.tp),
        sl: p.sl == null ? null : Number(p.sl),
        checked_until: checked,
      }, candles);
      if (hit) {
        try {
          await store.closePosition(p.id, hit.price, hit.reason, new Date(hit.t));
          res.closed++;
        } catch (e) {
          // aynı anda elle kapatılmış olabilir
          if (!/zaten kapanmış/.test(String((e as Error)?.message))) throw e;
        }
      } else if (lastT - checked >= MARK_EVERY) {
        marks.push({ k: 'p', id: p.id, t: new Date(lastT).toISOString() });
      }
    }
  }));

  if (marks.length) await store.markChecked(marks);
  return res;
}
