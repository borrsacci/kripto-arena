// Sunucu fonksiyonlarının ortak parçaları (Deno): Supabase bağlantısı, oturum, veritabanı deposu
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from '../_shared/http.ts';
import type { OpenOrder, OpenPos, Store } from '../_shared/settle.ts';
import { closedMessage, filledMessage, notifyUser } from './push.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export const svc: SupabaseClient = createClient(URL, SERVICE, { auth: { persistSession: false } });

export async function authUser(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(URL, ANON, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data } = await userClient.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!data?.user) throw new HttpError(401, 'Oturum geçersiz, tekrar giriş yapın');
  return data.user.id;
}

/** Veritabanı hatasını kullanıcıya gösterilecek metne çevirir */
export function dbErr(error: { message: string } | null): never | void {
  if (error) throw new HttpError(400, error.message.replace(/^.*?ERROR:\s*/, ''));
}

export async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await svc.rpc(fn, args);
  dbErr(error);
  return data as T;
}

const POS_COLS = 'id,user_id,symbol,side,liq_price,tp,sl,checked_until';

export const store: Store = {
  async openPositions(userId) {
    let q = svc.from('positions').select(POS_COLS).eq('status', 'open');
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    dbErr(error);
    return (data ?? []) as OpenPos[];
  },
  async openOrders(userId) {
    let q = svc.from('orders').select('id,user_id,symbol,side,price,checked_until').eq('status', 'open');
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    dbErr(error);
    return (data ?? []) as OpenOrder[];
  },
  async fillOrder(id, price, at, checked) {
    const pos = await rpc('svc_fill_order', { p_order: id, p_price: price, p_at: at.toISOString(), p_checked: checked.toISOString() });
    if (!pos?.id) return null;
    await notifyUser(svc, pos.user_id, filledMessage({ ...pos, entry_price: Number(pos.entry_price), margin: Number(pos.margin) }));
    return pos as OpenPos;
  },
  async closePosition(id, price, reason, at) {
    const r = await rpc('svc_close_position', { p_pos: id, p_price: price, p_reason: reason, p_fraction: 1, p_at: at.toISOString() });
    const p = r?.position;
    if (p) {
      await notifyUser(svc, p.user_id, closedMessage({ ...p, close_price: Number(p.close_price), pnl: Number(p.pnl), roe: Number(p.roe) }));
    }
  },
  async markChecked(items) {
    await rpc('svc_mark_checked', { p_items: items });
  },
};

/** Zamanlayıcının çağıracağı adres: ilk çalışmada veritabanına yazılır */
let configured = false;
export async function ensureTickUrl() {
  if (configured) return;
  configured = true;
  const url = `${URL}/functions/v1/tick`;
  await svc.from('app_config').upsert({ key: 'tick_url', value: url });
}

export async function tickSecret(): Promise<string | null> {
  const { data } = await svc.from('app_config').select('value').eq('key', 'tick_secret').maybeSingle();
  return data?.value ?? null;
}
