// Fiyat grafiği: mum veya çizgi, hacim, canlı güncelleme ve açık pozisyon / emir seviyeleri
import {
  AreaSeries, CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, type IChartApi, type IPriceLine,
  type ISeriesApi, LineStyle, type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { price as fmtPrice, priceDigits } from '../lib/format';
import { fetchKlines, type Kline, streamKline } from '../lib/prices';
import { Spinner, cn } from './kit';

export const INTERVALS = [
  ['1m', '1dk'],
  ['5m', '5dk'],
  ['15m', '15dk'],
  ['1h', '1sa'],
  ['4h', '4sa'],
  ['1d', '1g'],
] as const;
export type Interval = (typeof INTERVALS)[number][0];

export interface Level {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

const C = { up: '#16c784', down: '#f6465d', grid: '#1a2030', text: '#9aa3b5', line: '#262d3d', accent: '#8b7cff' };

export function PriceChart({ symbol, interval, kind, levels, height = 300 }: { symbol: string; interval: Interval; kind: 'candle' | 'line'; levels: Level[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const main = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const vol = useRef<ISeriesApi<'Histogram'> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  // grafik bir kez kurulur
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: C.text, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: {
        locale: 'tr-TR',
        priceFormatter: (p: number) => fmtPrice(p),
        timeFormatter: (t: number) => new Date(t * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      main.current = null;
      vol.current = null;
      lines.current = [];
    };
  }, []);

  // coin / aralık / tür değişince veri yeniden yüklenir
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    let cancelled = false;
    let stop = () => {};
    if (main.current) c.removeSeries(main.current);
    if (vol.current) c.removeSeries(vol.current);
    lines.current = [];
    const series =
      kind === 'candle'
        ? c.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down })
        : c.addSeries(AreaSeries, { lineColor: C.accent, topColor: 'rgba(139,124,255,0.28)', bottomColor: 'rgba(139,124,255,0)', lineWidth: 2 });
    const v = c.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    main.current = series;
    vol.current = v;
    setState('loading');

    const toMain = (k: Kline) => (kind === 'candle' ? { time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close } : { time: k.time as UTCTimestamp, value: k.close });
    const toVol = (k: Kline) => ({ time: k.time as UTCTimestamp, value: k.volume, color: k.close >= k.open ? 'rgba(22,199,132,0.35)' : 'rgba(246,70,93,0.35)' });

    fetchKlines(symbol, interval, 500)
      .then((ks) => {
        if (cancelled || !ks.length) return;
        const d = priceDigits(ks[ks.length - 1].close);
        series.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / 10 ** d } });
        series.setData(ks.map(toMain) as any);
        v.setData(ks.map(toVol));
        c.timeScale().fitContent();
        c.timeScale().scrollToRealTime();
        setState('ok');
        stop = streamKline(symbol, interval, (k) => {
          if (cancelled) return;
          try {
            series.update(toMain(k) as any);
            v.update(toVol(k));
          } catch {
            /* sıra dışı mum: yok say */
          }
        });
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
      stop();
    };
  }, [symbol, interval, kind]);

  // pozisyon / emir seviyeleri
  const key = JSON.stringify(levels);
  useEffect(() => {
    const s = main.current;
    if (!s) return;
    for (const l of lines.current) s.removePriceLine(l);
    lines.current = levels.map((l) =>
      s.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.title }),
    );
  }, [key, state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative" style={{ height }}>
      <div ref={box} className="absolute inset-0" />
      {state !== 'ok' && (
        <div className={cn('absolute inset-0 flex items-center justify-center text-sm', state === 'error' ? 'text-down' : 'text-dim')}>
          {state === 'loading' ? <Spinner className="size-5" /> : 'Grafik yüklenemedi. İnternet bağlantınızı kontrol edin.'}
        </div>
      )}
    </div>
  );
}
