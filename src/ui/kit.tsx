import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';
import { create } from 'zustand';
import { errText } from '../lib/api';
import { onBack, tap } from '../lib/native';

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

// ---------- Düğme ----------
type Variant = 'primary' | 'accent' | 'ghost' | 'danger' | 'up' | 'down' | 'quiet' | 'gold';
const variants: Record<Variant, string> = {
  primary: 'bg-text text-ink active:bg-mute',
  accent: 'bg-accent text-white active:bg-accent-deep',
  gold: 'bg-gold text-ink active:brightness-90',
  ghost: 'bg-panel-2 text-text border border-line active:bg-line',
  quiet: 'bg-transparent text-mute active:text-text',
  danger: 'bg-down/15 text-down border border-down/30 active:bg-down/25',
  up: 'bg-up text-ink active:brightness-90',
  down: 'bg-down text-white active:brightness-90',
};

export function Button({
  children, onClick, variant = 'ghost', className, disabled, busy, type = 'button', size = 'md',
}: {
  children: ReactNode;
  onClick?: () => unknown | Promise<unknown>;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  size?: 'sm' | 'md' | 'lg';
}) {
  const [running, setRunning] = useState(false);
  const loading = busy || running;
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={async () => {
        if (!onClick) return;
        tap();
        const r = onClick();
        if (r instanceof Promise) {
          setRunning(true);
          try {
            await r;
          } catch (e) {
            toast(errText(e), 'error');
          } finally {
            setRunning(false);
          }
        }
      }}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors select-none disabled:opacity-45',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-12 px-4 text-[15px]',
        size === 'lg' && 'h-14 px-5 text-base',
        variants[variant],
        className,
      )}
    >
      {loading ? <Spinner /> : children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />;
}

// ---------- Bildirim ----------
interface ToastItem { id: number; text: string; kind: 'ok' | 'error' | 'info' }
const useToasts = create<{ items: ToastItem[] }>(() => ({ items: [] }));
let tid = 0;
export function toast(text: string, kind: ToastItem['kind'] = 'ok') {
  const id = ++tid;
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, text, kind }] }));
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((x) => x.id !== id) })), kind === 'error' ? 4500 : 2600);
}
export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 px-4">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn(
              'max-w-sm rounded-xl px-4 py-3 text-[15px] font-medium shadow-xl shadow-black/40',
              t.kind === 'error' ? 'bg-down text-white' : t.kind === 'info' ? 'bg-panel-2 text-text border border-line' : 'bg-text text-ink',
            )}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------- Alttan açılan pencere ----------
export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    return onBack(() => {
      onClose();
      return true;
    });
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88vh] max-w-lg flex-col rounded-t-3xl border-t border-line bg-panel pb-safe"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => i.offset.y > 120 && onClose()}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-line" />
            {title && <div className="shrink-0 px-5 pb-1 pt-3 font-display text-2xl font-bold">{title}</div>}
            <div className="overflow-y-auto overscroll-contain px-5 pb-5 pt-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ---------- Onay penceresi (await confirm(...)) ----------
interface ConfirmReq { title: string; body?: ReactNode; ok: string; danger?: boolean; resolve: (v: boolean) => void }
const useConfirm = create<{ req: ConfirmReq | null }>(() => ({ req: null }));
export function confirm(title: string, body?: ReactNode, ok = 'Onayla', danger = false): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ req: { title, body, ok, danger, resolve } }));
}
export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  const close = (v: boolean) => {
    req?.resolve(v);
    useConfirm.setState({ req: null });
  };
  return (
    <Sheet open={!!req} onClose={() => close(false)} title={req?.title}>
      {req?.body && <div className="mb-5 text-[15px] leading-relaxed text-mute">{req.body}</div>}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => close(false)}>Vazgeç</Button>
        <Button className="flex-[1.4]" variant={req?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{req?.ok}</Button>
      </div>
    </Sheet>
  );
}

// ---------- Küçük parçalar ----------
export function Segmented<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: [T, ReactNode][]; className?: string }) {
  return (
    <div className={cn('no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-panel p-1', className)}>
      {items.map(([k, label]) => (
        <button
          key={k}
          onClick={() => { tap(); onChange(k); }}
          className={cn('h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors', value === k ? 'bg-panel-2 text-text shadow' : 'text-dim')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={cn('rounded-2xl border border-line/60 bg-panel p-4', onClick && 'active:bg-panel-2', className)}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className="font-display text-xl font-bold text-mute">{title}</div>
      {children && <div className="mt-2 text-sm leading-relaxed text-dim">{children}</div>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2.5', className)}>
      <div className="flex items-end justify-between px-1">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="block text-xs text-dim">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'h-12 w-full rounded-xl border border-line bg-ink px-3.5 text-[16px] text-text placeholder:text-dim focus:border-accent focus:outline-none';
