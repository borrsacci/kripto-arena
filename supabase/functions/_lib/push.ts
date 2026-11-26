// Telefon bildirimi gönderimi: Firebase Cloud Messaging (HTTP v1).
// FCM_SERVICE_ACCOUNT_B64 sunucu sırrı yoksa sessizce hiçbir şey yapmaz.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let account: ServiceAccount | null | undefined;
function loadAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const b64 = Deno.env.get('FCM_SERVICE_ACCOUNT_B64');
  try {
    account = b64 ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) : null;
  } catch {
    account = null;
  }
  return account ?? null;
}

export const pushConfigured = () => loadAccount() !== null;

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let cached: { token: string; exp: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claim}`)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${b64url(sig)}` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`FCM yetkilendirme: ${JSON.stringify(j)}`);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export interface PushMessage {
  title: string;
  body: string;
  /** uygulama bildirime dokununca hangi sekmeyi açsın */
  tab?: string;
}

/** Kullanıcının tüm telefonlarına bildirim gönderir; hata işlemi durdurmaz */
export async function notifyUser(db: SupabaseClient, userId: string, msg: PushMessage): Promise<void> {
  const sa = loadAccount();
  if (!sa) return;
  try {
    const { data: prof } = await db.from('profiles').select('push_enabled').eq('id', userId).maybeSingle();
    if (!prof?.push_enabled) return;
    const { data: tokens } = await db.from('push_tokens').select('token').eq('user_id', userId);
    if (!tokens?.length) return;
    const at = await accessToken(sa);
    await Promise.all(tokens.map(async ({ token }) => {
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: { tab: msg.tab ?? 'portfolio' },
            android: { priority: 'high', notification: { channel_id: 'trades', sound: 'default', icon: 'ic_stat_notify', color: '#8B7CFF' } },
          },
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        // telefon uygulamayı kaldırmış veya anahtar yenilenmiş: kaydı sil
        if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(t)) await db.from('push_tokens').delete().eq('token', token);
        else console.error('FCM', r.status, t);
      }
    }));
  } catch (e) {
    console.error('Bildirim gönderilemedi', e);
  }
}

// ---------- Metinler ----------
const nf = (d: number) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const priceDigits = (p: number) => (p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : p >= 0.0001 ? 7 : 9);
export const fmtPrice = (p: number) => nf(priceDigits(p)).format(p);
export const fmtUsd = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${nf(2).format(Math.abs(n))}`;
export const fmtPct = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}%${nf(1).format(Math.abs(x * 100))}`;
const sideTr = (s: string) => (s === 'long' ? 'Long' : 'Short');

export function closedMessage(p: { symbol: string; side: string; leverage: number; close_reason: string; close_price: number; pnl: number; roe: number }): PushMessage {
  const head = `${p.symbol} ${sideTr(p.side)} ${p.leverage}x`;
  if (p.close_reason === 'liq') return { title: `${head} likide oldu`, body: `Fiyat ${fmtPrice(p.close_price)} oldu, marjinin tamamı gitti (${fmtUsd(p.pnl)}).` };
  if (p.close_reason === 'tp') return { title: `${head} kâr alındı`, body: `${fmtPrice(p.close_price)} fiyattan kapandı: ${fmtUsd(p.pnl)} (${fmtPct(p.roe)})` };
  return { title: `${head} zarar durduruldu`, body: `${fmtPrice(p.close_price)} fiyattan kapandı: ${fmtUsd(p.pnl)} (${fmtPct(p.roe)})` };
}

export function filledMessage(p: { symbol: string; side: string; leverage: number; entry_price: number; margin: number }): PushMessage {
  return { title: 'Limit emrin doldu', body: `${p.symbol} ${sideTr(p.side)} ${p.leverage}x, ${fmtPrice(p.entry_price)} fiyattan açıldı (${fmtUsd(p.margin).replace('+', '')} marjin).` };
}
