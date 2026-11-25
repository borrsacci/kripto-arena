// Uçtan uca arayüz testi: gerçek tarayıcı, yerel Supabase taklidi, gerçek sunucu fonksiyonları ve sahte piyasa.
// Önkoşul: Postgres (e2e veritabanı), fake-market.mjs, mini-supabase.mjs, fonksiyonlar ve vite çalışıyor olmalı.
import { chromium } from 'playwright-core';

const APP = 'http://127.0.0.1:3000';
const MARKET = 'http://127.0.0.1:54500';
const SHOTS = process.env.SHOTS ?? '/tmp/shots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const errors = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function user() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'tr-TR' });
  const page = await ctx.newPage();
  // Binance istekleri sahte piyasaya yönlendirilir
  await page.route(/https:\/\/(data-api\.binance\.vision|api\.binance\.com|www\.okx\.com)\/.*/, async (route) => {
    const u = new URL(route.request().url());
    const r = await fetch(MARKET + u.pathname + u.search).catch(() => null);
    if (!r) return route.abort();
    route.fulfill({ status: r.status, contentType: 'application/json', body: await r.text(), headers: { 'access-control-allow-origin': '*' } });
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|realtime|ERR_|Failed to load resource|net::/.test(m.text()) && errors.push(`console: ${m.text()}`));
  await page.goto(APP);
  return page;
}
let n = 0;
const shot = (page, name, full = false) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: full });
const btn = (page, text, exact = false) => page.getByRole('button', { name: text, exact }).last();
const tab = async (page, name) => {
  await dismiss(page);
  await page.locator('nav').getByRole('button', { name }).click();
  await wait(500);
};
const toast = (page, re) => page.getByText(re).first().waitFor({ timeout: 10000 });
/** açık başarım kutlamalarını kapatır */
async function dismiss(page) {
  for (let i = 0; i < 10; i++) {
    await wait(350);
    const b = page.getByRole('button', { name: 'Harika', exact: true });
    if (!(await b.isVisible().catch(() => false))) return;
    await b.click();
  }
}
const top = (page) => page.evaluate(() => document.getElementById('main')?.scrollTo({ top: 0 }));

async function register(page, username, name) {
  await btn(page, 'Hesap aç').first().click();
  await page.getByLabel('Kullanıcı adı').fill(username);
  await page.getByLabel('Adınız').fill(name);
  await page.getByLabel('Şifre', { exact: true }).fill('sifre123');
  await page.getByLabel('Şifre tekrar').fill('sifre123');
  await btn(page, 'Hesap aç').click();
  await page.getByText('Piyasa', { exact: true }).first().waitFor();
}

async function openTrade(page, { coin, side, lev, margin, tp, limit }) {
  await tab(page, 'Piyasa');
  await page.getByRole('button', { name: new RegExp(`^${coin}\\b`) }).first().click();
  await page.getByText('Kaldıraç').first().waitFor();
  await btn(page, side === 'long' ? 'Long (yükselir)' : 'Short (düşer)').click();
  if (limit) {
    await btn(page, 'Limit', true).click();
    await page.locator('input[inputmode=decimal]').first().fill(String(limit).replace('.', ','));
  }
  await page.locator('input[type=range]').fill(String(lev));
  await page.getByPlaceholder('0', { exact: true }).fill(String(margin));
  if (tp) {
    await page.getByRole('button', { name: /Kâr al \/ Zarar durdur/ }).click();
    await btn(page, tp).first().click(); // ROE kısayolu
  }
}

try {
  const okan = await user();
  await page0(okan);
  async function page0(p) {
    await p.getByText('Kripto Arena').first().waitFor();
    await shot(p, 'giris');
  }
  await register(okan, 'okan', 'Okan');
  await okan.getByText(/coin yükselişte/).waitFor({ timeout: 15000 });
  await wait(1500);
  await shot(okan, 'piyasa');

  // 1) BTC long 20x, 1.000 $ + TP %50
  await openTrade(okan, { coin: 'BTC', side: 'long', lev: 20, margin: 1000, tp: '+%50' });
  await wait(1500);
  await shot(okan, 'islem-paneli');
  await top(okan);
  await wait(300);
  await shot(okan, 'islem-grafik');
  await btn(okan, /^Long 20x/).click();
  await toast(okan, /BTC Long 20x açıldı/);
  await wait(1200);
  await shot(okan, 'basarim');
  await dismiss(okan);

  // 2) Limit emri: SOL long, fiyatın %1 altı
  const sol = await (await fetch(`${MARKET}/api/v3/ticker/price?symbol=SOLUSDT`)).json();
  await openTrade(okan, { coin: 'SOL', side: 'long', lev: 5, margin: 500, limit: (Number(sol.price) * 0.99).toFixed(2) });
  await dismiss(okan);
  await btn(okan, /Limit emri ver/).click();
  await toast(okan, /Limit emri verildi/);

  // 3) Portföy
  await tab(okan, 'Portföy');
  await okan.getByText('Toplam varlık').waitFor();
  await wait(800);
  await shot(okan, 'portfoy');
  await btn(okan, /^Emir/).click();
  await wait(400);
  await shot(okan, 'emirler');

  // 4) İkinci oyuncu: ETH short 50x (riskli işlem onayı)
  const caner = await user();
  await register(caner, 'caner', 'Caner');
  await openTrade(caner, { coin: 'ETH', side: 'short', lev: 50, margin: 2000 });
  await dismiss(caner);
  await btn(caner, /^Short 50x/).click();
  await caner.getByText('Yüksek riskli işlem').waitFor();
  await shot(caner, 'riskli-islem-onayi');
  await btn(caner, 'Yine de aç', true).click();
  await toast(caner, /ETH Short 50x açıldı/);

  // 5) Fiyat şoku: ETH %3 yukarı (50x short likide olur), BTC %3 yukarı (20x long TP %50'ye ulaşır), SOL %2 aşağı (limit dolar)
  await wait(1500);
  for (const [s, f] of [['ETH', 1.03], ['BTC', 1.03], ['SOL', 0.98]]) await fetch(`${MARKET}/shock?symbol=${s}&factor=${f}`);
  await wait(2500);
  // sunucu zamanlayıcısı yerine kullanıcı senkronu (uygulama açılışta ve dakikada bir yapar)
  await caner.evaluate(() => window.dispatchEvent(new Event('focus')));
  await tab(caner, 'Portföy');
  await caner.reload();
  await caner.getByText(/likide oldu/).first().waitFor({ timeout: 15000 });
  await shot(caner, 'likidasyon-bildirimi');
  await caner.getByText('Başarım açıldı').waitFor({ timeout: 10000 });
  await shot(caner, 'basarim-kutlamasi');
  await btn(caner, 'Harika', true).click();

  await okan.reload();
  await okan.getByText(/kâr al ile kapandı|Limit emrin doldu/).first().waitFor({ timeout: 15000 });
  await shot(okan, 'tp-bildirimi');
  await dismiss(okan);
  await tab(okan, 'Portföy');
  await btn(okan, 'Geçmiş', true).click();
  await wait(600);
  await shot(okan, 'gecmis');
  await okan.locator('main button').filter({ hasText: 'BTC' }).first().click();
  await okan.getByText('Kâr kartı', { exact: true }).waitFor();
  await wait(500);
  await shot(okan, 'kar-karti');
  await okan.keyboard.press('Escape');
  await okan.mouse.click(195, 100);
  await wait(500);

  // 6) Pozisyon: TP/SL ve kapatma pencereleri
  await tab(okan, 'Portföy');
  await btn(okan, /^Pozisyon/).click();
  await wait(400);
  if (await okan.getByRole('button', { name: 'Kapat', exact: true }).first().isVisible().catch(() => false)) {
    await okan.getByRole('button', { name: 'Kapat', exact: true }).first().click();
    await wait(500);
    await shot(okan, 'kapat-penceresi');
    await btn(okan, '%50', true).click();
    await btn(okan, 'Piyasa fiyatından kapat', true).click();
    await dismiss(okan);
    await toast(okan, /%50 kapatıldı/);
  }

  // 7) Sıralama ve oyuncu profili
  await tab(okan, 'Sıralama');
  await wait(800);
  await shot(okan, 'siralama');
  await btn(okan, 'Bu hafta', true).click();
  await wait(1000);
  await shot(okan, 'siralama-hafta');
  await okan.getByText('Caner').first().click();
  await wait(1000);
  await shot(okan, 'oyuncu-profili');
  await okan.mouse.click(195, 60);
  await wait(500);

  // 8) Profil: günlük ödül, başarımlar
  await okan.keyboard.press('Escape');
  await tab(okan, 'Profil');
  await dismiss(okan);
  await btn(okan, 'Al', true).click();
  await toast(okan, /XP/);
  await wait(800);
  await shot(okan, 'profil');
  await shot(okan, 'profil-tam', true);
  await tab(okan, 'İşlem');
  await wait(1500);
  await shot(okan, 'islem-son');
} catch (e) {
  errors.push(`HATA: ${e.message}`);
  for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: `${SHOTS}/hata-${Math.random().toString(36).slice(2, 6)}.png` }).catch(() => {});
} finally {
  await browser.close();
  console.log(errors.length ? errors.join('\n') : 'Hata yok');
}
