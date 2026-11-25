// Başarımlar. Kazanılma koşulları veritabanında (SQL) kontrol edilir; XP değerleri
// `achievement_defs` tablosuyla aynı olmalı (testler kontrol eder).
export type AchTier = 'bronze' | 'silver' | 'gold' | 'legend';
export type AchGroup = 'Başlangıç' | 'Cesaret' | 'Getiri' | 'Seri' | 'Emektar' | 'Servet' | 'Strateji' | 'Özel';

export interface Achievement {
  code: string;
  title: string;
  desc: string;
  xp: number;
  tier: AchTier;
  group: AchGroup;
  icon: string; // lucide ikon adı
}

const a = (code: string, title: string, desc: string, xp: number, tier: AchTier, group: AchGroup, icon: string): Achievement => ({ code, title, desc, xp, tier, group, icon });

export const ACHIEVEMENTS: Achievement[] = [
  a('first_trade', 'İlk Adım', 'İlk pozisyonunu aç', 50, 'bronze', 'Başlangıç', 'Footprints'),
  a('first_win', 'İlk Kâr', 'Bir işlemi kârla kapat', 50, 'bronze', 'Başlangıç', 'BadgeDollarSign'),
  a('first_short', 'Ayı Modu', 'İlk short pozisyonunu aç', 30, 'bronze', 'Başlangıç', 'TrendingDown'),
  a('limit_fill', 'Sabırlı', 'Bir limit emrin dolsun', 40, 'bronze', 'Başlangıç', 'Hourglass'),

  a('lev_10', 'Cesur', '10x veya üstü kaldıraçla işlem aç', 30, 'bronze', 'Cesaret', 'Gauge'),
  a('lev_50', 'Gözü Kara', '50x veya üstü kaldıraçla işlem aç', 75, 'silver', 'Cesaret', 'Flame'),
  a('lev_100', 'Kamikaze', '100x veya üstü kaldıraçla işlem aç', 150, 'gold', 'Cesaret', 'Rocket'),
  a('all_in', 'Ya Hep Ya Hiç', 'Bakiyenin en az %90\'ını tek işleme koy', 60, 'silver', 'Cesaret', 'Dices'),
  a('liquidated', 'Likide Oldum', 'İlk likidasyonunu yaşa (olur böyle şeyler)', 25, 'bronze', 'Cesaret', 'Skull'),

  a('roe_100', 'İkiye Katla', 'Tek işlemde %100 getiri (ROE)', 100, 'silver', 'Getiri', 'ChevronsUp'),
  a('roe_500', 'Roket', 'Tek işlemde %500 getiri', 250, 'gold', 'Getiri', 'Rocket'),
  a('roe_1000', 'Aya Yolculuk', 'Tek işlemde %1000 getiri', 500, 'legend', 'Getiri', 'Moon'),
  a('big_win', 'Vurgun', 'Tek işlemde 5.000 $ net kâr', 200, 'gold', 'Getiri', 'Gem'),

  a('streak_3', 'Seri', '3 işlemi üst üste kârla kapat', 50, 'bronze', 'Seri', 'Zap'),
  a('streak_5', 'Ateşli', '5 işlemi üst üste kârla kapat', 120, 'silver', 'Seri', 'Flame'),
  a('streak_10', 'Durdurulamaz', '10 işlemi üst üste kârla kapat', 300, 'legend', 'Seri', 'Crown'),

  a('trades_10', 'Düzenli', '10 işlem kapat', 50, 'bronze', 'Emektar', 'ListChecks'),
  a('trades_100', 'Ekran Başında', '100 işlem kapat', 200, 'silver', 'Emektar', 'Monitor'),
  a('trades_500', 'Terminal', '500 işlem kapat', 500, 'gold', 'Emektar', 'Terminal'),
  a('volume_100k', 'Hacimci', 'Toplam 100.000 $ işlem hacmi', 50, 'bronze', 'Emektar', 'BarChart3'),
  a('volume_1m', 'Balina Yavrusu', 'Toplam 1 milyon $ işlem hacmi', 150, 'silver', 'Emektar', 'Fish'),
  a('volume_10m', 'Balina', 'Toplam 10 milyon $ işlem hacmi', 400, 'gold', 'Emektar', 'Ship'),
  a('daily_7', 'Sadık', '7 gün üst üste günlük ödülü al', 100, 'silver', 'Emektar', 'CalendarCheck'),

  a('profit_1k', 'Cebi Dolu', 'Toplam 1.000 $ net kâr', 75, 'bronze', 'Servet', 'Wallet'),
  a('profit_10k', 'Kâr Makinesi', 'Toplam 10.000 $ net kâr', 200, 'silver', 'Servet', 'Coins'),
  a('profit_100k', 'Kurt', 'Toplam 100.000 $ net kâr', 600, 'legend', 'Servet', 'Trophy'),
  a('double_up', 'Katlayan', 'Toplam kârın, sana verilen sermayeyi geçsin', 300, 'gold', 'Servet', 'Copy'),

  a('tp_hit', 'Planlı', 'Kâr al (TP) emrinle kapanan bir işlem', 40, 'bronze', 'Strateji', 'Target'),
  a('sl_hit', 'Disiplin', 'Zarar durdur (SL) ile zararı kes', 40, 'bronze', 'Strateji', 'ShieldCheck'),
  a('scalper', 'Tetikçi', 'Bir işlemi 60 saniye içinde kârla kapat', 60, 'silver', 'Strateji', 'Timer'),
  a('diamond', 'Elmas Eller', 'Bir işlemi 24 saat tutup kârla kapat', 100, 'silver', 'Strateji', 'Diamond'),
  a('hedge', 'Çift Taraflı', 'Aynı coinde aynı anda hem long hem short aç', 30, 'bronze', 'Strateji', 'ArrowLeftRight'),
  a('coins_5', 'Çeşitlendir', '5 farklı coinde işlem aç', 50, 'bronze', 'Strateji', 'Shapes'),

  a('comeback', 'Küllerinden', 'Likide olduktan sonraki ilk kârlı işlem', 75, 'silver', 'Özel', 'Bird'),
  a('night_owl', 'Gece Kuşu', 'Gece 02:00 ile 05:00 arasında işlem aç', 30, 'bronze', 'Özel', 'MoonStar'),
  a('bailout', 'Sıfırdan', 'Kurtarma paketini al', 10, 'bronze', 'Özel', 'LifeBuoy'),
];

export const ACH_BY_CODE: Record<string, Achievement> = Object.fromEntries(ACHIEVEMENTS.map((x) => [x.code, x]));

export const TIER_COLORS: Record<AchTier, string> = {
  bronze: '#C98A5A',
  silver: '#C9D1DE',
  gold: '#F2C14E',
  legend: '#B18CFF',
};
