import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

export async function initNative() {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0B0E14' });
  } catch {
    /* bazı cihazlarda desteklenmez */
  }
}

/** Android geri tuşu: önce açık pencereyi kapatır, sonra ana sekmeye döner, en son uygulamayı arka plana alır */
const backHandlers: (() => boolean)[] = [];
export function onBack(fn: () => boolean) {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}
if (isNative) {
  App.addListener('backButton', () => {
    for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return;
    App.minimizeApp();
  });
}

export function onResume(fn: () => void) {
  if (isNative) {
    const h = App.addListener('resume', fn);
    return () => void h.then((x) => x.remove());
  }
  const v = () => document.visibilityState === 'visible' && fn();
  document.addEventListener('visibilitychange', v);
  return () => document.removeEventListener('visibilitychange', v);
}

export function tap() {
  if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}
export function thump() {
  if (isNative) Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  else navigator.vibrate?.(40);
}
/** Başarım / kazanç kutlaması: kısa çift titreşim */
export function cheer() {
  if (isNative) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  else navigator.vibrate?.([30, 60, 30]);
}
export function buzz() {
  if (isNative) Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
  else navigator.vibrate?.([200, 100, 200]);
}

/** Görseli paylaşım menüsüyle paylaşır (WhatsApp vb.) */
export async function shareImage(blob: Blob, fileName: string, title: string) {
  if (isNative) {
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    const f = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    await Share.share({ title, files: [f.uri] });
    return;
  }
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
