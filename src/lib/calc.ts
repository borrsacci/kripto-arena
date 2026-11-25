// Hesap özeti ve sıralama: canlı fiyatlarla anlık varlık, gerçekleşmemiş kâr/zarar
import { useMemo } from 'react';
import { grossPnl, levelFor, positionValue, roe } from '../../supabase/functions/_shared/engine.ts';
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

export function livePnl(p: Position, price: number | undefined) {
  const px = price ?? p.entry_price;
  const liquidated = p.side === 'long' ? px <= p.liq_price : px >= p.liq_price;
  const pnl = liquidated ? -p.margin : grossPnl(p.side, p.qty, p.entry_price, px);
  return { price: px, pnl, roe: liquidated ? -1 : roe(p.side, p.entry_price, px, p.leverage), value: positionValue(p, px) };
}

export function accountOf(profile: Profile, positions: Position[], orders: Order[], ticks: Record<string, Tick>): Account {
  let marginUsed = 0;
  let upnl = 0;
  let value = 0;
  let openCount = 0;
  for (const p of positions) {
    if (p.user_id !== profile.id) continue;
    const l = livePnl(p, ticks[p.symbol]?.price);
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
