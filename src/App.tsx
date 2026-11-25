import { BarChart3, Briefcase, CandlestickChart, Trophy, UserRound } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { ACH_BY_CODE, TIER_COLORS } from '../supabase/functions/_shared/achievements.ts';
import { useMyAccount } from './lib/calc';
import { pct, price, usd } from './lib/format';
import { buzz, cheer, onBack, onResume, tap } from './lib/native';
import { startPrices, wakePrices } from './lib/prices';
import { useStore } from './lib/store';
import { isConfigured, supabase } from './lib/supabase';
import { checkUpdate, dismissUpdate, type UpdateInfo } from './lib/update';
import { AuthScreen, DisabledScreen, NotConfigured } from './screens/Auth';
import { MarketsScreen } from './screens/Markets';
import { PortfolioScreen } from './screens/Portfolio';
import { ProfileScreen } from './screens/Profile';
import { RanksScreen, UserSheet } from './screens/Ranks';
import { TradeScreen } from './screens/Trade';
import { AchIcon, pnlColor } from './ui/bits';
import { Button, ConfirmHost, Spinner, Toasts, cn, toast } from './ui/kit';

type Tab = 'markets' | 'trade' | 'portfolio' | 'ranks' | 'profile';

export default function App() {
  const { booted, uid, me, start } = useStore();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (!isConfigured) return;
    startPrices();
    supabase.auth.getSession().then(({ data }) => {
      setAuthChecked(true);
      start(data.session?.user.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') {
        const id = session?.user.id ?? null;
        if (id !== useStore.getState().uid) start(id);
      }
    });
    const off = onResume(() => {
      wakePrices();
      const s = useStore.getState();
      s.refresh('me', 'positions', 'orders', 'history', 'achievements', 'profiles');
      s.sync();
    });
    return () => {
      sub.subscription.unsubscribe();
      off();
    };
  }, [start]);

  if (!isConfigured) return <NotConfigured />;
  if (!authChecked || !booted) return <Splash />;
  return (
    <>
      {!uid || !me ? <AuthScreen /> : me.status !== 'active' ? <DisabledScreen /> : <Shell />}
      <Toasts />
      <ConfirmHost />
    </>
  );
}

function Splash() {
  return (
    <div className="ink-bg flex h-full items-center justify-center">
      <Spinner className="size-6 text-accent" />
    </div>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>('markets');
  const [user, setUser] = useState<string | null>(null);
  const acc = useMyAccount();
  const setSymbol = useStore((s) => s.setSymbol);
  const openCount = useStore((s) => s.positions.filter((p) => p.user_id === s.uid).length);
  const online = useStore((s) => s.online);

  useEffect(
    () =>
      onBack(() => {
        if (tab !== 'markets') {
          setTab('markets');
          return true;
        }
        return false;
      }),
    [tab],
  );

  const go = (t: Tab) => {
    tap();
    setTab(t);
    document.getElementById('main')?.scrollTo({ top: 0 });
  };

  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  useEffect(() => {
    checkUpdate().then(setUpdate);
    return onResume(() => checkUpdate().then(setUpdate));
  }, []);

  const items: [Tab, string, typeof BarChart3, number][] = [
    ['markets', 'Piyasa', BarChart3, 0],
    ['trade', 'İşlem', CandlestickChart, 0],
    ['portfolio', 'Portföy', Briefcase, openCount],
    ['ranks', 'Sıralama', Trophy, 0],
    ['profile', 'Profil', UserRound, 0],
  ];

  return (
    <div className="ink-bg flex h-full flex-col">
      <header className="pt-safe shrink-0">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="font-display text-xl font-bold tracking-tight">Kripto Arena</span>
          </div>
          {acc && (
            <button onClick={() => go('portfolio')} className="rounded-full border border-line/70 bg-panel px-3 py-1 text-right leading-tight">
              <div className="num text-sm font-bold">{usd(acc.equity)}</div>
              <div className={cn('num text-[10px] font-semibold', pnlColor(acc.net))}>{pct(acc.roi)}</div>
            </button>
          )}
        </div>
        {update && (
          <div className="flex items-center bg-accent text-sm font-semibold text-white">
            <a href={update.url} className="flex-1 px-4 py-2.5">
              Yeni sürüm hazır. Dokunup indirin ve kurun.
            </a>
            <button
              onClick={() => {
                dismissUpdate(update.version);
                setUpdate(null);
              }}
              className="px-4 py-2.5 text-white/70"
            >
              Sonra
            </button>
          </div>
        )}
        {!online && <div className="bg-down/15 px-4 py-1.5 text-center text-xs font-medium text-down">Sunucuya ulaşılamıyor. İnternet bağlantınızı kontrol edin.</div>}
      </header>

      <main id="main" className="no-scrollbar mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 pb-6">
        {tab === 'markets' && (
          <MarketsScreen
            onOpen={(s) => {
              setSymbol(s);
              go('trade');
            }}
            onUser={setUser}
          />
        )}
        {tab === 'trade' && <TradeScreen />}
        {tab === 'portfolio' && <PortfolioScreen onTrade={() => go('trade')} />}
        {tab === 'ranks' && <RanksScreen onUser={setUser} />}
        {tab === 'profile' && <ProfileScreen />}
      </main>

      <nav className="pb-safe shrink-0 border-t border-line/60 bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg">
          {items.map(([k, label, Icon, badge]) => (
            <button key={k} onClick={() => go(k)} className={cn('relative flex h-16 flex-1 flex-col items-center justify-center gap-1', tab === k ? 'text-text' : 'text-dim')}>
              {tab === k && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
              <Icon size={22} strokeWidth={tab === k ? 2.4 : 1.8} />
              <span className="text-[11px] font-semibold">{label}</span>
              {badge > 0 && (
                <span className="absolute right-[calc(50%-22px)] top-2 min-w-[18px] rounded-full bg-accent px-1 text-[11px] font-bold leading-[18px] text-white">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <UserSheet id={user} onClose={() => setUser(null)} />
      <EventHost />
    </div>
  );
}

/** Başarım kutlaması ve kendiliğinden kapanan işlemlerin bildirimi */
function EventHost() {
  const events = useStore((s) => s.events);
  const shift = useStore((s) => s.shiftEvent);
  const ev = events[0];

  useEffect(() => {
    if (!ev || ev.kind === 'achievement') return;
    if (ev.kind === 'closed') {
      const p = ev.position;
      const what = p.close_reason === 'tp' ? 'kâr al ile kapandı' : p.close_reason === 'sl' ? 'zarar durdur ile kapandı' : 'likide oldu';
      if (p.close_reason === 'liq') buzz();
      else cheer();
      toast(`${p.symbol} ${p.side === 'long' ? 'Long' : 'Short'} ${what}: ${usd(p.pnl ?? 0, { sign: true })}`, p.close_reason === 'liq' ? 'error' : 'ok');
    } else if (ev.kind === 'filled') {
      cheer();
      toast(`Limit emrin doldu: ${ev.order.symbol} ${price(ev.order.price)}`);
    }
    shift();
  }, [ev, shift]);

  useEffect(() => {
    if (ev?.kind === 'achievement') cheer();
  }, [ev]);

  const a = ev?.kind === 'achievement' ? ACH_BY_CODE[ev.code] : null;
  return (
    <AnimatePresence>
      {a && (
        <motion.div key={a.code} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={shift}>
          <motion.div
            className="relative w-full max-w-xs overflow-hidden rounded-3xl border border-line bg-panel px-6 pb-6 pt-8 text-center"
            initial={{ scale: 0.8, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', damping: 16, stiffness: 260 }}
          >
            <div className="pointer-events-none absolute inset-x-0 -top-24 mx-auto size-56 rounded-full blur-3xl" style={{ background: `${TIER_COLORS[a.tier]}44` }} />
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Başarım açıldı</div>
            <motion.div className="mt-5 flex justify-center" initial={{ rotate: -12, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', damping: 9, stiffness: 180, delay: 0.1 }}>
              <AchIcon code={a.code} unlocked size={92} />
            </motion.div>
            <div className="mt-5 font-display text-2xl font-bold">{a.title}</div>
            <div className="mt-1 text-sm text-mute">{a.desc}</div>
            <div className="mt-4 inline-block rounded-full px-3 py-1 text-sm font-bold" style={{ color: TIER_COLORS[a.tier], background: `${TIER_COLORS[a.tier]}22` }}>
              +{a.xp} XP
            </div>
            <Button variant="primary" className="mt-6 w-full" onClick={shift}>
              Harika
            </Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      <line x1="5" y1="7" x2="5" y2="19" stroke="#f6465d" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="3" y="10" width="4" height="6" rx="1" fill="#f6465d" />
      <line x1="12" y1="4" x2="12" y2="16" stroke="#16c784" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="10" y="6" width="4" height="7" rx="1" fill="#16c784" />
      <line x1="19" y1="1.5" x2="19" y2="13" stroke="#16c784" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="17" y="3" width="4" height="7" rx="1" fill="#16c784" />
      <rect x="2" y="21" width="20" height="1.6" rx="0.8" fill="#8b7cff" />
    </svg>
  );
}
