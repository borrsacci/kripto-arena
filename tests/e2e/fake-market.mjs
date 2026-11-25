// Yerel uçtan uca test için sahte piyasa: Binance REST uç noktalarının uygulamanın kullandığı kısmı.
// Fiyatlar zamanın belirli bir fonksiyonudur (tekrarlanabilir). POST /shock ile ani hareket verilir.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 54500);
const BASE = { BTC: 97000, ETH: 3600, SOL: 240, BNB: 650, XRP: 1.42, DOGE: 0.39, ADA: 1.05, AVAX: 42, LINK: 24, TRX: 0.21, TON: 5.6, SUI: 3.9, LTC: 105, DOT: 8.2, PEPE: 0.0000195, SHIB: 0.0000245 };
const shocks = []; // { sym, at, factor }
const IV = { '1s': 1e3, '1m': 6e4, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 };

function px(sym, t) {
  const b = BASE[sym];
  const seed = sym.charCodeAt(0) + sym.length * 7;
  let p = b * (1 + 0.012 * Math.sin(t / 3.1e6 + seed) + 0.004 * Math.sin(t / 4.7e5 + seed * 2) + 0.0015 * Math.sin(t / 3.3e4 + seed) + 0.0006 * Math.sin(t / 2.9e3));
  for (const s of shocks) if (s.sym === sym && t >= s.at) p *= s.factor;
  return p;
}
function candle(sym, t, ms) {
  const n = 12;
  const vals = Array.from({ length: n + 1 }, (_, i) => px(sym, t + (ms * i) / n - (i === n ? 1 : 0)));
  const v = (BASE[sym] * 1000 * ms) / 6e4;
  return [t, vals[0], Math.max(...vals), Math.min(...vals), vals[n], 1, t + ms - 1, v * (1 + 0.5 * Math.sin(t / 7e5))];
}

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
};
const syms = (q) => (q.get('symbols') ? JSON.parse(q.get('symbols')) : [q.get('symbol')]).map((s) => s.replace(/USDT$/, ''));

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = u.searchParams;
  const now = Date.now();
  if (u.pathname === '/shock') {
    shocks.push({ sym: q.get('symbol'), at: now, factor: Number(q.get('factor')) });
    return send(res, 200, { ok: true, price: px(q.get('symbol'), now) });
  }
  if (u.pathname === '/api/v3/ticker/price') {
    const out = syms(q).map((s) => ({ symbol: `${s}USDT`, price: String(px(s, now)) }));
    return send(res, 200, q.get('symbols') ? out : out[0]);
  }
  if (u.pathname === '/api/v3/ticker/24hr') {
    return send(res, 200, syms(q).map((s) => ({
      symbol: `${s}USDT`, lastPrice: String(px(s, now)), openPrice: String(px(s, now - 864e5)),
      highPrice: String(px(s, now) * 1.021), lowPrice: String(px(s, now) * 0.978), quoteVolume: String(BASE[s] * 3.2e7 / Math.sqrt(BASE[s])),
    })));
  }
  if (u.pathname === '/api/v3/klines') {
    const sym = q.get('symbol').replace(/USDT$/, '');
    const ms = IV[q.get('interval')];
    const limit = Math.min(1000, Number(q.get('limit') ?? 500));
    const end = Math.min(now, Number(q.get('endTime') ?? now));
    let start = q.get('startTime') ? Math.floor(Number(q.get('startTime')) / ms) * ms : Math.floor(end / ms) * ms - (limit - 1) * ms;
    const out = [];
    for (let t = start; t <= end && out.length < limit; t += ms) out.push(candle(sym, t, ms));
    return send(res, 200, out);
  }
  send(res, 404, { msg: 'not found' });
}).listen(PORT, () => console.log(`fake-market :${PORT}`));
