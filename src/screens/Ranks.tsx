import { Crown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ACHIEVEMENTS } from '../../supabase/functions/_shared/achievements.ts';
import { levelFor, tierFor } from '../../supabase/functions/_shared/engine.ts';
import { rpc } from '../lib/api';
import { type LeaderRow, useLeaderboard } from '../lib/calc';
import { int, pct, usd } from '../lib/format';
import { useStore } from '../lib/store';
import { supabase } from '../lib/supabase';
import type { PeriodRow, Position } from '../lib/types';
import { AchIcon, Avatar, LevelBadge, Pnl, pnlColor, Stat } from '../ui/bits';
import { Card, Empty, Segmented, Sheet, Spinner, cn } from '../ui/kit';
import { HistoryList, PositionCard } from '../ui/positions';

type Board = 'net' | 'roi' | 'week' | 'day' | 'level';

/** Türkiye saatiyle bugünün / bu haftanın (pazartesi) başlangıcı */
function periodStart(kind: 'day' | 'week'): string {
  const TR = 3 * 3600_000;
  const local = new Date(Date.now() + TR);
  local.setUTCHours(0, 0, 0, 0);
  if (kind === 'week') local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return new Date(local.getTime() - TR).toISOString();
}

export function RanksScreen({ onUser }: { onUser: (id: string) => void }) {
  const rows = useLeaderboard();
  const uid = useStore((s) => s.uid);
  const [board, setBoard] = useState<Board>('net');
  const [period, setPeriod] = useState<Record<string, PeriodRow> | null>(null);
  const history = useStore((s) => s.history.length); // kendi işlemim kapanınca dönem tablosunu yenile

  useEffect(() => {
    if (board !== 'week' && board !== 'day') return;
    let alive = true;
    setPeriod(null);
    rpc<PeriodRow[]>('period_pnl', { p_since: periodStart(board) })
      .then((r) => alive && setPeriod(Object.fromEntries(r.map((x) => [x.user_id, { ...x, pnl: Number(x.pnl), volume: Number(x.volume) }]))))
      .catch(() => alive && setPeriod({}));
    return () => {
      alive = false;
    };
  }, [board, history]);

  const sorted = useMemo(() => {
    const val = (r: LeaderRow): number => {
      if (board === 'net') return r.account.net;
      if (board === 'roi') return r.account.roi;
      if (board === 'level') return r.profile.xp;
      return period?.[r.profile.id]?.pnl ?? 0;
    };
    let list = rows.map((r) => ({ r, v: val(r) }));
    if (board === 'week' || board === 'day') list = list.filter((x) => period?.[x.r.profile.id]);
    return list.sort((a, b) => b.v - a.v);
  }, [rows, board, period]);

  const fmt = (v: number, r: LeaderRow) => {
    if (board === 'roi') return <span className={pnlColor(v)}>{pct(v)}</span>;
    if (board === 'level') return <span className="text-text">{int(r.profile.xp)} XP</span>;
    return <Pnl value={v} compact />;
  };
  const sub = (r: LeaderRow) => {
    if (board === 'week' || board === 'day') {
      const p = period?.[r.profile.id];
      return p ? `${p.trades} işlem · %${Math.round((p.wins / Math.max(1, p.trades)) * 100)} kazanma` : '';
    }
    if (board === 'level') return `${tierFor(r.level).name} · ${r.achievements} başarım`;
    return `Varlık ${usd(r.account.equity, { compact: true })} · ${r.account.openCount} açık`;
  };

  const myIndex = sorted.findIndex((x) => x.r.profile.id === uid);
  const top = sorted.slice(0, 3);
  const loading = (board === 'week' || board === 'day') && !period;

  return (
    <div className="space-y-4 pb-4 pt-2">
      <div>
        <h1 className="font-display text-[26px] font-bold leading-tight">Sıralama</h1>
        <p className="text-sm text-dim">Herkes aynı oyunda: kim daha iyi trader?</p>
      </div>
      <Segmented
        value={board}
        onChange={setBoard}
        items={[['net', 'Toplam kâr'], ['roi', 'Getiri %'], ['week', 'Bu hafta'], ['day', 'Bugün'], ['level', 'Seviye']]}
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="size-6 text-accent" />
        </div>
      ) : !sorted.length ? (
        <Empty title="Bu dönemde kapanan işlem yok">İlk işlemi kapatan zirveye yerleşir.</Empty>
      ) : (
        <>
          <Podium items={top.map((x) => ({ r: x.r, label: fmt(x.v, x.r) }))} onUser={onUser} />
          {myIndex >= 0 && (
            <Card className="flex items-center justify-between border-accent/40 bg-accent/8 py-3">
              <span className="text-sm text-mute">Senin sıran</span>
              <span className="font-display text-xl font-bold">
                #{myIndex + 1} <span className="text-sm font-medium text-dim">/ {sorted.length}</span>
              </span>
            </Card>
          )}
          <div className="space-y-1">
            {sorted.slice(3).map((x, i) => (
              <button
                key={x.r.profile.id}
                onClick={() => onUser(x.r.profile.id)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left active:bg-panel', x.r.profile.id === uid && 'bg-accent/10')}
              >
                <span className="num w-7 text-center font-display text-base font-bold text-dim">{i + 4}</span>
                <Avatar name={x.r.profile.display_name} xp={x.r.profile.xp} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{x.r.profile.display_name}</span>
                    <LevelBadge xp={x.r.profile.xp} />
                  </div>
                  <div className="truncate text-xs text-dim">{sub(x.r)}</div>
                </div>
                <div className="num text-right text-sm font-semibold">{fmt(x.v, x.r)}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Podium({ items, onUser }: { items: { r: LeaderRow; label: React.ReactNode }[]; onUser: (id: string) => void }) {
  const order = [items[1], items[0], items[2]];
  const heights = ['h-20', 'h-28', 'h-14'];
  const colors = ['#C9D1DE', '#F2C14E', '#C98A5A'];
  const ranks = [2, 1, 3];
  return (
    <div className="grid grid-cols-3 items-end gap-2 pt-4">
      {order.map((x, i) =>
        x ? (
          <button key={x.r.profile.id} onClick={() => onUser(x.r.profile.id)} className="flex flex-col items-center text-center">
            {ranks[i] === 1 && <Crown size={22} className="mb-1 text-gold" />}
            <Avatar name={x.r.profile.display_name} xp={x.r.profile.xp} size={ranks[i] === 1 ? 58 : 48} />
            <div className="mt-1.5 w-full truncate text-sm font-semibold">{x.r.profile.display_name}</div>
            <div className="num text-xs font-semibold">{x.label}</div>
            <div
              className={cn('mt-2 flex w-full items-start justify-center rounded-t-xl pt-2 font-display text-2xl font-bold', heights[i])}
              style={{ background: `linear-gradient(180deg, ${colors[i]}33, ${colors[i]}08)`, color: colors[i], boxShadow: `inset 0 1px 0 ${colors[i]}66` }}
            >
              {ranks[i]}
            </div>
          </button>
        ) : (
          <div key={i} />
        ),
      )}
    </div>
  );
}

/** Bir oyuncunun profili: istatistikler, açık pozisyonları, başarımları, son işlemleri */
export function UserSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const rows = useLeaderboard();
  const positions = useStore((s) => s.positions);
  const achievements = useStore((s) => s.achievements);
  const uid = useStore((s) => s.uid);
  const [recent, setRecent] = useState<Position[] | null>(null);
  const row = rows.find((r) => r.profile.id === id);

  useEffect(() => {
    if (!id) return;
    setRecent(null);
    supabase
      .from('positions')
      .select('*')
      .eq('user_id', id)
      .neq('status', 'open')
      .order('closed_at', { ascending: false })
      .limit(30)
      .then(({ data }) =>
        setRecent(
          (data ?? []).map((p: any) => ({
            ...p,
            margin: +p.margin, qty: +p.qty, entry_price: +p.entry_price, liq_price: +p.liq_price, close_price: +p.close_price,
            pnl: +p.pnl, roe: +p.roe, payout: +p.payout, open_fee: +p.open_fee,
          })),
        ),
      );
  }, [id]);

  const p = row?.profile;
  const open = positions.filter((x) => x.user_id === id);
  const mine = new Set(achievements.filter((a) => a.user_id === id).map((a) => a.code));
  const tier = p ? tierFor(levelFor(p.xp)) : null;
  return (
    <Sheet open={!!id} onClose={onClose}>
      {p && row && (
        <div className="space-y-5 pt-2">
          <div className="flex items-center gap-4">
            <Avatar name={p.display_name} xp={p.xp} size={60} />
            <div className="min-w-0">
              <div className="truncate font-display text-2xl font-bold">{p.display_name}</div>
              <div className="flex items-center gap-2 text-sm text-dim">
                @{p.username}
                <LevelBadge xp={p.xp} showTier />
              </div>
            </div>
          </div>
          <Card className="grid grid-cols-3 gap-3 p-3.5">
            <Stat label="Varlık">{usd(row.account.equity, { compact: true })}</Stat>
            <Stat label="Toplam K/Z">
              <span className={pnlColor(row.account.net)}>{usd(row.account.net, { sign: true, compact: true })}</span>
            </Stat>
            <Stat label="Getiri">
              <span className={pnlColor(row.account.roi)}>{pct(row.account.roi)}</span>
            </Stat>
            <Stat label="İşlem">{p.trades}</Stat>
            <Stat label="Kazanma">{p.trades ? pct(p.wins / p.trades, false, 0) : '—'}</Stat>
            <Stat label="Likidasyon">{p.liquidations}</Stat>
            <Stat label="En iyi işlem">{usd(p.best_trade, { compact: true })}</Stat>
            <Stat label="En iyi ROE">{pct(p.best_roe)}</Stat>
            <Stat label="En uzun seri">{p.best_streak}</Stat>
          </Card>

          <section>
            <h3 className="mb-2 font-display text-lg font-bold">
              Başarımlar <span className="text-sm font-medium text-dim">{mine.size}/{ACHIEVEMENTS.length}</span>
            </h3>
            {mine.size ? (
              <div className="flex flex-wrap gap-2">
                {ACHIEVEMENTS.filter((a) => mine.has(a.code)).map((a) => (
                  <AchIcon key={a.code} code={a.code} unlocked size={42} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-dim">Henüz başarım yok.</p>
            )}
          </section>

          {open.length > 0 && (
            <section className="space-y-2.5">
              <h3 className="font-display text-lg font-bold">Açık pozisyonlar</h3>
              {open.map((x) => (
                <PositionCard key={x.id} p={x} mine={x.user_id === uid} />
              ))}
            </section>
          )}

          <section>
            <h3 className="mb-1 font-display text-lg font-bold">Son işlemler</h3>
            {recent === null ? <Spinner className="text-dim" /> : <HistoryList items={recent} empty={<p className="text-sm text-dim">Kapanmış işlem yok.</p>} />}
          </section>
          {tier && <div className="h-1 rounded-full" style={{ background: tier.color, opacity: 0.4 }} />}
        </div>
      )}
    </Sheet>
  );
}
