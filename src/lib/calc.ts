// Hesap özeti ve sıralama: canlı fiyatlarla anlık varlık, gerçekleşmemiş kâr/zarar
import { useMemo } from 'react';
import { feesFor, grossPnl, levelFor, positionValue, roe, TAKER_FEE } from '../../supabase/functions/_shared/engine.ts';
import { usePrices, type Tick } from './prices';
import { useStore } from './store';
import type { Order, Position, Profile } from './types';

export interface Account {
  balance: number;
  reserved: number; // bekleyen emirler için ayrılan
  marginUsed: number;
  upnl: number; // gerçekleşmemiş (komisyon hariç)
  equity: number; // toplam varlık: şimdi her şey kapatılsa elde kalacak tutar
  deposits: number;
  net: number; // toplam net kâr/zarar
  roi: number;
  openCount: number;
}

/** Canlı kâr/zarar. pnl/roe: komisyonsuz (borsalardaki gibi). net: şimdi kapatılsa açılış+kapanış komisyonu düşülmüş kâr. */
export function livePnl(p: Position, price: number | undefined, takerFee = TAKER_FEE) {
  const px = price ?? p.entry_price;
  const liquidated = p.side === 'long' ? px <= p.liq_price : px >= p.liq_price;
  const pnl = liquidated ? -p.margin : grossPnl(p.side, p.qty, p.entry_price, px);
  const value = positionValue(p, px, takerFee);
  const net = value - p.margin - p.open_fee;
  return { price: px, pnl, roe: liquidated ? -1 : roe(p.side, p.entry_price, px, p.leverage), value, net, netRoe: net / p.margin, closeFee: liquidated ? 0 : p.qty * px * takerFee };
}

export function accountOf(profile: Profile, positions: Position[], orders: Order[], ticks: Record<string, Tick>): Account {
  let marginUsed = 0;
  let upnl = 0;
  let value = 0;
  let openCount = 0;
  const fee = feesFor(profile.xp).taker;
  for (const p of positions) {
    if (p.user_id !== profile.id) continue;
    const l = livePnl(p, ticks[p.symbol]?.price, fee);
    marginUsed += p.margin;
    upnl += l.pnl;
    value += l.value;
    openCount++;
  }
  let reserved = 0;
  for (const o of orders) if (o.user_id === profile.id) reserved += o.margin + o.fee;
  const equity = profile.balance + reserved + value;
  const net = equity - profile.deposits;
  return { balance: profile.balance, reserved, marginUsed, upnl, equity, deposits: profile.deposits, net, roi: profile.deposits > 0 ? net / profile.deposits : 0, openCount };
}

export function useMyAccount(): Account | null {
  const me = useStore((s) => s.me);
  const positions = useStore((s) => s.positions);
  const orders = useStore((s) => s.orders);
  const ticks = usePrices((s) => s.ticks);
  return useMemo(() => (me ? accountOf(me, positions, orders, ticks) : null), [me, positions, orders, ticks]);
}

export interface LeaderRow {
  profile: Profile;
  account: Account;
  level: number;
  achievements: number;
}

export function useLeaderboard(): LeaderRow[] {
  const profiles = useStore((s) => s.profiles);
  const positions = useStore((s) => s.positions);
  const orders = useStore((s) => s.orders);
  const achievements = useStore((s) => s.achievements);
  const ticks = usePrices((s) => s.ticks);
  return useMemo(() => {
    const achCount = new Map<string, number>();
    for (const a of achievements) achCount.set(a.user_id, (achCount.get(a.user_id) ?? 0) + 1);
    return profiles
      .filter((p) => p.status === 'active')
      .map((p) => ({ profile: p, account: accountOf(p, positions, orders, ticks), level: levelFor(p.xp), achievements: achCount.get(p.id) ?? 0 }));
  }, [profiles, positions, orders, achievements, ticks]);
}

/** Oturumdaki kullanıcının indirimli komisyon oranları */
export function useMyFees() {
  const xp = useStore((s) => s.me?.xp ?? 0);
  return useMemo(() => feesFor(xp), [xp]);
}

/** Bir kullanıcının indirimli komisyon oranları (pozisyon kartları için) */
export function useFeesOf(userId: string) {
  const xp = useStore((s) => s.profiles.find((p) => p.id === userId)?.xp ?? (s.me?.id === userId ? s.me.xp : 0));
  return useMemo(() => feesFor(xp), [xp]);
}

/** Komisyon oranını yazıya çevirir: 0.000455 → %0,0455 */
export function feeLabel(rate: number): string {
  return `%${(rate * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',')}`;
}
