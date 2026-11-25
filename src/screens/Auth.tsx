import { useState } from 'react';
import { errText, rpc } from '../lib/api';
import { emailFor, supabase } from '../lib/supabase';
import { Button, Field, Segmented, inputCls, toast } from '../ui/kit';

const USER_RE = /^[a-z0-9_.]{3,20}$/;

/** Türkçe karakterleri sadeleştirip kullanıcı adına çevirir */
export function toUsername(s: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  return s.replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c]).toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9_.]/g, '').slice(0, 20);
}

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');

  const login = async () => {
    setError('');
    const u = toUsername(username);
    const { error } = await supabase.auth.signInWithPassword({ email: emailFor(u), password: pw });
    if (error) setError(/Invalid login/i.test(error.message) ? 'Kullanıcı adı veya şifre hatalı.' : errText(error));
  };

  const register = async () => {
    setError('');
    const u = toUsername(username);
    if (!USER_RE.test(u)) return setError('Kullanıcı adı 3-20 karakter olmalı: harf, rakam, nokta veya alt çizgi.');
    if (name.trim().length < 2 || name.trim().length > 24) return setError('Adınız 2-24 karakter olmalı.');
    if (pw.length < 6) return setError('Şifre en az 6 karakter olmalı.');
    if (pw !== pw2) return setError('Şifreler aynı değil.');
    const free = await rpc<boolean>('username_available', { p_username: u }).catch(() => true);
    if (!free) return setError('Bu kullanıcı adı alınmış.');
    const { data, error } = await supabase.auth.signUp({
      email: emailFor(u),
      password: pw,
      options: { data: { username: u, display_name: name.trim() } },
    });
    if (error) return setError(/registered/i.test(error.message) ? 'Bu kullanıcı adı alınmış.' : errText(error));
    if (!data.session) {
      setError('Hesap açıldı ama oturum başlamadı. Supabase ayarlarında "Confirm email" kapalı olmalı.');
      return;
    }
    toast('Hesabınız oluşturuldu');
  };

  return (
    <div className="ink-bg flex h-full flex-col overflow-y-auto px-6 pt-safe">
      <div className="mx-auto w-full max-w-sm flex-1 py-10">
        <Hero />
        <Segmented
          className="mb-6"
          value={mode}
          onChange={(m) => { setMode(m); setError(''); }}
          items={[['login', 'Giriş yap'], ['register', 'Hesap aç']]}
        />
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
          }}
        >
          <Field label="Kullanıcı adı" hint={mode === 'register' ? 'Giriş yaparken bunu kullanacaksınız.' : undefined}>
            <input
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              placeholder="ör. okan"
            />
          </Field>
          {mode === 'register' && (
            <Field label="Adınız" hint="Sıralamada bu görünür.">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Okan" maxLength={24} />
            </Field>
          )}
          <Field label="Şifre">
            <input className={inputCls} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          {mode === 'register' && (
            <Field label="Şifre tekrar">
              <input className={inputCls} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </Field>
          )}
          {error && <p className="rounded-xl bg-loss/15 px-3.5 py-3 text-sm text-loss">{error}</p>}
          <Button
            type="submit"
            variant="accent"
            size="lg"
            className="w-full"
            disabled={!username || !pw}
            onClick={mode === 'login' ? login : register}
          >
            {mode === 'login' ? 'Giriş yap' : 'Hesap aç'}
          </Button>
          {mode === 'register' && (
            <p className="text-center text-sm text-dim">10.000 $ sanal sermayeyle başlarsınız. Gerçek para kullanılmaz.</p>
          )}
          {mode === 'login' && <p className="text-center text-sm text-dim">Şifrenizi unuttuysanız admin sıfırlayabilir.</p>}
        </form>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <div className="mb-10 text-center">
      <svg viewBox="0 0 120 90" className="mx-auto mb-5 w-32" aria-hidden>
        <line x1="22" y1="22" x2="22" y2="78" stroke="#f6465d" strokeWidth="3" strokeLinecap="round" />
        <rect x="12" y="34" width="20" height="30" rx="4" fill="#f6465d" />
        <line x1="60" y1="12" x2="60" y2="64" stroke="#16c784" strokeWidth="3" strokeLinecap="round" />
        <rect x="50" y="22" width="20" height="30" rx="4" fill="#16c784" />
        <line x1="98" y1="2" x2="98" y2="50" stroke="#16c784" strokeWidth="3" strokeLinecap="round" />
        <rect x="88" y="8" width="20" height="34" rx="4" fill="#16c784" />
        <rect x="10" y="84" width="100" height="4" rx="2" fill="#8b7cff" />
      </svg>
      <h1 className="font-display text-4xl font-bold tracking-tight">Kripto Arena</h1>
      <p className="mt-1.5 text-mute">Gerçek fiyatlar, sanal para. Kaldıraçla en iyi trader sen ol.</p>
    </div>
  );
}

export function DisabledScreen() {
  return (
    <div className="ink-bg flex h-full flex-col items-center justify-center px-8 text-center">
      <h1 className="font-display text-3xl font-bold">Hesabınız kapatıldı</h1>
      <p className="mt-3 max-w-xs leading-relaxed text-mute">Hesabınız admin tarafından kapatıldı. Bir yanlışlık olduğunu düşünüyorsanız admin ile konuşun.</p>
      <Button variant="quiet" className="mt-8" onClick={() => supabase.auth.signOut()}>Çıkış yap</Button>
    </div>
  );
}

export function NotConfigured() {
  return (
    <div className="ink-bg flex h-full items-center justify-center px-8 text-center">
      <div>
        <h1 className="font-display text-3xl font-bold">Sunucu ayarlanmamış</h1>
        <p className="mt-3 leading-relaxed text-mute">
          Bu sürüm Supabase adresi olmadan derlenmiş. GitHub'daki VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY ayarlarını ekleyip uygulamayı yeniden derleyin.
        </p>
      </div>
    </div>
  );
}
