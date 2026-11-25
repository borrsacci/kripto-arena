// Pozisyon ve emir kartları, kapatma / TP-SL pencereleri, kâr kartı paylaşımı
import html2canvas from 'html2canvas';
import { Share2, Target, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { closeValue, priceForRoe, TAKER_FEE, validateTpSl } from '../../supabase/functions/_shared/engine.ts';
import { livePnl } from '../lib/calc';
import { duration, parseNum, pct, price, priceInput, usd, when } from '../lib/format';
import { shareImage, thump } from '../lib/native';
import { usePrices } from '../lib/prices';
import { tradeApi, rpcAfter, useStore } from '../lib/store';
import type { Order, Position } from '../lib/types';
import { CoinIcon, Flash, Pnl, pnlColor, SideBadge } from './bits';
import { Button, Card, Segmented, Sheet, cn, confirm, inputCls, toast } from './kit';

export function PositionCard({ p, mine, showUser }: { p: Position; mine: boolean; showUser?: string }) {
  const tick = usePrices((s) => s.ticks[p.symbol]);
  const l = livePnl(p, tick?.price);
  const [sheet, setSheet] = useState<'close' | 'tpsl' | 'share' | null>(null);
  const liqDist = Math.abs(l.price - p.liq_price) / l.price;
  return (
    <Card className="space-y-3 p-3.5">
      <div className="flex items-center gap-3">
        <CoinIcon symbol={p.symbol} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-[17px] font-bold">{p.symbol}</span>
            <SideBadge side={p.side} leverage={p.leverage} />
          </div>
          <div className="truncate text-xs text-dim">{showUser ?? `${when(p.opened_at)} · ${duration(Date.now() - Date.parse(p.opened_at))}`}</div>
        </div>
        <div className="text-right">
          <Flash value={l.pnl}>
            <Pnl value={l.pnl} className="text-[17px]" />
          </Flash>
          <div className={cn('num text-xs font-semibold', pnlColor(l.roe))}>{pct(l.roe)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 text-[13px]">
        <Cell label="Giriş">{price(p.entry_price)}</Cell>
        <Cell label="Anlık">{price(l.price)}</Cell>
        <Cell label="Likidasyon" className={liqDist < 0.02 ? 'text-down' : liqDist < 0.05 ? 'text-warn' : 'text-text'}>
          {price(p.liq_price)}
        </Cell>
        <Cell label="Marjin">{usd(p.margin)}</Cell>
        <Cell label="Büyüklük">{usd(p.qty * l.price, { compact: true })}</Cell>
        <Cell label="TP / SL">
          <span className="text-up">{p.tp ? price(p.tp) : '—'}</span>
          <span className="text-dim"> / </span>
          <span className="text-down">{p.sl ? price(p.sl) : '—'}</span>
        </Cell>
      </div>
      {mine && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => setSheet('tpsl')}>
            <Target size={15} /> TP / SL
          </Button>
          <Button size="sm" className="flex-1" onClick={() => setSheet('share')}>
            <Share2 size={15} /> Paylaş
          </Button>
          <Button size="sm" variant="primary" className="flex-[1.3]" onClick={() => setSheet('close')}>
            Kapat
          </Button>
        </div>
      )}
      {mine && <CloseSheet p={p} open={sheet === 'close'} onClose={() => setSheet(null)} />}
      {mine && <TpSlSheet p={p} open={sheet === 'tpsl'} onClose={() => setSheet(null)} />}
      <ShareSheet p={p} open={sheet === 'share'} onClose={() => setSheet(null)} />
    </Card>
  );
}

function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-dim">{label}</div>
      <div className={cn('num truncate font-medium', className)}>{children}</div>
    </div>
  );
}

function CloseSheet({ p, open, onClose }: { p: Position; open: boolean; onClose: () => void }) {
  const tick = usePrices((s) => s.ticks[p.symbol]);
  const [frac, setFrac] = useState<'0.25' | '0.5' | '0.75' | '1'>('1');
  const f = Number(frac);
  const px = tick?.price ?? p.entry_price;
  const value = closeValue(p.side, p.qty * f, p.entry_price, p.margin * f, px);
  const net = value - p.margin * f - p.open_fee * f;
  const go = async () => {
    const r = await tradeApi.close(p.id, f);
    thump();
    toast(`${p.symbol} ${f === 1 ? 'kapatıldı' : `%${f * 100} kapatıldı`}: ${usd(r.pnl, { sign: true })}`);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title={`${p.symbol} ${p.side === 'long' ? 'Long' : 'Short'} kapat`}>
      <Segmented value={frac} onChange={setFrac} items={[['0.25', '%25'], ['0.5', '%50'], ['0.75', '%75'], ['1', 'Tamamı']]} />
      <div className="mt-4 space-y-1 rounded-xl bg-ink p-3.5">
        <Line label="Kapanış fiyatı (yaklaşık)">{price(px)}</Line>
        <Line label="Kapanan marjin">{usd(p.margin * f)}</Line>
        <Line label="Komisyon (%0,05)">{usd(p.qty * f * px * TAKER_FEE)}</Line>
        <Line label="Hesabına dönecek">{usd(value)}</Line>
        <Line label="Net kâr / zarar">
          <Pnl value={net} />
        </Line>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-dim">İşlem, sunucunun o anki piyasa fiyatıyla yapılır; gösterilen tutar küçük farklarla değişebilir.</p>
      <Button variant="primary" size="lg" className="mt-4 w-full" onClick={go}>
        Piyasa fiyatından kapat
      </Button>
    </Sheet>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-mute">{label}</span>
      <span className="num font-semibold">{children}</span>
    </div>
  );
}

/** TP / SL girişi: fiyatla veya getiri (ROE) kısayollarıyla */
export function TpSlInputs({
  side, entry, lev, margin, tp, sl, setTp, setSl,
}: { side: 'long' | 'short'; entry: number; lev: number; margin: number; tp: string; sl: string; setTp: (s: string) => void; setSl: (s: string) => void }) {
  const tpN = parseNum(tp);
  const slN = parseNum(sl);
  const roeAt = (x: number) => (side === 'long' ? 1 : -1) * ((x - entry) / entry) * lev;
  return (
    <div className="space-y-3">
      {(['tp', 'sl'] as const).map((k) => {
        const val = k === 'tp' ? tp : sl;
        const set = k === 'tp' ? setTp : setSl;
        const n = k === 'tp' ? tpN : slN;
        const chips = k === 'tp' ? [0.25, 0.5, 1, 2] : [-0.1, -0.25, -0.5, -0.75];
        return (
          <div key={k}>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className={cn('font-semibold', k === 'tp' ? 'text-up' : 'text-down')}>{k === 'tp' ? 'Kâr al (TP)' : 'Zarar durdur (SL)'}</span>
              {n != null && n > 0 && (
                <span className={cn('num text-xs', pnlColor(roeAt(n)))}>
                  {pct(roeAt(n))} · {usd(margin * roeAt(n), { sign: true })}
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input className={cn(inputCls, 'h-11 flex-1')} inputMode="decimal" placeholder="Fiyat (boş: yok)" value={val} onChange={(e) => set(e.target.value)} />
              {val && (
                <button className="px-2 text-dim" onClick={() => set('')} aria-label="Temizle">
                  <X size={18} />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {chips.map((r) => (
                <button
                  key={r}
                  onClick={() => set(priceInput(priceForRoe(side, entry, lev, r)))}
                  className="h-8 flex-1 rounded-lg bg-panel-2 text-xs font-semibold text-mute active:bg-line"
                >
                  {pct(r, true, 0)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TpSlSheet({ p, open, onClose }: { p: Position; open: boolean; onClose: () => void }) {
  const tick = usePrices((s) => s.ticks[p.symbol]);
  const [tp, setTp] = useState(p.tp ? priceInput(p.tp) : '');
  const [sl, setSl] = useState(p.sl ? priceInput(p.sl) : '');
  const ref = tick?.price ?? p.entry_price;
  const err = validateTpSl(p.side, ref, p.liq_price, parseNum(tp), parseNum(sl));
  const save = async () => {
    await tradeApi.tpsl(p.id, parseNum(tp), parseNum(sl));
    toast('TP / SL kaydedildi');
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Kâr al / Zarar durdur">
      <p className="mb-4 text-sm leading-relaxed text-mute">
        Fiyat bu seviyelere değdiğinde pozisyon kendiliğinden kapanır; uygulama kapalı olsa bile. Yüzdeler marjine göre getiridir (ROE).
      </p>
      <TpSlInputs side={p.side} entry={p.entry_price} lev={p.leverage} margin={p.margin} tp={tp} sl={sl} setTp={setTp} setSl={setSl} />
      <div className="mt-3 flex justify-between text-xs text-dim">
        <span>Anlık: {price(ref)}</span>
        <span>Likidasyon: {price(p.liq_price)}</span>
      </div>
      {err && <p className="mt-3 rounded-xl bg-down/15 px-3 py-2.5 text-sm text-down">{err}</p>}
      <Button variant="accent" size="lg" className="mt-4 w-full" disabled={!!err} onClick={save}>
        Kaydet
      </Button>
    </Sheet>
  );
}

// ---------- Kâr kartı ----------
export function ShareSheet({ p, open, onClose }: { p: Position; open: boolean; onClose: () => void }) {
  const me = useStore((s) => s.profiles.find((x) => x.id === p.user_id));
  const tick = usePrices((s) => s.ticks[p.symbol]);
  const card = useRef<HTMLDivElement>(null);
  const closed = p.status !== 'open';
  const l = livePnl(p, tick?.price);
  const r = closed ? (p.roe ?? 0) : l.roe;
  const exit = closed ? (p.close_price ?? 0) : l.price;
  const up = r >= 0;
  const share = async () => {
    if (!card.current) return;
    const canvas = await html2canvas(card.current, { backgroundColor: '#0b0e14', scale: 2 });
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Görsel oluşturulamadı');
    await shareImage(blob, `kripto-arena-${p.symbol}.png`, 'Kripto Arena');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Kâr kartı">
      <div
        ref={card}
        className="relative overflow-hidden rounded-2xl p-5"
        style={{ background: `radial-gradient(120% 90% at 100% 0%, ${up ? 'rgba(22,199,132,0.28)' : 'rgba(246,70,93,0.28)'}, transparent 60%), #131823` }}
      >
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-bold tracking-wide text-accent">KRİPTO ARENA</span>
          <span className="text-xs text-dim">{when(closed ? p.closed_at! : Date.now())}</span>
        </div>
        <div className="mt-5 flex items-center gap-2.5">
          <CoinIcon symbol={p.symbol} size={30} />
          <span className="font-display text-xl font-bold">{p.symbol}/USDT</span>
          <SideBadge side={p.side} leverage={p.leverage} />
        </div>
        <div className={cn('num mt-4 font-display text-[52px] font-bold leading-none', up ? 'text-up' : 'text-down')}>{pct(r)}</div>
        {p.status === 'liquidated' && <div className="mt-1 text-sm font-semibold text-down">Likide oldu</div>}
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-dim">Giriş fiyatı</div>
            <div className="num font-semibold">{price(p.entry_price)}</div>
          </div>
          <div>
            <div className="text-xs text-dim">{closed ? 'Çıkış fiyatı' : 'Anlık fiyat'}</div>
            <div className="num font-semibold">{price(exit)}</div>
          </div>
        </div>
        <div className="mt-5 border-t border-line pt-3 text-sm text-mute">
          <span className="font-semibold text-text">{me?.display_name}</span> · @{me?.username}
        </div>
      </div>
      <Button variant="accent" size="lg" className="mt-4 w-full" onClick={share}>
        <Share2 size={18} /> Paylaş
      </Button>
    </Sheet>
  );
}

// ---------- Bekleyen emir ----------
export function OrderCard({ o, mine }: { o: Order; mine: boolean }) {
  const tick = usePrices((s) => s.ticks[o.symbol]);
  const dist = tick ? (o.price - tick.price) / tick.price : null;
  const cancel = async () => {
    if (!(await confirm('Emri iptal et', `${o.symbol} ${o.side === 'long' ? 'Long' : 'Short'} limit emri iptal edilecek; ayrılan ${usd(o.margin + o.fee)} hesabına döner.`, 'İptal et', true))) return;
    await rpcAfter('cancel_order', { p_order: o.id });
    toast('Emir iptal edildi');
  };
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <CoinIcon symbol={o.symbol} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold">{o.symbol}</span>
          <SideBadge side={o.side} leverage={o.leverage} />
          <span className="text-[11px] font-semibold text-accent">LİMİT</span>
        </div>
        <div className="num mt-0.5 text-xs text-mute">
          {price(o.price)} · {usd(o.margin)} marjin
          {dist != null && <span className="text-dim"> · fiyata {pct(Math.abs(dist), false)}</span>}
        </div>
        {(o.tp || o.sl) && (
          <div className="num text-xs text-dim">
            TP {o.tp ? price(o.tp) : '—'} · SL {o.sl ? price(o.sl) : '—'}
          </div>
        )}
      </div>
      {mine && (
        <Button size="sm" variant="danger" onClick={cancel}>
          İptal
        </Button>
      )}
    </Card>
  );
}

// ---------- Geçmiş ----------
const REASON: Record<string, [string, string]> = {
  manual: ['Elle', 'bg-panel-2 text-mute'],
  tp: ['TP', 'bg-up/15 text-up'],
  sl: ['SL', 'bg-warn/15 text-warn'],
  liq: ['Likidasyon', 'bg-down/15 text-down'],
};

export function HistoryRow({ p, onClick }: { p: Position; onClick?: () => void }) {
  const [label, cls] = REASON[p.close_reason ?? 'manual'];
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left active:bg-panel-2">
      <CoinIcon symbol={p.symbol} size={30} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold">{p.symbol}</span>
          <SideBadge side={p.side} leverage={p.leverage} />
          <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase', cls)}>{label}</span>
        </div>
        <div className="num mt-0.5 truncate text-xs text-dim">
          {price(p.entry_price)} → {price(p.close_price ?? 0)} · {when(p.closed_at!)}
        </div>
      </div>
      <div className="text-right">
        <Pnl value={p.pnl ?? 0} className="text-sm" />
        <div className={cn('num text-[11px]', pnlColor(p.roe ?? 0))}>{pct(p.roe ?? 0)}</div>
      </div>
    </button>
  );
}

/** Kapanmış işlem için paylaşım penceresini açan liste */
export function HistoryList({ items, empty }: { items: Position[]; empty: React.ReactNode }) {
  const [share, setShare] = useState<Position | null>(null);
  const shown = useMemo(() => items.slice(0, 200), [items]);
  if (!items.length) return <>{empty}</>;
  return (
    <div className="divide-y divide-line/50">
      {shown.map((p) => (
        <HistoryRow key={p.id} p={p} onClick={() => setShare(p)} />
      ))}
      {share && <ShareSheet p={share} open onClose={() => setShare(null)} />}
    </div>
  );
}

