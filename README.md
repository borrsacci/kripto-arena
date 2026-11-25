# Kripto Arena

Gerçek kripto fiyatlarıyla, sanal parayla kaldıraçlı long/short işlem yarışması. Android uygulaması (APK) olarak çalışır; veriler ücretsiz bir Supabase sunucusunda tutulur, herkes aynı sıralamada yarışır.

## Neler var

- **16 coin, canlı fiyat**: BTC, ETH, SOL, BNB, XRP, DOGE, ADA, AVAX, LINK, TRX, TON, SUI, LTC, DOT, PEPE, SHIB. Fiyatlar Binance'in herkese açık piyasa akışından saniyelik gelir; bağlantı koparsa REST'e, o da olmazsa OKX'e geçer.
- **Grafik**: Mum veya çizgi grafik, hacim, 1 dk – 1 gün aralıkları. Açık pozisyonun giriş, likidasyon, TP, SL ve bekleyen limit emir seviyeleri grafikte çizgi olarak görünür.
- **Kaldıraçlı işlem (izole marjin)**: Long / short, 1x – 125x (coine göre üst sınır), piyasa ve limit emri, kâr al (TP) / zarar durdur (SL), kısmi kapatma (%25 / %50 / %75), tümünü kapat. Komisyon piyasa emrinde %0,05, limit emrinde %0,02. Bakım marjini %0,5.
- **Likidasyon ve tetikler sunucuda**: Fiyatı sunucu alır, kimse uydurma fiyattan işlem yapamaz. Açık pozisyonlar ve limit emirler, son kontrolden bu yana gelen **saniyelik mumlarla** taranır. Uygulama kapalıyken bile likidasyon, TP ve SL doğru anda ve doğru fiyattan gerçekleşir. Aynı mumda hem TP hem SL'ye değildiyse mumun yönüne göre sıra belirlenir; fiyat seviyenin ötesinde açıldıysa (boşluk) gerçekçi olarak açılış fiyatından kapanır.
- **Sanal para**: Herkes 10.000 $ ile başlar. Bakiye 500 $ altına düşer ve açık işlem yoksa günde bir 5.000 $ kurtarma paketi alınabilir. Admin herkese veya tek kişiye bakiye verebilir. Verilen her para "sermaye" sayılır; **toplam kâr = varlık − sermaye** olduğu için sıralamada avantaj sağlamaz.
- **Sıralama**: Toplam kâr, getiri %, bu hafta, bugün ve seviye. Açık pozisyonlar canlı fiyattan hesaplanır. Bir oyuncuya dokununca istatistikleri, açık pozisyonları, başarımları ve son işlemleri açılır. Piyasa ekranında "Arenada şu an" kimin ne açtığını gösterir.
- **Seviye ve lig**: XP; işlem kapatmaktan (kârlıysa daha çok, günde en çok 400), başarımlardan ve günlük ödülden gelir. Ligler: Çaylak, Bronz, Gümüş, Altın, Platin, Elmas, Usta, Efsane.
- **36 başarım**: İlk adım, Kamikaze (100x), Roket (%500 ROE), Durdurulamaz (10 seri), Balina (10 milyon $ hacim), Elmas Eller, Tetikçi, Küllerinden, Gece Kuşu… Kazanılınca kutlama ekranı çıkar.
- **Günlük ödül**: Üst üste gelinen günlerde artan XP; 7. gün "Sadık" başarımı.
- **Kâr kartı**: Açık veya kapanmış her işlem için paylaşılabilir görsel (WhatsApp vb.).
- **Varlık grafiği**: Saatlik kayıtlarla portföy değerinin 24 saat / 7 / 30 / 90 günlük grafiği.

## Kurulum (bir kez, ~15 dakika)

Langırt Ligi ile aynı yöntem. Bu uygulama için **ayrı bir Supabase projesi** açın (ücretsiz planda 2 proje hakkı var).

### 1. Supabase projesi

1. [supabase.com](https://supabase.com)'da **New project** oluşturun. Bölge: **Frankfurt (eu-central-1)**. Veritabanı şifresini not edin.
2. **Authentication → Sign In / Providers → Email** altında **Confirm email**'i kapatın.
3. Proje kimliğini not edin (`https://BURASI.supabase.co`).
4. **Account → Access Tokens** ile erişim anahtarı oluşturun (langırt için oluşturduğunuzu da kullanabilirsiniz).

Zamanlayıcı (pg_cron) ve sunucu istekleri (pg_net) eklentileri veritabanı güncellemesiyle kendiliğinden açılır.

### 2. GitHub ayarları

Repo sayfasında **Settings → Secrets and variables → Actions** ile ekleyin:

| Ad | Değer |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | erişim anahtarı |
| `SUPABASE_PROJECT_REF` | proje kimliği |
| `SUPABASE_DB_PASSWORD` | veritabanı şifresi |

Sonra **Actions → Yayınla → Run workflow**. Testler çalışır, veritabanı ve sunucu fonksiyonları yüklenir, APK derlenir ve şu sabit linke konur:

```
https://PROJE_KIMLIGI.supabase.co/storage/v1/object/public/app/kripto-arena.apk
```

Sonraki sürümlerde uygulama "Yeni sürüm hazır" diye kendisi haber verir. iPhone için web sürümü isteğe bağlıdır: `CLOUDFLARE_ACCOUNT_ID` ve `CLOUDFLARE_API_TOKEN` eklenirse `https://kripto-arena.pages.dev` adresinde yayınlanır (Safari → Paylaş → Ana Ekrana Ekle).

### 3. İlk açılış

İlk hesap açan **admin** olur. Kayıt olan herkes onay beklemeden 10.000 $ ile başlar. Admin, **Profil → Admin paneli**'nden bakiye verebilir, şifre sıfırlayabilir, hesap kapatabilir, coinleri işleme açıp kapatabilir.

## Bilinmesi gerekenler

- **Tetik kontrolü**: Sunucu her 30 saniyede herkesin pozisyonlarını tarar; ayrıca her işlemden önce ve uygulama açıkken dakikada bir kullanıcının kendi pozisyonları taranır. Tarama saniyelik mumlarla geriye dönük yapıldığından gecikme sonucu değiştirmez.
- **Zamanlayıcı adresi**: Uygulamada ilk işlem yapıldığında sunucu kendi adresini veritabanına yazar; zamanlayıcı ondan sonra çalışmaya başlar.
- **Fiyat kaynağı**: Binance spot USDT pariteleri (`data-api.binance.vision`, sadece piyasa verisi; hesap gerektirmez). Grafik kütüphanesi TradingView'in açık kaynak Lightweight Charts'ıdır.
- **Ücretsiz plan**: Supabase projesi 7 gün kullanılmazsa uykuya geçer; panelden **Restore** demek yeterli.
- **APK imzası**: Tüm derlemeler `android/app/kriptoarena.keystore` ile imzalanır (sadece ofis içi dağıtım için).
- **Admin taşıma**: Supabase SQL Editor'de `update profiles set is_admin = false; update profiles set is_admin = true where username = 'yeni_admin';`

## Geliştirme

```bash
npm install
cp .env.example .env.local      # Supabase URL ve anon key
npm run dev                     # http://localhost:3000
npm test                        # motor testleri
PGTEST_HOST=/tmp PGTEST_PORT=5432 npm test   # + veritabanı testleri (yerel Postgres)
```

Klasörler:

- `supabase/functions/_shared`: İşlem motoru (likidasyon, PnL, mum taraması), coin listesi, başarım tanımları, piyasa verisi. Uygulama ve sunucu aynı kodu kullanır.
- `supabase/migrations`: Veritabanı, güvenlik kuralları, tüm para işlemleri, XP ve başarım koşulları (SQL).
- `supabase/functions/trade`: İşlem açma / kapama / TP-SL (fiyatı sunucu alır). `tick`: zamanlayıcı taraması ve saatlik varlık kaydı. `admin-users`: şifre sıfırlama.
- `src`: Mobil arayüz (React + Capacitor).
- `tests`: Motor testleri, gerçek Postgres üzerinde veritabanı testleri ve uçtan uca arayüz testi (`tests/e2e`: yerel Supabase taklidi + sahte piyasa).

Bu bir oyundur; yatırım tavsiyesi değildir.
