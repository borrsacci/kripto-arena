import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { invoke, rpc } from './api';
import { supabase } from './supabase';
import type { AchRow, CoinCfg, Order, Position, Profile, Snapshot, Tx } from './types';

type Part = 'me' | 'profiles' | 'positions' | 'orders' | 'history' | 'achievements' | 'coins' | 'txs' | 'snapshots';

/** Uygulamanın dikkat çekmesi gereken olaylar (kutlama, TP/SL/likidasyon bildirimi) */
export type AppEvent =
  | { kind: 'achievement'; code: string }
  | { kind: 'closed'; position: Position }
  | { kind: 'filled'; order: Order };

interface State {
  booted: boolean;
  uid: string | null;
  me: Profile | null;
  profiles: Profile[];
  /** herkesin açık pozisyonları */
  positions: Position[];
  /** herkesin bekleyen emirleri */
  orders: Order[];
  /** benim kapanmış işlemlerim (son 300) */
  history: Position[];
  achievements: AchRow[];
  coins: Record<string, CoinCfg>;
  txs: Tx[];
  snapshots: Snapshot[];
  events: AppEvent[];
  online: boolean;
  /** seçili coin (İşlem ekranı) */
  symbol: string;
  setSymbol: (s: string) => void;
  start: (uid: string | null) => Promise<void>;
  refresh: (...parts: Part[]) => Promise<void>;
  sync: () => Promise<void>;
  shiftEvent: () => void;
}

const NUM_POS: (keyof Position)[] = ['margin', 'qty', 'entry_price', 'liq_price', 'tp', 'sl', 'open_fee', 'close_price', 'close_fee', 'payout', 'pnl', 'roe', 'leverage'];
const NUM_PROF: (keyof Profile)[] = ['balance', 'deposits', 'realized_pnl', 'volume', 'best_trade', 'best_roe', 'xp'];
const NUM_ORD: (keyof Order)[] = ['margin', 'price', 'tp', 'sl', 'fee', 'leverage'];

function num<T extends Record<string, any>>(o: any, keys: (keyof T)[]): T {
  const c: any = { ...o };
  for (const k of keys) if (c[k] !== null && c[k] !== undefined) c[k] = Number(c[k]);
  return c;
}
const fixPos = (p: any) => num<Position>(p, NUM_POS);
const fixProf = (p: any) => num<Profile>(p, NUM_PROF);
const fixOrd = (o: any) => num<Order>(o, NUM_ORD);

const PROFILE_COLS = '*';

let channel: RealtimeChannel | null = null;
/** kutlanmış başarımlar ve bildirilmiş kapanışlar (aynı olay iki kez gösterilmesin) */
const knownAch = new Set<string>();
const knownClosed = new Set<string>();
let primed = false;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let generation = 0;

function upsert<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i < 0) return [...list, row];
  const c = list.slice();
  c[i] = row;
  return c;
}

export const useStore = create<State>((set, get) => {
  const loaders: Record<Part, () => Promise<void>> = {
    me: async () => {
      const uid = get().uid;
      if (!uid) return set({ me: null });
      const { data, error } = await supabase.from('profiles').select(PROFILE_COLS).eq('id', uid).maybeSingle();
      // bağlantı durumu: sunucuya ulaşılamıyorsa uyarı gösterilir (gerçek zamanlı kanal kendi kendine yeniden bağlanır)
      if (error && /fetch|network|load failed/i.test(error.message)) return set({ online: false });
      set({ me: data ? fixProf(data) : null, online: true });
    },
    profiles: async () => {
      const { data } = await supabase.from('profiles').select(PROFILE_COLS).order('display_name');
      if (data) set({ profiles: data.map(fixProf) });
    },
    positions: async () => {
      const { data } = await supabase.from('positions').select('*').eq('status', 'open').order('opened_at', { ascending: false });
      if (data) set({ positions: data.map(fixPos) });
    },
    orders: async () => {
      const { data } = await supabase.from('orders').select('*').eq('status', 'open').order('created_at', { ascending: false });
      if (data) set({ orders: data.map(fixOrd) });
    },
    history: async () => {
      const uid = get().uid;
      if (!uid) return;
      const { data } = await supabase.from('positions').select('*').eq('user_id', uid).neq('status', 'open').order('closed_at', { ascending: false }).limit(300);
      if (!data) return;
      const history = data.map(fixPos);
      set({ history });
      for (const p of history.slice().reverse()) {
        if (knownClosed.has(p.id)) continue;
        knownClosed.add(p.id);
        if (primed && p.close_reason && p.close_reason !== 'manual') emit({ kind: 'closed', position: p });
      }
    },
    achievements: async () => {
      const { data } = await supabase.from('achievements').select('user_id,code,unlocked_at');
      if (!data) return;
      set({ achievements: data as AchRow[] });
      for (const a of data as AchRow[]) {
        if (a.user_id !== get().uid || knownAch.has(a.code)) continue;
        knownAch.add(a.code);
        if (primed) emit({ kind: 'achievement', code: a.code });
      }
    },
    coins: async () => {
      const { data } = await supabase.from('coins').select('symbol,max_leverage,active');
      if (data) set({ coins: Object.fromEntries((data as CoinCfg[]).map((c) => [c.symbol, c])) });
    },
    txs: async () => {
      const uid = get().uid;
      if (!uid) return;
      const { data } = await supabase.from('transactions').select('id,amount,balance_after,kind,note,created_at').eq('user_id', uid).order('id', { ascending: false }).limit(150);
      if (data) set({ txs: data.map((t) => ({ ...t, amount: Number(t.amount), balance_after: Number(t.balance_after) })) as Tx[] });
    },
    snapshots: async () => {
      const uid = get().uid;
      if (!uid) return;
      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const { data } = await supabase.from('equity_snapshots').select('at,equity,deposits').eq('user_id', uid).gte('at', since).order('at');
      if (data) set({ snapshots: data.map((s) => ({ at: s.at, equity: Number(s.equity), deposits: Number(s.deposits) })) });
    },
  };

  const emit = (e: AppEvent) => set((s) => ({ events: [...s.events, e] }));

  const subscribe = (gen: number) => {
    const uid = get().uid;
    channel = supabase
      .channel(`db-${gen}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (p) => {
        const row = p.new as any;
        if (!row?.id) return;
        const pr = fixProf(row);
        set((s) => ({ profiles: upsert(s.profiles, pr), me: pr.id === s.uid ? pr : s.me }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions' }, (p) => {
        const row = p.new as any;
        if (!row?.id) return;
        const pos = fixPos(row);
        const s = get();
        if (pos.status === 'open') {
          set({ positions: upsert(s.positions, pos) });
          return;
        }
        const wasOpen = s.positions.some((x) => x.id === pos.id);
        set({ positions: s.positions.filter((x) => x.id !== pos.id) });
        if (pos.user_id === uid) {
          set({ history: [pos, ...get().history.filter((x) => x.id !== pos.id)].slice(0, 300) });
          // tetikle (TP/SL/likidasyon) kapananları haber ver
          if (!knownClosed.has(pos.id)) {
            knownClosed.add(pos.id);
            if ((wasOpen || p.eventType === 'UPDATE') && pos.close_reason && pos.close_reason !== 'manual') emit({ kind: 'closed', position: pos });
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (p) => {
        const row = p.new as any;
        if (!row?.id) return;
        const o = fixOrd(row);
        const s = get();
        if (o.status === 'open') set({ orders: upsert(s.orders, o) });
        else {
          set({ orders: s.orders.filter((x) => x.id !== o.id) });
          if (o.user_id === uid && o.status === 'filled') emit({ kind: 'filled', order: o });
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'achievements' }, (p) => {
        const row = p.new as AchRow;
        set((s) => ({ achievements: [...s.achievements.filter((a) => !(a.user_id === row.user_id && a.code === row.code)), row] }));
        if (row.user_id === uid && !knownAch.has(row.code)) {
          knownAch.add(row.code);
          emit({ kind: 'achievement', code: row.code });
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => loaders.coins())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'transactions' }, () => loaders.txs())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') get().refresh('me', 'positions', 'orders', 'history', 'achievements');
      });
  };

  return {
    booted: false,
    uid: null,
    me: null,
    profiles: [],
    positions: [],
    orders: [],
    history: [],
    achievements: [],
    coins: {},
    txs: [],
    snapshots: [],
    events: [],
    online: true,
    symbol: (() => {
      try {
        return localStorage.getItem('kripto-symbol') || 'BTC';
      } catch {
        return 'BTC';
      }
    })(),
    setSymbol: (symbol) => {
      try {
        localStorage.setItem('kripto-symbol', symbol);
      } catch {
        /* önemli değil */
      }
      set({ symbol });
    },

    start: async (uid) => {
      const gen = ++generation;
      if (channel) {
        await supabase.removeChannel(channel);
        channel = null;
      }
      if (syncTimer) clearInterval(syncTimer);
      set({ uid, me: null, history: [], txs: [], snapshots: [], events: [] });
      knownAch.clear();
      knownClosed.clear();
      primed = false;
      if (!uid) return set({ booted: true });
      await loaders.me();
      if (gen !== generation) return;
      set({ booted: true });
      await get().refresh('profiles', 'positions', 'orders', 'history', 'achievements', 'coins', 'txs', 'snapshots');
      if (gen !== generation) return;
      primed = true; // bundan sonra gelen yeni başarım ve kapanışlar kutlanır
      subscribe(gen);
      get().sync();
      // açık pozisyonların tetikleri sunucuda 30 sn'de bir kontrol edilir; uygulama açıkken ayrıca dakikada bir
      syncTimer = setInterval(() => document.visibilityState === 'visible' && get().sync(), 60_000);
    },

    refresh: async (...parts) => {
      const ps = parts.length ? parts : (Object.keys(loaders) as Part[]);
      await Promise.all(ps.map((p) => loaders[p]().catch(() => {})));
    },

    sync: async () => {
      if (!get().uid || get().me?.status !== 'active') return;
      await invoke('trade', { action: 'sync' }).catch(() => {});
      // gerçek zamanlı bağlantı kopmuş olsa bile ekran güncel kalsın
      await get().refresh('me', 'positions', 'orders', 'history', 'achievements', 'profiles');
    },

    shiftEvent: () => set((s) => ({ events: s.events.slice(1) })),
  };
});

/** İşlem sonrası: ekranı hemen güncelle (gerçek zamanlı bildirim gecikse de) */
const after = <T>(r: T): T => {
  useStore.getState().refresh('me', 'profiles', 'positions', 'orders', 'history', 'achievements', 'txs', 'coins');
  return r;
};

/** İşlem fonksiyonu çağrıları */
export const tradeApi = {
  open: (a: { symbol: string; side: string; leverage: number; margin: number; type: 'market' | 'limit'; price?: number; tp?: number | null; sl?: number | null }) =>
    invoke<{ position?: Position; order?: Order; price?: number }>('trade', { action: 'open', ...a }).then(after),
  close: (position_id: string, fraction = 1) =>
    invoke<{ payout: number; pnl: number; price: number; position: Position }>('trade', { action: 'close', position_id, fraction }).then(after),
  tpsl: (position_id: string, tp: number | null, sl: number | null) => invoke<{ position: Position }>('trade', { action: 'tpsl', position_id, tp, sl }).then(after),
};

/** Fiyat gerektirmeyen kullanıcı işlemleri (emir iptali, günlük ödül…) */
export const rpcAfter = async <T>(fn: string, args: Record<string, unknown> = {}): Promise<T> => after(await rpc<T>(fn, args));
