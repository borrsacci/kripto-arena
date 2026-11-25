// İşlem fonksiyonu: pozisyon açma (piyasa/limit), kapatma (tamamı/kısmi), TP/SL ayarlama.
// Fiyat her zaman sunucuda, gerçek piyasadan alınır. Her işlemden önce kullanıcının bekleyen
// tetikleri (likidasyon, TP, SL, limit emir) mum verisiyle kontrol edilir; böylece kimse
// "likide olması gereken" bir pozisyonu sonradan kurtaramaz.
import { COIN_BY_SYMBOL } from '../_shared/coins.ts';
import { liqPrice, MIN_MARGIN, type Side, validateTpSl } from '../_shared/engine.ts';
import { cors, HttpError, isUuid, json } from '../_shared/http.ts';
import { createMarket } from '../_shared/market.ts';
import { settle } from '../_shared/settle.ts';
import { authUser, ensureTickUrl, rpc, store, svc } from '../_lib/server.ts';

const market = createMarket();

const num = (x: unknown): number | null => (x === null || x === undefined || x === '' ? null : Number(x));

async function settleFor(uid: string, symbol?: string) {
  const r = await settle(store, market, { userId: uid, symbols: symbol ? [symbol] : undefined });
  if (symbol && r.failed.includes(symbol)) throw new HttpError(503, 'Piyasa verisi şu an alınamıyor, biraz sonra tekrar deneyin');
  return r;
}

async function livePrice(symbol: string) {
  try {
    return await market.price(symbol);
  } catch {
    throw new HttpError(503, 'Fiyat alınamadı, biraz sonra tekrar deneyin');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const uid = await authUser(req);
    ensureTickUrl().catch(() => {});
    const body = await req.json().catch(() => ({}));

    switch (body.action) {
      case 'sync': {
        const r = await settle(store, market, { userId: uid });
        return json(r);
      }

      case 'open': {
        const symbol = String(body.symbol ?? '');
        const coin = COIN_BY_SYMBOL[symbol];
        if (!coin) throw new HttpError(400, 'Geçersiz coin');
        const side = body.side as Side;
        if (side !== 'long' && side !== 'short') throw new HttpError(400, 'Geçersiz yön');
        const lev = Math.round(Number(body.leverage));
        const margin = Number(body.margin);
        if (!(lev >= 1 && lev <= coin.maxLev)) throw new HttpError(400, `Kaldıraç 1x ile ${coin.maxLev}x arasında olmalı`);
        if (!(margin >= MIN_MARGIN)) throw new HttpError(400, `En az ${MIN_MARGIN} $ marjin gerekir`);
        const tp = num(body.tp);
        const sl = num(body.sl);

        await settleFor(uid, symbol);
        const price = await livePrice(symbol);

        if (body.type === 'limit') {
          const limit = Number(body.price);
          if (!(limit > 0)) throw new HttpError(400, 'Limit fiyatı geçersiz');
          if (side === 'long' && limit >= price) throw new HttpError(400, 'Long limit fiyatı şu anki fiyatın altında olmalı (hemen almak için piyasa emri kullanın)');
          if (side === 'short' && limit <= price) throw new HttpError(400, 'Short limit fiyatı şu anki fiyatın üstünde olmalı (hemen satmak için piyasa emri kullanın)');
          const err = validateTpSl(side, limit, liqPrice(side, limit, lev), tp, sl);
          if (err) throw new HttpError(400, err.replace('şu anki fiyatın', 'limit fiyatının'));
          const order = await rpc('svc_place_order', { p_user: uid, p_symbol: symbol, p_side: side, p_lev: lev, p_margin: margin, p_price: limit, p_tp: tp, p_sl: sl });
          return json({ order });
        }

        const err = validateTpSl(side, price, liqPrice(side, price, lev), tp, sl);
        if (err) throw new HttpError(400, err);
        const position = await rpc('svc_open_position', { p_user: uid, p_symbol: symbol, p_side: side, p_lev: lev, p_margin: margin, p_price: price, p_tp: tp, p_sl: sl });
        return json({ position, price });
      }

      case 'close': {
        if (!isUuid(body.position_id)) throw new HttpError(400, 'Geçersiz pozisyon');
        const fraction = body.fraction == null ? 1 : Number(body.fraction);
        if (!(fraction > 0 && fraction <= 1)) throw new HttpError(400, 'Kapatma oranı geçersiz');
        const { data: pos } = await svc.from('positions').select('symbol,user_id,status').eq('id', body.position_id).maybeSingle();
        if (!pos || pos.user_id !== uid) throw new HttpError(404, 'Pozisyon bulunamadı');
        await settleFor(uid, pos.symbol);
        const price = await livePrice(pos.symbol);
        const r = await rpc('svc_close_position', { p_pos: body.position_id, p_price: price, p_reason: 'manual', p_fraction: fraction, p_at: new Date().toISOString(), p_user: uid });
        return json({ ...r, price });
      }

      case 'tpsl': {
        if (!isUuid(body.position_id)) throw new HttpError(400, 'Geçersiz pozisyon');
        const { data: pos } = await svc.from('positions').select('symbol,user_id,side,liq_price,status').eq('id', body.position_id).maybeSingle();
        if (!pos || pos.user_id !== uid) throw new HttpError(404, 'Pozisyon bulunamadı');
        await settleFor(uid, pos.symbol);
        const tp = num(body.tp);
        const sl = num(body.sl);
        const price = await livePrice(pos.symbol);
        const err = validateTpSl(pos.side, price, Number(pos.liq_price), tp, sl);
        if (err) throw new HttpError(400, err);
        const position = await rpc('svc_set_tpsl', { p_user: uid, p_pos: body.position_id, p_tp: tp, p_sl: sl });
        return json({ position });
      }
    }
    throw new HttpError(400, 'Bilinmeyen işlem');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
