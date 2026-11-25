// Uygulamaya özgü küçük parçalar: coin ikonu, kâr/zarar yazısı, seviye rozeti, başarım ikonu
import {
  ArrowLeftRight, BadgeDollarSign, BarChart3, Bird, CalendarCheck, ChevronsUp, Coins, Copy, Crown, Diamond, Dices, Fish,
  Flame, Footprints, Gauge, Gem, Hourglass, LifeBuoy, ListChecks, Lock, Monitor, Moon, MoonStar, Rocket, Shapes, ShieldCheck,
  Ship, Skull, Target, Terminal, Timer, TrendingDown, Trophy, Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ACH_BY_CODE, TIER_COLORS } from '../../supabase/functions/_shared/achievements.ts';
import { COIN_BY_SYMBOL } from '../../supabase/functions/_shared/coins.ts';
import { levelFor, tierFor } from '../../supabase/functions/_shared/engine.ts';
import { pct, usd } from '../lib/format';
import { cn } from './kit';

export function CoinIcon({ symbol, size = 36, className }: { symbol: string; size?: number; className?: string }) {
  const c = COIN_BY_SYMBOL[symbol];
  const color = c?.color ?? '#888';
  const label = symbol;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * (label.length > 3 ? 0.25 : label.length > 2 ? 0.3 : 0.36),
        letterSpacing: label.length > 3 ? '-0.03em' : undefined,
        background: `radial-gradient(circle at 30% 25%, ${color}55, ${color}22 70%)`,
        color,
        boxShadow: `inset 0 0 0 1.5px ${color}66`,
      }}
    >
      {label}
    </span>
  );
}

/** Kâr/zarar rengi */
export const pnlColor = (n: number) => (n > 0.004 ? 'text-up' : n < -0.004 ? 'text-down' : 'text-mute');

export function Pnl({ value, roe, className, compact }: { value: number; roe?: number; className?: string; compact?: boolean }) {
  return (
    <span className={cn('num font-semibold', pnlColor(value), className)}>
      {usd(value, { sign: true, compact })}
      {roe !== undefined && <span className="ml-1.5 text-[0.85em] opacity-90">({pct(roe)})</span>}
    </span>
  );
}

export function SideBadge({ side, leverage, className }: { side: 'long' | 'short'; leverage?: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        side === 'long' ? 'bg-up/15 text-up' : 'bg-down/15 text-down',
        className,
      )}
    >
      {side === 'long' ? 'Long' : 'Short'}
      {leverage ? ` ${leverage}x` : ''}
    </span>
  );
}

/** Seviye rozeti: lig rengiyle */
export function LevelBadge({ xp, className, showTier }: { xp: number; className?: string; showTier?: boolean }) {
  const level = levelFor(xp);
  const t = tierFor(level);
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold num', className)}
      style={{ color: t.color, background: `${t.color}1f`, boxShadow: `inset 0 0 0 1px ${t.color}44` }}
    >
      {showTier && <span>{t.name}</span>}
      <span>Sv {level}</span>
    </span>
  );
}

export function Avatar({ name, xp, size = 40 }: { name: string; xp: number; size?: number }) {
  const t = tierFor(levelFor(xp));
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-panel-2 font-display font-bold"
      style={{ width: size, height: size, fontSize: size * 0.4, color: t.color, boxShadow: `0 0 0 2px ${t.color}aa` }}
    >
      {name.trim().charAt(0).toLocaleUpperCase('tr-TR')}
    </span>
  );
}

const ICONS: Record<string, LucideIcon> = {
  Footprints, BadgeDollarSign, TrendingDown, Hourglass, Gauge, Flame, Rocket, Dices, Skull, ChevronsUp, Moon, Gem, Zap, Crown,
  ListChecks, Monitor, Terminal, BarChart3, Fish, Ship, CalendarCheck, Wallet, Coins, Trophy, Copy, Target, ShieldCheck, Timer,
  Diamond, ArrowLeftRight, Shapes, Bird, MoonStar, LifeBuoy,
};

export function AchIcon({ code, unlocked, size = 52 }: { code: string; unlocked: boolean; size?: number }) {
  const a = ACH_BY_CODE[code];
  const Icon = (a && ICONS[a.icon]) || Trophy;
  const color = a ? TIER_COLORS[a.tier] : '#888';
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-2xl"
      style={{
        width: size,
        height: size,
        background: unlocked ? `linear-gradient(145deg, ${color}40, ${color}10)` : 'var(--color-panel-2)',
        boxShadow: unlocked ? `inset 0 0 0 1.5px ${color}88` : 'inset 0 0 0 1px var(--color-line)',
        color: unlocked ? color : 'var(--color-dim)',
      }}
    >
      <Icon size={size * 0.46} strokeWidth={2} />
      {!unlocked && (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-ink p-0.5 text-dim">
          <Lock size={12} />
        </span>
      )}
    </span>
  );
}

/** Değişince kısa süre yeşil/kırmızı yanıp sönen sayı */
export function Flash({ value, children, className }: { value: number; children: ReactNode; className?: string }) {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  const [k, setK] = useState(0);
  useEffect(() => {
    if (value > prev.current) setCls('flash-up');
    else if (value < prev.current) setCls('flash-down');
    prev.current = value;
    setK((x) => x + 1);
  }, [value]);
  return (
    <span key={k} className={cn(cls, className)}>
      {children}
    </span>
  );
}

/** Küçük çizgi grafik */
export function Spark({ data, up, width = 72, height = 28 }: { data: number[]; up: boolean; width?: number; height?: number }) {
  if (data.length < 2) return <span style={{ width, height }} className="inline-block" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const r = max - min || 1;
  const pts = data.map((v, i) => `${((i / (data.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / r) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} className={up ? 'text-up' : 'text-down'} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate text-[11px] font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className="num mt-0.5 truncate text-[15px] font-semibold">{children}</div>
    </div>
  );
}

export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1 text-sm', className)}>
      <span className="text-mute">{label}</span>
      <span className="num text-right font-medium">{children}</span>
    </div>
  );
}
