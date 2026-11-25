// Piyasa verisi: Binance (herkese açık piyasa verisi uç noktası), yedek olarak OKX.
// Hem sunucu (Deno) hem testler (Node) tarafından kullanılır; sadece fetch gerektirir.
import type { Candle } from './engine.ts';

export interface Market {
  price(symbol: string): Promise<number>;
  prices(symbols: string[]): Promise<Record<string, number>>;
  /** fromMs anından itibaren şimdiye kadarki mumlar (önce 1 dk'lık, son 15 dakika 1 sn'lik) */
  candlesSince(symbol: string, fromMs: number, nowMs: number): Promise<Candle[]>;
}

// MARKET_BASE: yerel testte sahte piyasa sunucusu (üretimde tanımlı değildir)
const OVERRIDE = (globalThis as any).Deno?.env?.get?.('MARKET_BASE') as string | undefined;
const BINANCE = OVERRIDE ? [OVERRIDE] : ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];

async function getJson(url: string, timeoutMs = 8000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function binance(path: string): Promise<any> {
  let last: unknown;
  for (const base of BINANCE) {
    try {
      return await getJson(base + path);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const okxId = (symbol: string) => `${symbol}-USDT`;

const SECOND = 1000;
const MINUTE = 60_000;
const FINE_WINDOW = 15 * MINUTE; // son 15 dakika saniyelik mumlarla taranır
const MAX_REQUESTS = 8;

function parseBinance(rows: any[], ms: number): Candle[] {
  return rows.map((k) => ({ t: Number(k[0]), ms, o: +k[1], h: +k[2], l: +k[3], c: +k[4] }));
}

export function createMarket(): Market {
  return {
    async price(symbol) {
      try {
        const j = await binance(`/api/v3/ticker/price?symbol=${symbol}USDT`);
        const p = Number(j.price);
        if (p > 0) return p;
      } catch {
        /* yedeğe geç */
      }
      const j = await getJson(`https://www.okx.com/api/v5/market/ticker?instId=${okxId(symbol)}`);
      const p = Number(j?.data?.[0]?.last);
      if (!(p > 0)) throw new Error('Fiyat alınamadı');
      return p;
    },

    async prices(symbols) {
      const out: Record<string, number> = {};
      try {
        const list = encodeURIComponent(JSON.stringify(symbols.map((s) => `${s}USDT`)));
        const j = (await binance(`/api/v3/ticker/price?symbols=${list}`)) as { symbol: string; price: string }[];
        for (const x of j) out[x.symbol.replace(/USDT$/, '')] = Number(x.price);
      } catch {
        await Promise.all(symbols.map(async (s) => {
          out[s] = await this.price(s).catch(() => NaN);
        }));
      }
      return out;
    },

    async candlesSince(symbol, fromMs, nowMs) {
      try {
        return await binanceCandles(symbol, fromMs, nowMs);
      } catch (e) {
        // Yedek: OKX 1 dakikalık mumlar (son 300 dakika)
        if (nowMs - fromMs > 290 * MINUTE) throw e;
        const j = await getJson(`https://www.okx.com/api/v5/market/candles?instId=${okxId(symbol)}&bar=1m&limit=300`);
        const rows = (j?.data ?? []) as string[][];
        return rows
          .map((k) => ({ t: Number(k[0]), ms: MINUTE, o: +k[1], h: +k[2], l: +k[3], c: +k[4] }))
          .filter((c) => c.t + c.ms > fromMs)
          .sort((a, b) => a.t - b.t);
      }
    },
  };
}

async function binanceCandles(symbol: string, fromMs: number, nowMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let t = fromMs;
  for (let i = 0; i < MAX_REQUESTS && t < nowMs; i++) {
    const fine = nowMs - t <= FINE_WINDOW;
    const ms = fine ? SECOND : MINUTE;
    const start = Math.floor(t / ms) * ms;
    // 1 dk'lık mumlar sadece saniyelik pencerenin başına kadar alınır; gerisi saniyelik
    const end = fine ? nowMs : nowMs - FINE_WINDOW;
    const rows = await binance(`/api/v3/klines?symbol=${symbol}USDT&interval=${fine ? '1s' : '1m'}&startTime=${start}&endTime=${end}&limit=1000`);
    const cs = parseBinance(rows, ms);
    if (!cs.length) {
      if (fine) break;
      t = end; // bu aralıkta işlem yoksa saniyelik pencereye geç
      continue;
    }
    for (const c of cs) if (!out.length || c.t >= out[out.length - 1].t + out[out.length - 1].ms) out.push(c);
    const next = cs[cs.length - 1].t + ms;
    if (next <= t) break;
    t = next;
  }
  return out;
}
