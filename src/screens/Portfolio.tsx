import { LifeBuoy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BAILOUT_AMOUNT, BAILOUT_BELOW } from '../../supabase/functions/_shared/engine.ts';
import { useMyAccount } from '../lib/calc';
import { pct, usd, when } from '../lib/format';
import { cheer } from '../lib/native';
import { tradeApi, rpcAfter, useStore } from '../lib/store';
import { Pnl, pnlColor, Stat } from '../ui/bits';
import { Button, Card, Empty, Segmented, cn, confirm, toast } from '../ui/kit';
import { HistoryList, OrderCard, PositionCard } from '../ui/positions';

type Tab = 'positions' | 'orders' | 'history' | 'txs';

export function PortfolioScreen({ onTrade }: { onTrade: () => void }) {
  const acc = useMyAccount();
  const me = useStore((s) => s.me)!;
  const uid = useStore((s) => s.uid);
  const allPositions = useStore((s) => s.positions);
  const allOrders = useStore((s) => s.orders);
  const positions = useMemo(() => allPositions.filter((p) => p.user_id === uid), [allPositions, uid]);
  const orders = useMemo(() => allOrders.filter((o) => o.user_id === uid), [allOrders, uid]);
  const [tab, setTab] = useState<Tab>('positions');
  if (!acc || !uid) return null;

  const closeAll = async () => {
    if (!(await confirm('Tümünü kapat', `${positions.length} açık pozisyonun hepsi piyasa fiyatından kapatılacak.`, 'Hepsini kapat', true))) return;
    let total = 0;
    for (const p of positions) {
      const r = await tradeApi.close(p.id, 1).catch(() => null);
      if (r) total += r.pnl;
    }
    toast(`Pozisyonlar kapatıldı: ${usd(total, { sign: true })}`);
  };

  const canBailout = me.balance < BAILOUT_BELOW && acc.openCount === 0 && orders.length === 0;
  return (
    <div className="space-y-4 pb-4 pt-2">
      <h1 className="font-display text-[26px] font-bold leading-tight">Portföy</h1>

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-accent/15 blur-3xl" />
        <div className="text-sm text-mute">Toplam varlık</div>
        <div className="num mt-0.5 font-display text-[34px] font-bold leading-tight">{usd(acc.equity)}</div>
        <div className="mt-1 text-sm">
          <span className="text-dim">Toplam kâr/zarar </span>
          <Pnl value={acc.net} roe={acc.roi} />
        </div>
        <EquityChart current={acc.equity} />
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line/60 pt-3">
          <Stat label="Kullanılabilir">{usd(acc.balance)}</Stat>
          <Stat label="Gerçekleşmemiş K/Z">
            <span className={pnlColor(acc.upnl)}>{usd(acc.upnl, { sign: true })}</span>
          </Stat>
          <Stat label="Kullanılan marjin">{usd(acc.marginUsed)}</Stat>
          <Stat label="Emirlerde bekleyen">{usd(acc.reserved)}</Stat>
        </div>
      </Card>

      {canBailout && (
        <Card className="flex items-center gap-3 border-warn/40">
          <LifeBuoy className="shrink-0 text-warn" />
          <div className="flex-1 text-sm">
            <div className="font-semibold">Kurtarma paketi hazır</div>
            <div className="text-dim">Bakiye {usd(BAILOUT_BELOW)} altında. {usd(BAILOUT_AMOUNT)} al, oyuna dön. Sermaye sayılır, sıralamada avantaj sağlamaz.</div>
          </div>
          <Button
            size="sm"
            variant="gold"
            onClick={async () => {
              await rpcAfter('claim_bailout');
              cheer();
              toast(`${usd(BAILOUT_AMOUNT)} hesabına eklendi`);
            }}
          >
            Al
          </Button>
        </Card>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        items={[
          ['positions', `Pozisyon${positions.length ? ` (${positions.length})` : ''}`],
          ['orders', `Emir${orders.length ? ` (${orders.length})` : ''}`],
          ['history', 'Geçmiş'],
          ['txs', 'Hareket'],
        ]}
      />

      {tab === 'positions' && (
        <div className="space-y-2.5">
          {positions.length > 1 && (
            <div className="flex justify-end">
              <Button size="sm" variant="danger" onClick={closeAll}>
                Tümünü kapat
              </Button>
            </div>
          )}
          {positions.map((p) => (
            <PositionCard key={p.id} p={p} mine />
          ))}
          {!positions.length && (
            <Empty title="Açık pozisyon yok">
              <p>Bir coin seçip long veya short açın.</p>
              <Button variant="accent" className="mt-4" onClick={onTrade}>
                İşleme git
              </Button>
            </Empty>
          )}
        </div>
      )}

      {tab === 'orders' && (
        <div className="space-y-2.5">
          {orders.map((o) => (
            <OrderCard key={o.id} o={o} mine />
          ))}
          {!orders.length && <Empty title="Bekleyen emir yok">Limit emirleri fiyat istediğiniz seviyeye gelince kendiliğinden dolar.</Empty>}
        </div>
      )}

      {tab === 'history' && <HistoryTab />}
      {tab === 'txs' && <TxList />}
    </div>
  );
}

function HistoryTab() {
  const history = useStore((s) => s.history);
  const [range, setRange] = useState<'1' | '7' | '30' | 'all'>('all');
  const items = useMemo(() => {
    if (range === 'all') return history;
    const since = Date.now() - Number(range) * 86400_000;
    return history.filter((p) => Date.parse(p.closed_at!) >= since);
  }, [history, range]);
  const net = items.reduce((a, p) => a + (p.pnl ?? 0), 0);
  const wins = items.filter((p) => (p.pnl ?? 0) > 0).length;
  return (
    <div className="space-y-3">
      <Segmented value={range} onChange={setRange} items={[['1', 'Bugün'], ['7', '7 gün'], ['30', '30 gün'], ['all', 'Tümü']]} />
      {items.length > 0 && (
        <Card className="grid grid-cols-3 gap-3 p-3.5">
          <Stat label="Net K/Z">
            <span className={pnlColor(net)}>{usd(net, { sign: true, compact: true })}</span>
          </Stat>
          <Stat label="İşlem">{items.length}</Stat>
          <Stat label="Kazanma">{pct(wins / items.length, false, 0)}</Stat>
        </Card>
      )}
      <HistoryList items={items} empty={<Empty title="Henüz kapanmış işlem yok" />} />
      {items.length > 0 && <p className="text-center text-xs text-dim">Bir işleme dokunarak kâr kartını paylaşabilirsiniz.</p>}
    </div>
  );
}

const TX_LABEL: Record<string, string> = {
  signup: 'Başlangıç',
  admin: 'Admin',
  bailout: 'Kurtarma',
  open: 'Pozisyon açıldı',
  close: 'Pozisyon kapandı',
  order: 'Limit emri',
  order_cancel: 'Emir iptali',
};

function TxList() {
  const txs = useStore((s) => s.txs);
  if (!txs.length) return <Empty title="Hareket yok" />;
  return (
    <div className="divide-y divide-line/50">
      {txs.map((t) => (
        <div key={t.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.note || TX_LABEL[t.kind] || t.kind}</div>
            <div className="text-xs text-dim">
              {TX_LABEL[t.kind]} · {when(t.created_at)}
            </div>
          </div>
          <div className="text-right">
            <div className={cn('num text-sm font-semibold', pnlColor(t.amount))}>{usd(t.amount, { sign: true })}</div>
            <div className="num text-[11px] text-dim">{usd(t.balance_after)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Saatlik varlık kayıtlarından küçük alan grafiği */
function EquityChart({ current }: { current: number }) {
  const snaps = useStore((s) => s.snapshots);
  const [range, setRange] = useState<'1' | '7' | '30' | '90'>('7');
  const pts = useMemo(() => {
    const since = Date.now() - Number(range) * 86400_000;
    const p = snaps.filter((s) => Date.parse(s.at) >= since).map((s) => ({ t: Date.parse(s.at), v: s.equity }));
    p.push({ t: Date.now(), v: current });
    return p;
  }, [snaps, range, current]);
  const W = 320;
  const H = 90;
  if (pts.length < 3) {
    return <p className="mt-3 rounded-xl bg-ink/60 px-3 py-3 text-xs text-dim">Varlık grafiği saatlik kayıtlarla dolacak.</p>;
  }
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const r = max - min || 1;
  const xy = pts.map((p) => [((p.t - t0) / (t1 - t0 || 1)) * W, H - 6 - ((p.v - min) / r) * (H - 12)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1].v >= pts[0].v;
  const col = up ? '#16c784' : '#f6465d';
  const change = pts[0].v > 0 ? pts[pts.length - 1].v / pts[0].v - 1 : 0;
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[90px] w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="eqg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={col} stopOpacity="0.3" />
            <stop offset="1" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#eqg)" />
        <path d={line} fill="none" stroke={col} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex items-center justify-between">
        <span className={cn('num text-xs font-semibold', up ? 'text-up' : 'text-down')}>{pct(change)}</span>
        <div className="flex gap-1">
          {(['1', '7', '30', '90'] as const).map((k) => (
            <button key={k} onClick={() => setRange(k)} className={cn('h-7 rounded-md px-2 text-[11px] font-semibold', range === k ? 'bg-panel-2 text-text' : 'text-dim')}>
              {k === '1' ? '24s' : `${k}g`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
