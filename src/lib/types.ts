import type { Side } from '../../supabase/functions/_shared/engine.ts';
export type { Side };

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  status: 'active' | 'disabled';
  balance: number;
  deposits: number;
  xp: number;
  trades: number;
  wins: number;
  losses: number;
  liquidations: number;
  streak: number;
  best_streak: number;
  realized_pnl: number;
  volume: number;
  best_trade: number;
  best_roe: number;
  daily_streak: number;
  last_daily: string | null;
  last_bailout_at: string | null;
  created_at: string;
}

export interface Position {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  leverage: number;
  margin: number;
  qty: number;
  entry_price: number;
  liq_price: number;
  tp: number | null;
  sl: number | null;
  open_fee: number;
  status: 'open' | 'closed' | 'liquidated';
  close_price: number | null;
  close_fee: number | null;
  payout: number | null;
  pnl: number | null;
  roe: number | null;
  close_reason: 'manual' | 'tp' | 'sl' | 'liq' | null;
  parent_id: string | null;
  order_id: string | null;
  opened_at: string;
  closed_at: string | null;
}

export interface Order {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  leverage: number;
  margin: number;
  price: number;
  tp: number | null;
  sl: number | null;
  fee: number;
  status: 'open' | 'filled' | 'cancelled';
  created_at: string;
  done_at: string | null;
}

export interface AchRow {
  user_id: string;
  code: string;
  unlocked_at: string;
}

export interface CoinCfg {
  symbol: string;
  max_leverage: number;
  active: boolean;
}

export interface Tx {
  id: number;
  amount: number;
  balance_after: number;
  kind: string;
  note: string | null;
  created_at: string;
}

export interface Snapshot {
  at: string;
  equity: number;
  deposits: number;
}

export interface PeriodRow {
  user_id: string;
  pnl: number;
  trades: number;
  wins: number;
  volume: number;
}
