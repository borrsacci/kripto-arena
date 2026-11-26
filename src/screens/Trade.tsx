import { CandlestickChart, ChevronDown, LineChart, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { COIN_BY_SYMBOL, COINS } from '../../supabase/functions/_shared/coins.ts';
import { MIN_MARGIN, preview, type Side, validateTpSl } from '../../supabase/functions/_shared/engine.ts';
import { feeLabel, useMyAccount, useMyFees } from '../lib/calc';
import { parseNum, pct, price, priceInput, qty as fmtQty, usd } from '../lib/format';
import { tap, thump } from '../lib/native';
import { usePrices } from '../lib/prices';
import { tradeApi, useStore } from '../lib/store';
import { CoinIcon, Flash, Row } from '../ui/bits';
import { INTERVALS, type Interval, type Level, PriceChart } from '../ui/Chart';
import { Button, Card, Empty, Section, Segmented, Sheet, cn, confirm, inputCls, toast } from '../ui/kit';
import { OrderCard, PositionCard, TpSlInputs } from '../ui/positions';

function useSaved<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T) || initial;
    } catch {
      return initial;
    }
  });
  return [
    v,
    (x: T) => {
      setV(x);
      try {
        localStorage.setItem(key, x);
      } catch {
        /* önemli değil */
      }
    },
  ];
}

export function TradeScreen() {
  const symbol = useStore((s) => s.symbol);
  const uid = useStore((s) => s.uid);
  const tick = usePrices((s) => s.ticks[symbol]);
  const positions = useStore((s) => s.positions);
  const orders = useStore((s) => s.orders);
  const [interval, setIv] = useSaved<Interval>('kripto-interval', '15m');
  const [kind, setKind] = useSaved<'candle' | 'line'>('kripto-chart', 'candle');
  const [picker, setPicker] = useState(false);

  const myPos = positions.filter((p) => p.user_id === uid && p.symbol === symbol);
  const myOrders = orders.filter((o) => o.user_id === uid && o.symbol === symbol);
  const levels: Level[] = useMemo(() => {
    const out: Level[] = [];
    for (const p of myPos) {
      const tag = `${p.side === 'long' ? 'L' : 'S'} ${p.leverage}x`;
      out.push({ price: p.entry_price, color: p.side === 'long' ? '#16c784' : '#f6465d', title: `${tag} giriş` });
      out.push({ price: p.liq_price, color: '#f6465d', title: 'Likidasyon', dashed: true });
      if (p.tp) out.push({ price: p.tp, color: '#16c784', title: 'TP', dashed: true });
      if (p.sl) out.push({ price: p.sl, color: '#f5a524', title: 'SL', dashed: true });
    }
    for (const o of myOrders) out.push({ price: o.price, color: '#8b7cff', title: `Limit ${o.side === 'long' ? 'L' : 'S'}`, dashed: true });
    return out;
  }, [myPos, myOrders]);

  const up = (tick?.change ?? 0) >= 0;
  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start justify-between gap-3 pt-2">
        <button onClick={() => setPicker(true)} className="flex items-center gap-2.5 rounded-xl py-1 pr-2 active:bg-panel-2">
          <CoinIcon symbol={symbol} size={38} />
          <div className="text-left">
            <div className="flex items-center gap-1 font-display text-xl font-bold leading-tight">
              {symbol}
              <span className="text-dim">/USDT</span>
              <ChevronDown size={18} className="text-mute" />
            </div>
            <div className="text-xs text-dim">{COIN_BY_SYMBOL[symbol]?.name} · Vadeli · en çok {COIN_BY_SYMBOL[symbol]?.maxLev}x</div>
          </div>
        </button>
        <div className="text-right">
          <Flash value={tick?.price ?? 0} className="num block font-display text-[22px] font-bold leading-tight">
            {price(tick?.price)}
          </Flash>
          <div className={cn('num text-sm font-semibold', up ? 'text-up' : 'text-down')}>{tick ? pct(tick.change) : '—'}</div>
        </div>
      </div>

      {tick && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <MiniStat label="24s yüksek" value={price(tick.high)} />
          <MiniStat label="24s düşük" value={price(tick.low)} />
          <MiniStat label="24s hacim" value={usd(tick.quoteVol, { compact: true })} />
        </div>
      )}

      <div className="-mx-4 border-y border-line/60 bg-panel/40">
        <div className="flex items-center gap-1 px-3 pt-2">
          <div className="no-scrollbar flex flex-1 gap-1 overflow-x-auto">
            {INTERVALS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => { tap(); setIv(k); }}
                className={cn('h-8 rounded-lg px-2.5 text-xs font-semibold', interval === k ? 'bg-panel-2 text-text' : 'text-dim')}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => { tap(); setKind(kind === 'candle' ? 'line' : 'candle'); }}
            className="flex size-8 items-center justify-center rounded-lg text-mute active:bg-panel-2"
            aria-label="Grafik türü"
          >
            {kind === 'candle' ? <LineChart size={18} /> : <CandlestickChart size={18} />}
          </button>
        </div>
        <PriceChart symbol={symbol} interval={interval} kind={kind} levels={levels} height={290} />
      </div>

      <OrderPanel symbol={symbol} />

      {(myPos.length > 0 || myOrders.length > 0) && (
        <Section title={`${symbol} pozisyonların`}>
          {myPos.map((p) => (
            <PositionCard key={p.id} p={p} mine />
          ))}
          {myOrders.map((o) => (
            <OrderCard key={o.id} o={o} mine />
          ))}
        </Section>
      )}

      <CoinPicker open={picker} onClose={() => setPicker(false)} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-panel px-2.5 py-2">
      <div className="text-dim">{label}</div>
      <div className="num mt-0.5 font-semibold text-text">{value}</div>
    </div>
  );
}

const LEV_PRESETS = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125];

function OrderPanel({ symbol }: { symbol: string }) {
  const acc = useMyAccount();
  const cfg = useStore((s) => s.coins[symbol]);
  const tick = usePrices((s) => s.ticks[symbol]);
  const maxLev = cfg?.max_leverage ?? COIN_BY_SYMBOL[symbol]?.maxLev ?? 20;
  const [side, setSide] = useState<Side>('long');
  const [type, setType] = useState<'market' | 'limit'>('market');
  const [levStr, setLevStr] = useSaved<string>(`kripto-lev-${symbol}`, '10');
  const lev = Math.min(maxLev, Math.max(1, Number(levStr) || 10));
  const [marginStr, setMarginStr] = useState('');
  const [limitStr, setLimitStr] = useState('');
  const [tpsl, setTpsl] = useState(false);
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');

  // coin değişince fiyatla ilgili alanları sıfırla
  useEffect(() => {
    setLimitStr('');
    setTp('');
    setSl('');
  }, [symbol]);
  useEffect(() => {
    if (type === 'limit' && !limitStr && tick) setLimitStr(priceInput(tick.price));
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const fees = useMyFees();
  const fee = type === 'market' ? fees.taker : fees.maker;
  const balance = acc?.balance ?? 0;
  const margin = parseNum(marginStr) ?? 0;
  const limit = parseNum(limitStr);
  const ref = type === 'limit' ? limit ?? 0 : tick?.price ?? 0;
  const pv = ref > 0 && margin > 0 ? preview(side, margin, lev, ref, fee) : null;
  const tpN = tpsl ? parseNum(tp) : null;
  const slN = tpsl ? parseNum(sl) : null;

  let err: string | null = null;
  if (cfg && !cfg.active) err = 'Bu coin şu an işleme kapalı';
  else if (!tick) err = 'Fiyat bekleniyor…';
  else if (type === 'limit' && !(limit && limit > 0)) err = 'Limit fiyatı girin';
  else if (type === 'limit' && side === 'long' && limit! >= tick.price) err = 'Long limit fiyatı şu anki fiyatın altında olmalı';
  else if (type === 'limit' && side === 'short' && limit! <= tick.price) err = 'Short limit fiyatı şu anki fiyatın üstünde olmalı';
  else if (margin > 0 && margin < MIN_MARGIN) err = `En az ${MIN_MARGIN} $ marjin`;
  else if (pv && pv.cost > balance + 1e-9) err = 'Bakiye yetersiz';
  else if (pv) err = validateTpSl(side, ref, pv.liq, tpN, slN);

  const setFrac = (f: number) => {
    tap();
    const m = Math.floor(((balance * f) / (1 + lev * fee)) * 100) / 100;
    setMarginStr(m > 0 ? String(m).replace('.', ',') : '');
  };

  const submit = async () => {
    if (!pv || err) return;
    const risky = lev >= 50 || margin >= balance * 0.5;
    if (risky) {
      const ok = await confirm(
        'Yüksek riskli işlem',
        <>
          {lev}x kaldıraçla fiyat yalnızca <b className="text-down">{pct(Math.abs(pv.liq - ref) / ref, false)}</b> ters giderse pozisyon likide olur ve{' '}
          {usd(margin)} marjinin tamamı gider.
        </>,
        'Yine de aç',
        true,
      );
      if (!ok) return;
    }
    const r = await tradeApi.open({ symbol, side, leverage: lev, margin, type, price: type === 'limit' ? limit! : undefined, tp: tpN, sl: slN });
    thump();
    if (r.order) toast(`Limit emri verildi: ${symbol} ${price(r.order.price)}`);
    else toast(`${symbol} ${side === 'long' ? 'Long' : 'Short'} ${lev}x açıldı · ${price(r.price ?? ref)}`);
    setMarginStr('');
    setTp('');
    setSl('');
  };

  const levs = LEV_PRESETS.filter((x) => x <= maxLev);
  return (
    <Card className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink p-1">
        {(['long', 'short'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { tap(); setSide(s); }}
            className={cn(
              'h-10 rounded-lg text-[15px] font-bold transition-colors',
              side === s ? (s === 'long' ? 'bg-up text-ink' : 'bg-down text-white') : 'text-dim',
            )}
          >
            {s === 'long' ? 'Long (yükselir)' : 'Short (düşer)'}
          </button>
        ))}
      </div>

      <Segmented value={type} onChange={setType} items={[['market', 'Piyasa'], ['limit', 'Limit']]} />

      {type === 'limit' && (
        <div>
          <div className="mb-1.5 flex justify-between text-sm">
            <span className="font-medium text-mute">Limit fiyatı</span>
            <button className="text-xs font-semibold text-accent" onClick={() => tick && setLimitStr(priceInput(tick.price))}>
              Son fiyat
            </button>
          </div>
          <input className={inputCls} inputMode="decimal" value={limitStr} onChange={(e) => setLimitStr(e.target.value)} />
          <p className="mt-1 text-xs text-dim">
            {side === 'long' ? 'Fiyat bu seviyeye düşünce alınır.' : 'Fiyat bu seviyeye çıkınca satılır.'} Komisyon {feeLabel(fees.maker)}.
          </p>
        </div>
      )}

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-sm font-medium text-mute">Kaldıraç</span>
          <span className={cn('num font-display text-2xl font-bold', lev >= 50 ? 'text-down' : lev >= 20 ? 'text-warn' : 'text-text')}>{lev}x</span>
        </div>
        <input
          type="range"
          className="lev w-full"
          min={1}
          max={maxLev}
          value={lev}
          onChange={(e) => setLevStr(e.target.value)}
          aria-label="Kaldıraç"
        />
        <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto">
          {levs.map((x) => (
            <button
              key={x}
              onClick={() => { tap(); setLevStr(String(x)); }}
              className={cn('h-8 min-w-11 flex-1 rounded-lg text-xs font-semibold', lev === x ? 'bg-text text-ink' : 'bg-panel-2 text-mute')}
            >
              {x}x
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-sm">
          <span className="font-medium text-mute">Marjin (teminat)</span>
          <span className="num text-xs text-dim">Kullanılabilir: {usd(balance)}</span>
        </div>
        <div className="relative">
          <input className={cn(inputCls, 'pr-10 text-lg font-semibold')} inputMode="decimal" placeholder="0" value={marginStr} onChange={(e) => setMarginStr(e.target.value)} />
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-mute">$</span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {[0.1, 0.25, 0.5, 0.75, 1].map((f) => (
            <button key={f} onClick={() => setFrac(f)} className="h-8 flex-1 rounded-lg bg-panel-2 text-xs font-semibold text-mute active:bg-line">
              {f === 1 ? 'Hepsi' : `%${f * 100}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <button onClick={() => { tap(); setTpsl(!tpsl); }} className="flex w-full items-center justify-between py-1 text-sm font-medium">
          <span className="text-mute">Kâr al / Zarar durdur</span>
          <span className={cn('relative h-6 w-11 rounded-full transition-colors', tpsl ? 'bg-accent' : 'bg-panel-2')}>
            <span className={cn('absolute top-0.5 size-5 rounded-full bg-text transition-all', tpsl ? 'left-[22px]' : 'left-0.5')} />
          </span>
        </button>
        {tpsl && ref > 0 && (
          <div className="mt-3">
            <TpSlInputs side={side} entry={ref} lev={lev} margin={margin || 0} tp={tp} sl={sl} setTp={setTp} setSl={setSl} />
          </div>
        )}
      </div>

      <div className="rounded-xl bg-ink px-3.5 py-2.5">
        <Row label="Pozisyon büyüklüğü">{pv ? usd(pv.notional) : '—'}</Row>
        <Row label="Miktar">{pv ? `${fmtQty(pv.qty)} ${symbol}` : '—'}</Row>
        <Row
          label={
            <>
              Komisyon ({feeLabel(fee)})
              {fees.discount > 0 && <span className="ml-1 text-[11px] font-semibold text-accent">seviye indirimi %{Math.round(fees.discount * 100)}</span>}
            </>
          }
        >
          {pv ? usd(pv.fee) : '—'}
        </Row>
        <Row label="Likidasyon fiyatı">
          {pv ? (
            <span className="text-down">
              {price(pv.liq)} <span className="text-dim">({pct(Math.abs(pv.liq - ref) / ref, false)})</span>
            </span>
          ) : (
            '—'
          )}
        </Row>
        <Row label="Toplam maliyet">{pv ? usd(pv.cost) : '—'}</Row>
      </div>

      {margin > 0 && err && <p className="rounded-xl bg-down/15 px-3.5 py-2.5 text-sm text-down">{err}</p>}

      <Button size="lg" variant={side === 'long' ? 'up' : 'down'} className="w-full text-base" disabled={!pv || !!err} onClick={submit}>
        {type === 'limit' ? 'Limit emri ver · ' : ''}
        {side === 'long' ? 'Long' : 'Short'} {lev}x {pv ? `· ${usd(margin)}` : ''}
      </Button>
    </Card>
  );
}

export function CoinPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setSymbol = useStore((s) => s.setSymbol);
  const ticks = usePrices((s) => s.ticks);
  const [q, setQ] = useState('');
  const list = COINS.filter((c) => !q || c.symbol.toLowerCase().includes(q.toLowerCase()) || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open={open} onClose={onClose} title="Coin seç">
      <div className="relative mb-3">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input className={cn(inputCls, 'pl-10')} placeholder="Ara" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="divide-y divide-line/50">
        {list.map((c) => {
          const t = ticks[c.symbol];
          return (
            <button
              key={c.symbol}
              onClick={() => { tap(); setSymbol(c.symbol); onClose(); }}
              className="flex w-full items-center gap-3 py-2.5 text-left active:bg-panel-2"
            >
              <CoinIcon symbol={c.symbol} size={32} />
              <div className="flex-1">
                <div className="font-semibold">{c.symbol}</div>
                <div className="text-xs text-dim">{c.name}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm font-semibold">{price(t?.price)}</div>
                <div className={cn('num text-xs font-semibold', (t?.change ?? 0) >= 0 ? 'text-up' : 'text-down')}>{t ? pct(t.change) : ''}</div>
              </div>
            </button>
          );
        })}
        {!list.length && <Empty title="Bulunamadı" />}
      </div>
    </Sheet>
  );
}
