// Canlı fiyatlar: Binance herkese açık piyasa akışı (WebSocket). Bağlantı kurulamazsa
// REST ile 4 saniyede bir yoklama yapılır, o da olmazsa OKX'ten alınır.
import { create } from 'zustand';
import { COINS } from '../../supabase/functions/_shared/coins.ts';

export interface Tick {
  price: number;
  open: number; // 24 saat önceki fiyat
  high: number;
  low: number;
  quoteVol: number; // 24 saatlik hacim ($)
  change: number; // 24 saatlik değişim (0.01 = %1)
  at: number;
}

interface PriceState {
  ticks: Record<string, Tick>;
  mode: 'connecting' | 'live' | 'poll' | 'down';
}

export const usePrices = create<PriceState>(() => ({ ticks: {}, mode: 'connecting' }));

export const BINANCE_REST = ['https://data-api.binance.vision', 'https://api.binance.com'];
const WS = 'wss://data-stream.binance.vision/stream?streams=';

const bySymbol = (pair: string) => pair.replace(/USDT$/, '');

let buffer: Record<string, Tick> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function push(sym: string, t: Tick) {
  buffer[sym] = t;
  if (!flushTimer)
    flushTimer = setTimeout(() => {
      const b = buffer;
      buffer = {};
      flushTimer = null;
      usePrices.setState((s) => ({ ticks: { ...s.ticks, ...b } }));
    }, 400);
}

const mk = (price: number, open: number, high: number, low: number, quoteVol: number): Tick => ({
  price, open, high, low, quoteVol, change: open > 0 ? price / open - 1 : 0, at: Date.now(),
});

export async function fetchJson(urls: string[], path: string): Promise<any> {
  let last: unknown;
  for (const u of urls) {
    try {
      const r = await fetch(u + path, { cache: 'no-store' });
      if (r.ok) return await r.json();
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

async function pollOnce(): Promise<boolean> {
  try {
    const list = encodeURIComponent(JSON.stringify(COINS.map((c) => c.pair)));
    const rows = (await fetchJson(BINANCE_REST, `/api/v3/ticker/24hr?symbols=${list}`)) as any[];
    for (const r of rows) push(bySymbol(r.symbol), mk(+r.lastPrice, +r.openPrice, +r.highPrice, +r.lowPrice, +r.quoteVolume));
    return true;
  } catch {
    try {
      const j = await fetchJson(['https://www.okx.com'], '/api/v5/market/tickers?instType=SPOT');
      const want = new Set(COINS.map((c) => `${c.symbol}-USDT`));
      for (const r of j.data as any[]) {
        if (want.has(r.instId)) push(r.instId.split('-')[0], mk(+r.last, +r.open24h, +r.high24h, +r.low24h, +r.volCcy24h));
      }
      return true;
    } catch {
      return false;
    }
  }
}

let ws: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retry = 0;
let started = false;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const ok = await pollOnce();
    if (usePrices.getState().mode !== 'live') usePrices.setState({ mode: ok ? 'poll' : 'down' });
  }, 4000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function connect() {
  const streams = COINS.map((c) => `${c.pair.toLowerCase()}@miniTicker`).join('/');
  try {
    ws = new WebSocket(WS + streams);
  } catch {
    startPolling();
    return;
  }
  const sock = ws;
  sock.onopen = () => {
    retry = 0;
    usePrices.setState({ mode: 'live' });
    stopPolling();
  };
  sock.onmessage = (ev) => {
    const d = JSON.parse(ev.data)?.data;
    if (d?.s) push(bySymbol(d.s), mk(+d.c, +d.o, +d.h, +d.l, +d.q));
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (usePrices.getState().mode === 'live') usePrices.setState({ mode: 'poll' });
    startPolling();
    retry++;
    setTimeout(connect, Math.min(30000, 1500 * 2 ** Math.min(retry, 5)));
  };
  sock.onerror = () => sock.close();
}

export function startPrices() {
  if (started) return;
  started = true;
  pollOnce().then((ok) => usePrices.getState().mode === 'connecting' && !ok && usePrices.setState({ mode: 'down' }));
  connect();
}

/** Uygulama arka plandan dönünce: kopmuş bağlantıyı hemen yenile */
export function wakePrices() {
  if (!started) return;
  pollOnce();
  if (!ws || ws.readyState > 1) {
    retry = 0;
    connect();
  }
}

export const priceOf = (sym: string): number | undefined => usePrices.getState().ticks[sym]?.price;

// ---------- Mum verisi (grafik ve küçük çizgiler) ----------
export interface Kline {
  time: number; // saniye
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchKlines(sym: string, interval: string, limit = 500): Promise<Kline[]> {
  const rows = (await fetchJson(BINANCE_REST, `/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`)) as any[];
  return rows.map((k) => ({ time: k[0] / 1000, open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[7] }));
}

const sparkCache = new Map<string, { at: number; data: number[] }>();
export async function sparkline(sym: string): Promise<number[]> {
  const c = sparkCache.get(sym);
  if (c && Date.now() - c.at < 5 * 60_000) return c.data;
  const ks = await fetchKlines(sym, '1h', 24);
  const data = ks.map((k) => k.close);
  sparkCache.set(sym, { at: Date.now(), data });
  return data;
}

/** Tek coin için canlı mum akışı (grafik) */
export function streamKline(sym: string, interval: string, onKline: (k: Kline) => void): () => void {
  let sock: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  const open = () => {
    if (closed) return;
    sock = new WebSocket(`wss://data-stream.binance.vision/ws/${sym.toLowerCase()}usdt@kline_${interval}`);
    sock.onopen = () => (attempt = 0);
    sock.onmessage = (ev) => {
      const k = JSON.parse(ev.data)?.k;
      if (k) onKline({ time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.q });
    };
    sock.onclose = () => {
      if (closed) return;
      attempt++;
      setTimeout(open, Math.min(20000, 1000 * 2 ** Math.min(attempt, 4)));
    };
    sock.onerror = () => sock?.close();
  };
  open();
  return () => {
    closed = true;
    sock?.close();
  };
}
