const nf = (min: number, max: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
const usd2 = nf(2, 2);
const usd0 = nf(0, 0);
const pct2 = nf(2, 2);

/** Dolar tutarı: $12.345,67 (büyük tutarlarda kuruşsuz) */
export function usd(n: number, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = opts.sign && v > 0 ? '+' : v < 0 ? '−' : '';
  const a = Math.abs(v);
  let body: string;
  if (opts.compact && a >= 1e9) body = `${nf(0, 1).format(a / 1e9)} Mr`;
  else if (opts.compact && a >= 1e6) body = `${nf(0, 1).format(a / 1e6)} Mn`;
  else if (opts.compact && a >= 1e5) body = `${nf(0, 1).format(a / 1e3)} B`;
  else body = a >= 1e5 ? usd0.format(a) : usd2.format(a);
  return `${s}$${body}`;
}

/** Fiyat: büyüklüğüne göre ondalık (BTC 2, XRP 4, PEPE 8+) */
export function priceDigits(p: number): number {
  const a = Math.abs(p);
  if (a >= 100) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  if (a >= 0.0001) return 7;
  return 9;
}
const priceFmts = new Map<number, Intl.NumberFormat>();
export function price(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  const d = priceDigits(p);
  if (!priceFmts.has(d)) priceFmts.set(d, nf(d, d));
  return priceFmts.get(d)!.format(p);
}

/** Yüzde: 0.0234 → +%2,34 (digits=0 → +%2) */
export function pct(x: number, sign = true, digits = 2): string {
  if (!Number.isFinite(x)) return '—';
  const s = sign && x > 0 ? '+' : x < 0 ? '−' : '';
  return `${s}%${(digits === 2 ? pct2 : nf(0, digits)).format(Math.abs(x * 100))}`;
}

export function qty(q: number): string {
  const a = Math.abs(q);
  const d = a >= 1000 ? 0 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6;
  return nf(0, d).format(q);
}

export const int = (n: number) => usd0.format(n);

export function when(iso: string | number): string {
  const d = new Date(iso);
  const now = new Date();
  const t = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Bugün ${t}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Dün ${t}`;
  return `${d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${t}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sn`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} sa ${m % 60 ? `${m % 60} dk` : ''}`.trim();
  return `${Math.floor(h / 24)} gün`;
}

/** Sayı girişini okur: "1.234,5" veya "1234.5" */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s/g, '');
  if (!t) return null;
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Fiyatı giriş kutusu için düz metne çevirir (ondalık ayırıcı virgül) */
export function priceInput(p: number): string {
  return p.toFixed(priceDigits(p)).replace('.', ',');
}
