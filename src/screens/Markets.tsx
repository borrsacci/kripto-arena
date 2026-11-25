import { Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { COINS } from '../../supabase/functions/_shared/coins.ts';
import { livePnl } from '../lib/calc';
import { pct, price, usd, when } from '../lib/format';
import { tap } from '../lib/native';
import { sparkline, usePrices } from '../lib/prices';
import { useStore } from '../lib/store';
import { Avatar, CoinIcon, Flash, SideBadge, Spark, pnlColor } from '../ui/bits';
import { Segmented, cn } from '../ui/kit';

type Filter = 'all' | 'fav' | 'gainers' | 'losers';

function useFavs(): [Set<string>, (s: string) => void] {
  const [favs, setFavs] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('kripto-favs') || '["BTC","ETH","SOL"]'));
    } catch {
      return new Set(['BTC', 'ETH', 'SOL']);
    }
  });
  const toggle = (s: string) => {
    const n = new Set(favs);
    if (n.has(s)) n.delete(s);
    else n.add(s);
    setFavs(n);
    try {
      localStorage.setItem('kripto-favs', JSON.stringify([...n]));
    } catch {
      /* önemli değil */
    }
  };
  return [favs, toggle];
}

export function MarketsScreen({ onOpen, onUser }: { onOpen: (symbol: string) => void; onUser: (id: string) => void }) {
  const ticks = usePrices((s) => s.ticks);
  const mode = usePrices((s) => s.mode);
  const [filter, setFilter] = useState<Filter>('all');
  const [favs, toggleFav] = useFavs();
  const [sparks, setSparks] = useState<Record<string, number[]>>({});

  useEffect(() => {
    let alive = true;
    for (const c of COINS) sparkline(c.symbol).then((d) => alive && setSparks((s) => ({ ...s, [c.symbol]: d }))).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const list = useMemo(() => {
    let l = COINS.slice();
    if (filter === 'fav') l = l.filter((c) => favs.has(c.symbol));
    if (filter === 'gainers') l = l.sort((a, b) => (ticks[b.symbol]?.change ?? 0) - (ticks[a.symbol]?.change ?? 0));
    if (filter === 'losers') l = l.sort((a, b) => (ticks[a.symbol]?.change ?? 0) - (ticks[b.symbol]?.change ?? 0));
    return l;
  }, [filter, favs, ticks]);

  const ups = COINS.filter((c) => (ticks[c.symbol]?.change ?? 0) > 0).length;

  return (
    <div className="space-y-4 pb-4 pt-2">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-[26px] font-bold leading-tight">Piyasa</h1>
          <p className="text-sm text-dim">
            {Object.keys(ticks).length ? `${ups} coin yükselişte, ${COINS.length - ups} düşüşte` : 'Fiyatlar yükleniyor…'}
          </p>
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            mode === 'live' ? 'bg-up/12 text-up' : mode === 'down' ? 'bg-down/12 text-down' : 'bg-warn/12 text-warn',
          )}
        >
          <span className={cn('size-1.5 rounded-full bg-current', mode === 'live' && 'animate-pulse')} />
          {mode === 'live' ? 'Canlı' : mode === 'down' ? 'Bağlantı yok' : 'Gecikmeli'}
        </span>
      </div>

      <ArenaFeed onUser={onUser} />

      <Segmented
        value={filter}
        onChange={setFilter}
        items={[['all', 'Tümü'], ['fav', 'Favoriler'], ['gainers', 'Yükselenler'], ['losers', 'Düşenler']]}
      />

      <div className="-mx-1">
        {list.map((c) => {
          const t = ticks[c.symbol];
          const up = (t?.change ?? 0) >= 0;
          return (
            <div key={c.symbol} className="flex items-center rounded-xl active:bg-panel">
              <button onClick={() => { tap(); toggleFav(c.symbol); }} className="flex h-14 w-9 shrink-0 items-center justify-center" aria-label="Favori">
                <Star size={16} className={favs.has(c.symbol) ? 'fill-gold text-gold' : 'text-line'} />
              </button>
              <button onClick={() => onOpen(c.symbol)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-1 text-left">
                <CoinIcon symbol={c.symbol} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{c.symbol}</div>
                  <div className="truncate text-xs text-dim">{t ? `Hacim ${usd(t.quoteVol, { compact: true })}` : c.name}</div>
                </div>
                <Spark data={sparks[c.symbol] ?? []} up={up} />
                <div className="w-[104px] text-right">
                  <Flash value={t?.price ?? 0} className="num block text-[15px] font-semibold">
                    {price(t?.price)}
                  </Flash>
                  <span className={cn('num mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold', up ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>
                    {t ? pct(t.change) : '—'}
                  </span>
                </div>
              </button>
            </div>
          );
        })}
        {filter === 'fav' && !list.length && <p className="px-4 py-8 text-center text-sm text-dim">Yıldıza dokunarak favori ekleyin.</p>}
      </div>
    </div>
  );
}

/** Arenada şu an açık olan son pozisyonlar (herkesin) */
function ArenaFeed({ onUser }: { onUser: (id: string) => void }) {
  const positions = useStore((s) => s.positions);
  const profiles = useStore((s) => s.profiles);
  const ticks = usePrices((s) => s.ticks);
  const items = positions.slice().sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at)).slice(0, 12);
  if (!items.length) return null;
  const longs = positions.filter((p) => p.side === 'long').length;
  return (
    <section>
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className="font-display text-lg font-bold">Arenada şu an</h2>
        <span className="text-xs text-dim">
          {positions.length} açık pozisyon · <span className="text-up">%{Math.round((longs / positions.length) * 100)} long</span>
        </span>
      </div>
      <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
        {items.map((p) => {
          const u = profiles.find((x) => x.id === p.user_id);
          const l = livePnl(p, ticks[p.symbol]?.price);
          return (
            <button key={p.id} onClick={() => onUser(p.user_id)} className="w-[150px] shrink-0 rounded-2xl border border-line/60 bg-panel p-3 text-left active:bg-panel-2">
              <div className="flex items-center gap-2">
                <Avatar name={u?.display_name ?? '?'} xp={u?.xp ?? 0} size={24} />
                <span className="truncate text-sm font-semibold">{u?.display_name ?? '—'}</span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <CoinIcon symbol={p.symbol} size={20} />
                <span className="text-sm font-bold">{p.symbol}</span>
                <SideBadge side={p.side} leverage={p.leverage} className="px-1 text-[10px]" />
              </div>
              <div className={cn('num mt-2 font-display text-xl font-bold', pnlColor(l.roe))}>{pct(l.roe)}</div>
              <div className="text-[11px] text-dim">{when(p.opened_at)}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
