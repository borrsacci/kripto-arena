// Telefon bildirimleri: izin iste, cihaz anahtarını sunucuya kaydet, bildirime dokununca ilgili sekmeyi aç.
// Firebase ayarı (google-services.json) olmadan derlenen APK'da hiç çalıştırılmaz; aksi halde uygulama çöker.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from './supabase';

export const pushAvailable = Capacitor.isNativePlatform() && import.meta.env.VITE_PUSH === '1';

let token: string | null = null;
let listenersAdded = false;
let onOpenTab: ((tab: string) => void) | null = null;

export function onPushOpen(fn: (tab: string) => void) {
  onOpenTab = fn;
}

async function addListeners() {
  if (listenersAdded) return;
  listenersAdded = true;
  await PushNotifications.addListener('registration', async (t) => {
    token = t.value;
    await supabase.rpc('register_push_token', { p_token: t.value });
  });
  await PushNotifications.addListener('registrationError', (e) => console.warn('Bildirim kaydı başarısız', e));
  await PushNotifications.addListener('pushNotificationActionPerformed', (a) => {
    const tab = (a.notification.data as { tab?: string } | undefined)?.tab;
    if (tab) onOpenTab?.(tab);
  });
}

/** Girişten sonra çağrılır. İzin verilmediyse sessizce vazgeçer. */
export async function setupPush(): Promise<'ok' | 'denied' | 'unavailable'> {
  if (!pushAvailable) return 'unavailable';
  try {
    await addListeners();
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return 'denied';
    await PushNotifications.createChannel({
      id: 'trades',
      name: 'İşlemler',
      description: 'Limit emri doldu, kâr al, zarar durdur ve likidasyon bildirimleri',
      importance: 4,
      visibility: 1,
      vibration: true,
    });
    await PushNotifications.register();
    return 'ok';
  } catch (e) {
    console.warn('Bildirim ayarlanamadı', e);
    return 'unavailable';
  }
}

/** Çıkış yaparken: bu telefona artık bu hesabın bildirimi gelmesin */
export async function forgetPush() {
  if (!pushAvailable || !token) return;
  await supabase.rpc('unregister_push_token', { p_token: token });
}

export async function pushPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
  if (!pushAvailable) return 'unavailable';
  const p = await PushNotifications.checkPermissions();
  return p.receive === 'granted' ? 'granted' : p.receive === 'denied' ? 'denied' : 'prompt';
}
