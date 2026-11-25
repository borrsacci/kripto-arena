import { Gift, HelpCircle, LogOut, Pencil, Shield } from 'lucide-react';
import { useMemo, useState } from 'react';
import { type Achievement, ACHIEVEMENTS, TIER_COLORS } from '../../supabase/functions/_shared/achievements.ts';
import { COINS } from '../../supabase/functions/_shared/coins.ts';
import { BAILOUT_AMOUNT, BAILOUT_BELOW, levelProgress, MMR, START_BALANCE, TIERS, tierFor } from '../../supabase/functions/_shared/engine.ts';
import { invoke } from '../lib/api';
import { useLeaderboard, useMyAccount } from '../lib/calc';
import { int, parseNum, pct, usd, when } from '../lib/format';
import { cheer } from '../lib/native';
import { rpcAfter, useStore } from '../lib/store';
import { supabase } from '../lib/supabase';
import { currentVersion } from '../lib/update';
import { AchIcon, Avatar, LevelBadge, pnlColor, Stat } from '../ui/bits';
import { Button, Card, Field, Section, Segmented, Sheet, cn, confirm, inputCls, toast } from '../ui/kit';

const trToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

export function ProfileScreen() {
  const me = useStore((s) => s.me)!;
  const acc = useMyAccount();
  const achievements = useStore((s) => s.achievements);
  const [sheet, setSheet] = useState<'name' | 'help' | 'admin' | 'tiers' | null>(null);
  const [ach, setAch] = useState<Achievement | null>(null);
  const lp = levelProgress(me.xp);
  const tier = tierFor(lp.level);
  const next = TIERS.find((t) => t.min > lp.level);
  const mine = useMemo(() => new Map(achievements.filter((a) => a.user_id === me.id).map((a) => [a.code, a.unlocked_at])), [achievements, me.id]);
  const groups = useMemo(() => {
    const g = new Map<string, Achievement[]>();
    for (const a of ACHIEVEMENTS) g.set(a.group, [...(g.get(a.group) ?? []), a]);
    return [...g];
  }, []);

  return (
    <div className="space-y-5 pb-6 pt-2">
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full blur-3xl" style={{ background: `${tier.color}33` }} />
        <div className="flex items-center gap-4">
          <Avatar name={me.display_name} xp={me.xp} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-2xl font-bold">{me.display_name}</span>
              <button onClick={() => setSheet('name')} className="text-dim" aria-label="Adı değiştir">
                <Pencil size={15} />
              </button>
            </div>
            <div className="text-sm text-dim">@{me.username}</div>
          </div>
        </div>
        <button onClick={() => setSheet('tiers')} className="mt-4 block w-full text-left">
          <div className="flex items-end justify-between">
            <div>
              <span className="font-display text-lg font-bold" style={{ color: tier.color }}>
                {tier.name}
              </span>
              <span className="ml-2 text-sm text-mute">Seviye {lp.level}</span>
            </div>
            <span className="num text-xs text-dim">
              {int(me.xp)} / {int(lp.to)} XP
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, lp.frac * 100)}%`, background: `linear-gradient(90deg, ${tier.color}99, ${tier.color})` }} />
          </div>
          {next && <div className="mt-1.5 text-xs text-dim">{next.name} ligi seviye {next.min}'da</div>}
        </button>
      </Card>

      <DailyCard />

      <Card className="grid grid-cols-3 gap-x-3 gap-y-4">
        <Stat label="Toplam K/Z">
          <span className={pnlColor(acc?.net ?? 0)}>{usd(acc?.net ?? 0, { sign: true, compact: true })}</span>
        </Stat>
        <Stat label="Getiri">
          <span className={pnlColor(acc?.roi ?? 0)}>{pct(acc?.roi ?? 0)}</span>
        </Stat>
        <Stat label="İşlem">{me.trades}</Stat>
        <Stat label="Kazanma">{me.trades ? pct(me.wins / me.trades, false, 0) : '—'}</Stat>
        <Stat label="Seri / En iyi">
          {me.streak} / {me.best_streak}
        </Stat>
        <Stat label="Likidasyon">{me.liquidations}</Stat>
        <Stat label="En iyi işlem">{usd(me.best_trade, { compact: true })}</Stat>
        <Stat label="En iyi ROE">{pct(me.best_roe)}</Stat>
        <Stat label="Hacim">{usd(me.volume, { compact: true })}</Stat>
      </Card>

      <Section
        title={
          <>
            Başarımlar{' '}
            <span className="text-sm font-medium text-dim">
              {mine.size}/{ACHIEVEMENTS.length}
            </span>
          </>
        }
      >
        <div className="h-1.5 overflow-hidden rounded-full bg-panel">
          <div className="h-full rounded-full bg-gold" style={{ width: `${(mine.size / ACHIEVEMENTS.length) * 100}%` }} />
        </div>
        {groups.map(([g, list]) => (
          <div key={g} className="pt-1">
            <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-dim">{g}</div>
            <div className="grid grid-cols-4 gap-2">
              {list.map((a) => (
                <button key={a.code} onClick={() => setAch(a)} className="flex flex-col items-center gap-1.5 rounded-xl py-2 active:bg-panel">
                  <AchIcon code={a.code} unlocked={mine.has(a.code)} />
                  <span className={cn('line-clamp-2 text-center text-[11px] font-medium leading-tight', mine.has(a.code) ? 'text-text' : 'text-dim')}>{a.title}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </Section>

      <div className="space-y-2">
        <Button className="w-full" onClick={() => setSheet('help')}>
          <HelpCircle size={18} /> Nasıl oynanır?
        </Button>
        {me.is_admin && (
          <Button className="w-full" onClick={() => setSheet('admin')}>
            <Shield size={18} /> Admin paneli
          </Button>
        )}
        <Button
          variant="quiet"
          className="w-full"
          onClick={async () => {
            if (await confirm('Çıkış yap', 'Bu cihazda oturumunuz kapanacak.', 'Çıkış yap')) await supabase.auth.signOut();
          }}
        >
          <LogOut size={18} /> Çıkış yap
        </Button>
        <p className="text-center text-xs text-dim">Kripto Arena · sürüm {currentVersion || 'geliştirme'} · gerçek para kullanılmaz</p>
      </div>

      <Sheet open={!!ach} onClose={() => setAch(null)}>
        {ach && (
          <div className="flex flex-col items-center pb-2 pt-4 text-center">
            <AchIcon code={ach.code} unlocked={mine.has(ach.code)} size={84} />
            <div className="mt-4 font-display text-2xl font-bold">{ach.title}</div>
            <div className="mt-1 text-mute">{ach.desc}</div>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="rounded-full px-2.5 py-0.5 font-semibold" style={{ color: TIER_COLORS[ach.tier], background: `${TIER_COLORS[ach.tier]}22` }}>
                +{ach.xp} XP
              </span>
              <span className="text-dim">
                {mine.has(ach.code) ? `Kazanıldı · ${when(mine.get(ach.code)!)}` : `${ownersOf(achievements, ach.code)} kişi kazandı`}
              </span>
            </div>
          </div>
        )}
      </Sheet>
      <NameSheet open={sheet === 'name'} onClose={() => setSheet(null)} />
      <HelpSheet open={sheet === 'help'} onClose={() => setSheet(null)} />
      <TiersSheet open={sheet === 'tiers'} onClose={() => setSheet(null)} level={lp.level} />
      {me.is_admin && <AdminSheet open={sheet === 'admin'} onClose={() => setSheet(null)} />}
    </div>
  );
}

const ownersOf = (rows: { code: string }[], code: string) => rows.filter((r) => r.code === code).length;

function DailyCard() {
  const me = useStore((s) => s.me)!;
  const claimed = me.last_daily === trToday();
  const yesterday = new Date(Date.now() + 3 * 3600_000 - 86400_000).toISOString().slice(0, 10);
  const streak = claimed ? me.daily_streak : me.last_daily === yesterday ? me.daily_streak : 0;
  const nextDay = claimed ? streak : streak + 1;
  return (
    <Card className="flex items-center gap-4">
      <div className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl', claimed ? 'bg-panel-2 text-dim' : 'bg-gold/20 text-gold')}>
        <Gift size={24} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{claimed ? 'Günlük ödül alındı' : 'Günlük ödül hazır'}</div>
        <div className="mt-1.5 flex gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < Math.min(streak, 7) ? 'bg-gold' : 'bg-line')} />
          ))}
        </div>
        <div className="mt-1 text-xs text-dim">
          {claimed ? `Seri: ${streak} gün · yarın tekrar gel` : `${Math.min(nextDay, 7)}. gün: +${20 + 5 * (Math.min(nextDay, 7) - 1)} XP`}
        </div>
      </div>
      {!claimed && (
        <Button
          size="sm"
          variant="gold"
          onClick={async () => {
            const r = await rpcAfter<{ xp: number; streak: number }>('claim_daily');
            cheer();
            toast(`+${r.xp} XP · ${r.streak}. gün`);
          }}
        >
          Al
        </Button>
      )}
    </Card>
  );
}

function NameSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useStore((s) => s.me)!;
  const [name, setName] = useState(me.display_name);
  return (
    <Sheet open={open} onClose={onClose} title="Adını değiştir">
      <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
      <Button
        variant="accent"
        className="mt-4 w-full"
        onClick={async () => {
          await rpcAfter('update_display_name', { p_name: name });
          toast('Kaydedildi');
          onClose();
        }}
      >
        Kaydet
      </Button>
    </Sheet>
  );
}

function TiersSheet({ open, onClose, level }: { open: boolean; onClose: () => void; level: number }) {
  return (
    <Sheet open={open} onClose={onClose} title="Ligler">
      <p className="mb-4 text-sm leading-relaxed text-mute">
        XP kazandıkça seviye atlarsın, seviyen ligini belirler. XP; işlem kapatmaktan (kârlıysa daha çok, günde en çok 400), başarımlardan ve günlük ödülden gelir.
      </p>
      <div className="space-y-1.5">
        {TIERS.map((t) => {
          const here = tierFor(level).name === t.name;
          return (
            <div key={t.name} className={cn('flex items-center justify-between rounded-xl px-3.5 py-3', here ? 'bg-panel-2' : '')} style={here ? { boxShadow: `inset 0 0 0 1px ${t.color}88` } : {}}>
              <span className="font-display text-lg font-bold" style={{ color: t.color }}>
                {t.name}
              </span>
              <span className="text-sm text-mute">
                Seviye {t.min}+{here && ' · buradasın'}
              </span>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function HelpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items: [string, string][] = [
    ['Sanal para', `Herkes ${usd(START_BALANCE)} sanal dolarla başlar. Gerçek para yoktur; fiyatlar ise gerçektir (Binance'ten canlı).`],
    ['Long ve short', 'Long: fiyat yükselirse kazanırsın. Short: fiyat düşerse kazanırsın.'],
    ['Kaldıraç', 'Marjin (teminat) olarak koyduğun parayı katlar. 1.000 $ marjin ve 10x ile 10.000 $\'lık pozisyon açarsın: fiyat %1 lehine giderse %10 kazanırsın, %1 aleyhine giderse %10 kaybedersin.'],
    ['Likidasyon', `Kayıp marjine yaklaşınca pozisyon zorla kapanır ve marjinin tamamı gider. Likidasyon fiyatı = giriş × (1 ∓ 1/kaldıraç ± %${MMR * 100}). Kaldıraç ne kadar yüksekse likidasyon o kadar yakındır.`],
    ['Komisyon', 'Piyasa emri işlem büyüklüğünün %0,05\'i, limit emri %0,02\'si. Açılışta ve kapanışta alınır.'],
    ['Limit emri', 'Fiyatı sen belirlersin; fiyat o seviyeye gelince emir kendiliğinden pozisyona dönüşür. Beklerken marjin ayrılır, iptal edersen geri gelir.'],
    ['TP ve SL', 'Kâr al (TP) ve zarar durdur (SL) seviyeleri. Fiyat değince pozisyon kapanır; uygulama kapalı olsa bile sunucu saniyelik fiyat verisiyle kontrol eder.'],
    ['Sıralama', 'Toplam kâr = şu anki varlığın − sana verilen toplam sermaye. Açık pozisyonlar canlı fiyattan hesaplanır. Haftalık sıralama her pazartesi sıfırlanır.'],
    ['Kurtarma paketi', `Bakiyen ${usd(BAILOUT_BELOW)} altına düşerse ve açık işlemin yoksa günde bir kez ${usd(BAILOUT_AMOUNT)} alabilirsin. Sermaye sayılır; toplam kârını değiştirmez.`],
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Nasıl oynanır?">
      <div className="space-y-4">
        {items.map(([t, d]) => (
          <div key={t}>
            <div className="font-semibold">{t}</div>
            <div className="mt-0.5 text-sm leading-relaxed text-mute">{d}</div>
          </div>
        ))}
        <p className="rounded-xl bg-panel-2 px-3.5 py-3 text-xs leading-relaxed text-dim">
          Bu bir oyundur ve yatırım tavsiyesi değildir. Gerçek kaldıraçlı işlemler sermayenin tamamını hızla kaybettirebilir.
        </p>
      </div>
    </Sheet>
  );
}

// ---------- Admin ----------
function AdminSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'users' | 'coins' | 'all'>('users');
  const rows = useLeaderboard();
  const allProfiles = useStore((s) => s.profiles);
  const coins = useStore((s) => s.coins);
  const [sel, setSel] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pw, setPw] = useState('');
  const target = allProfiles.find((p) => p.id === sel);
  const totalNet = rows.reduce((a, r) => a + r.account.net, 0);
  return (
    <Sheet open={open} onClose={onClose} title="Admin paneli">
      <Segmented value={tab} onChange={setTab} items={[['users', 'Kullanıcılar'], ['all', 'Herkese ver'], ['coins', 'Coinler']]} className="mb-4" />
      {tab === 'users' && (
        <div className="space-y-1">
          <p className="mb-2 text-xs text-dim">
            {allProfiles.length} hesap · oyuncuların toplam net K/Z'si <span className={pnlColor(totalNet)}>{usd(totalNet, { sign: true })}</span>
          </p>
          {allProfiles.map((p) => {
            const r = rows.find((x) => x.profile.id === p.id);
            return (
              <button key={p.id} onClick={() => setSel(p.id)} className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left active:bg-panel-2">
                <Avatar name={p.display_name} xp={p.xp} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{p.display_name}</span>
                    {p.is_admin && <span className="text-[10px] font-bold text-accent">ADMİN</span>}
                    {p.status === 'disabled' && <span className="text-[10px] font-bold text-down">KAPALI</span>}
                  </div>
                  <div className="text-xs text-dim">@{p.username}</div>
                </div>
                <div className="num text-right text-sm">
                  <div>{usd(p.balance)}</div>
                  {r && <div className={cn('text-xs', pnlColor(r.account.net))}>{usd(r.account.net, { sign: true })}</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {tab === 'all' && (
        <div className="space-y-4">
          <Field label="Tutar ($)" hint="Tüm aktif hesaplara eklenir. Sermaye sayılır; toplam kârı etkilemez.">
            <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Not">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ör. Bayram hediyesi" />
          </Field>
          <Button
            variant="accent"
            className="w-full"
            onClick={async () => {
              const a = parseNum(amount);
              if (!a || a <= 0) throw new Error('Geçerli bir tutar girin');
              const n = await rpcAfter<number>('admin_grant_all', { p_amount: a, p_note: note });
              toast(`${n} hesaba ${usd(a)} eklendi`);
              setAmount('');
            }}
          >
            Herkese ver
          </Button>
        </div>
      )}
      {tab === 'coins' && (
        <div className="space-y-1">
          {COINS.map((c) => {
            const on = coins[c.symbol]?.active ?? true;
            return (
              <div key={c.symbol} className="flex items-center justify-between py-2">
                <span className="font-semibold">
                  {c.symbol} <span className="text-xs font-normal text-dim">en çok {c.maxLev}x</span>
                </span>
                <Button size="sm" variant={on ? 'ghost' : 'danger'} onClick={() => rpcAfter('admin_set_coin', { p_symbol: c.symbol, p_active: !on })}>
                  {on ? 'Açık' : 'Kapalı'}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={!!target} onClose={() => setSel(null)} title={target?.display_name}>
        {target && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-mute">
              @{target.username} <LevelBadge xp={target.xp} /> · bakiye {usd(target.balance)} · sermaye {usd(target.deposits)}
            </div>
            <Field label="Bakiye ekle / düş ($)" hint="Eksi tutar bakiyeden düşer. Sermaye olarak sayılır.">
              <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="ör. 5000 veya -1000" />
            </Field>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Not (isteğe bağlı)" />
            <Button
              variant="accent"
              className="w-full"
              onClick={async () => {
                const a = parseNum(amount.replace(/^−/, '-'));
                if (!a) throw new Error('Geçerli bir tutar girin');
                await rpcAfter('admin_adjust_balance', { p_user: target.id, p_amount: a, p_note: note });
                toast('Bakiye güncellendi');
                setAmount('');
              }}
            >
              Uygula
            </Button>
            <Field label="Yeni şifre">
              <input className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="en az 6 karakter" />
            </Field>
            <Button
              className="w-full"
              onClick={async () => {
                await invoke('admin-users', { action: 'reset_password', user_id: target.id, password: pw });
                toast('Şifre değiştirildi');
                setPw('');
              }}
            >
              Şifreyi değiştir
            </Button>
            {!target.is_admin && (
              <Button
                variant={target.status === 'active' ? 'danger' : 'ghost'}
                className="w-full"
                onClick={async () => {
                  const s = target.status === 'active' ? 'disabled' : 'active';
                  await rpcAfter('admin_set_status', { p_user: target.id, p_status: s });
                  toast(s === 'disabled' ? 'Hesap kapatıldı' : 'Hesap açıldı');
                }}
              >
                {target.status === 'active' ? 'Hesabı kapat' : 'Hesabı aç'}
              </Button>
            )}
          </div>
        )}
      </Sheet>
    </Sheet>
  );
}
