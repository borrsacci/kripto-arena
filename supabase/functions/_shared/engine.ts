// İşlem motoru: kaldıraçlı (izole marjin) vadeli işlem kuralları.
// Para hesapları veritabanında (SQL) yapılır; buradaki formüller arayüzdeki önizleme
// ve mum verisiyle tetik taraması içindir. SQL ile aynı sonucu verdikleri testlerle doğrulanır.

export const TAKER_FEE = 0.0005; // piyasa emri: işlem büyüklüğünün %0,05'i
export const MAKER_FEE = 0.0002; // limit emri: %0,02
export const MMR = 0.005; // bakım marjini oranı (%0,5)
export const MIN_MARGIN = 10;
export const MAX_OPEN_POSITIONS = 30;
export const MAX_OPEN_ORDERS = 30;
export const START_BALANCE = 10000;
export const BAILOUT_AMOUNT = 5000;
export const BAILOUT_BELOW = 500;

export type Side = 'long' | 'short';
export type CloseReason = 'manual' | 'tp' | 'sl' | 'liq';

export const sideSign = (s: Side) => (s === 'long' ? 1 : -1);

/** Likidasyon fiyatı: kayıp, marjinin (1 − kaldıraç×MMR) kadarına ulaştığında pozisyon kapanır */
export function liqPrice(side: Side, entry: number, lev: number): number {
  return side === 'long' ? entry * (1 - 1 / lev + MMR) : entry * (1 + 1 / lev - MMR);
}

export function qtyFor(margin: number, lev: number, price: number): number {
  return (margin * lev) / price;
}

/** Brüt kâr/zarar (komisyon hariç) */
export function grossPnl(side: Side, qty: number, entry: number, price: number): number {
  return sideSign(side) * qty * (price - entry);
}

/** Marjine göre getiri (ROE). 1 = %100 */
export function roe(side: Side, entry: number, price: number, lev: number): number {
  return sideSign(side) * ((price - entry) / entry) * lev;
}

/** Pozisyon şimdi kapatılsa cebe dönecek tutar (marjin + kâr − kapanış komisyonu, en az 0) */
export function closeValue(side: Side, qty: number, entry: number, margin: number, price: number, fee = TAKER_FEE): number {
  return Math.max(0, margin + grossPnl(side, qty, entry, price) - qty * price * fee);
}

/** Açık pozisyonun anlık değeri (likidasyon fiyatını geçtiyse 0) */
export function positionValue(p: { side: Side; qty: number; entry_price: number; margin: number; liq_price: number }, price: number): number {
  const liquidated = p.side === 'long' ? price <= p.liq_price : price >= p.liq_price;
  return liquidated ? 0 : closeValue(p.side, p.qty, p.entry_price, p.margin, price);
}

/** İşlem açılırken önizleme */
export function preview(side: Side, margin: number, lev: number, price: number, fee = TAKER_FEE) {
  const notional = margin * lev;
  return {
    notional,
    qty: notional / price,
    fee: notional * fee,
    cost: margin + notional * fee,
    liq: liqPrice(side, price, lev),
  };
}

/** Hedef getiriye (ROE) karşılık gelen fiyat: TP/SL'yi yüzdeyle girmek için */
export function priceForRoe(side: Side, entry: number, lev: number, targetRoe: number): number {
  return entry * (1 + (sideSign(side) * targetRoe) / lev);
}

/** TP/SL fiyatlarının geçerliliği (referans: şu anki fiyat veya limit fiyatı) */
export function validateTpSl(side: Side, ref: number, liq: number, tp: number | null, sl: number | null): string | null {
  if (tp != null) {
    if (!(tp > 0)) return 'Kâr al fiyatı geçersiz';
    if (side === 'long' && tp <= ref) return 'Long için kâr al fiyatı şu anki fiyatın üstünde olmalı';
    if (side === 'short' && tp >= ref) return 'Short için kâr al fiyatı şu anki fiyatın altında olmalı';
  }
  if (sl != null) {
    if (!(sl > 0)) return 'Zarar durdur fiyatı geçersiz';
    if (side === 'long' && sl >= ref) return 'Long için zarar durdur fiyatı şu anki fiyatın altında olmalı';
    if (side === 'short' && sl <= ref) return 'Short için zarar durdur fiyatı şu anki fiyatın üstünde olmalı';
    if (side === 'long' && sl <= liq) return 'Zarar durdur, likidasyon fiyatından önce gelmeli';
    if (side === 'short' && sl >= liq) return 'Zarar durdur, likidasyon fiyatından önce gelmeli';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mum verisiyle tetik taraması
// Pozisyonlar ve limit emirler, son kontrol anından bu yana gelen mumlarla (genelde 1 saniyelik)
// sırayla taranır. Böylece uygulama kapalıyken bile likidasyon, TP ve SL doğru anda ve doğru
// fiyattan gerçekleşir; sunucu birkaç dakika geç kontrol etse de sonuç değişmez.
// ---------------------------------------------------------------------------

export interface Candle {
  t: number; // açılış zamanı (ms)
  ms: number; // süre (1000 veya 60000)
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface ScanPosition {
  side: Side;
  liq_price: number;
  tp: number | null;
  sl: number | null;
  checked_until: number; // ms
}

export interface Hit {
  reason: Exclude<CloseReason, 'manual'>;
  price: number;
  t: number;
}

/** Mum, kontrol edilen andan sonra bitiyorsa taranır */
const relevant = (c: Candle, checked: number) => c.t + c.ms > checked;

export function scanPosition(p: ScanPosition, candles: Candle[]): Hit | null {
  const long = p.side === 'long';
  // Ters yönde ilk karşılaşılan seviye: SL likidasyondan önceyse SL, değilse likidasyon
  const slFirst = p.sl != null && (long ? p.sl > p.liq_price : p.sl < p.liq_price);
  const adverse = slFirst ? p.sl! : p.liq_price;
  for (const c of candles) {
    if (!relevant(c, p.checked_until)) continue;
    const advHit = long ? c.l <= adverse : c.h >= adverse;
    const tpHit = p.tp != null && (long ? c.h >= p.tp : c.l <= p.tp);
    if (!advHit && !tpHit) continue;
    let adverseFirst = advHit;
    if (advHit && tpHit) {
      // İkisi aynı mumda: yeşil mum önce dibi (açılış→dip→tepe→kapanış), kırmızı mum önce tepeyi görür
      const green = c.c >= c.o;
      adverseFirst = long ? green : !green;
    }
    if (adverseFirst) {
      const gapped = long ? c.o <= adverse : c.o >= adverse; // fiyat seviyenin ötesinde açıldı
      const liqGapped = long ? c.o <= p.liq_price : c.o >= p.liq_price;
      if (!slFirst || liqGapped) return { reason: 'liq', price: p.liq_price, t: c.t };
      return { reason: 'sl', price: gapped ? c.o : adverse, t: c.t };
    }
    const gapped = long ? c.o >= p.tp! : c.o <= p.tp!;
    return { reason: 'tp', price: gapped ? c.o : p.tp!, t: c.t };
  }
  return null;
}

export interface ScanOrder {
  side: Side;
  price: number;
  checked_until: number;
}

/** Limit emir: long için fiyat limitin altına, short için üstüne gelince dolar */
export function scanOrder(o: ScanOrder, candles: Candle[]): { price: number; t: number; end: number } | null {
  for (const c of candles) {
    if (!relevant(c, o.checked_until)) continue;
    if (o.side === 'long' && c.l <= o.price) return { price: c.o < o.price ? c.o : o.price, t: c.t, end: c.t + c.ms };
    if (o.side === 'short' && c.h >= o.price) return { price: c.o > o.price ? c.o : o.price, t: c.t, end: c.t + c.ms };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Seviye ve lig
// ---------------------------------------------------------------------------

/** L seviyesine ulaşmak için gereken toplam XP: 50·L·(L−1) → 2: 100, 5: 1000, 10: 4500, 20: 19000 */
export const xpForLevel = (level: number) => 50 * level * (level - 1);
export function levelFor(xp: number): number {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 50)) / 2));
}
export function levelProgress(xp: number) {
  const level = levelFor(xp);
  const from = xpForLevel(level);
  const to = xpForLevel(level + 1);
  return { level, from, to, frac: (xp - from) / (to - from) };
}

export interface Tier {
  name: string;
  min: number; // en düşük seviye
  color: string;
}
export const TIERS: Tier[] = [
  { name: 'Çaylak', min: 1, color: '#8B93A7' },
  { name: 'Bronz', min: 5, color: '#C98A5A' },
  { name: 'Gümüş', min: 10, color: '#C9D1DE' },
  { name: 'Altın', min: 15, color: '#F2C14E' },
  { name: 'Platin', min: 20, color: '#5EE1D2' },
  { name: 'Elmas', min: 30, color: '#7CB8FF' },
  { name: 'Usta', min: 40, color: '#B18CFF' },
  { name: 'Efsane', min: 50, color: '#FF6B8A' },
];
export function tierFor(level: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (level >= x.min) t = x;
  return t;
}
