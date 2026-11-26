-- Seviyeye bağlı komisyon indirimi: seviye 1'den sonraki her seviye için %1, en fazla %40.
-- Seviye formülü engine.ts levelFor ile aynıdır: L seviyesi için gereken toplam XP = 50·L·(L−1).

create or replace function public.level_for(p_xp integer) returns integer
language sql immutable as $$
  select greatest(1, floor((1 + sqrt(1 + 4 * greatest(p_xp, 0) / 50.0)) / 2)::int)
$$;

create or replace function public.fee_discount(p_xp integer) returns numeric
language sql immutable as $$
  select least(0.40, (level_for(p_xp) - 1) * 0.01)::numeric
$$;

create or replace function public.svc_open_position(
  p_user uuid, p_symbol text, p_side text, p_lev integer, p_margin numeric, p_price numeric,
  p_tp numeric default null, p_sl numeric default null
) returns positions language plpgsql security definer set search_path = public as $$
declare p profiles; pos positions; notional numeric; fee numeric;
begin
  if p_side not in ('long', 'short') then raise exception 'Geçersiz yön'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Geçersiz fiyat'; end if;
  p_margin := round(p_margin, 2);
  p := open_checks(p_user, p_symbol, p_lev, p_margin);
  notional := p_margin * p_lev;
  fee := round(notional * c_taker() * (1 - fee_discount(p.xp)), 4);
  if p.balance < p_margin + fee then
    raise exception 'Bakiye yetersiz: % $ marjin + % $ komisyon gerekir', p_margin, fee;
  end if;
  insert into positions (user_id, symbol, side, leverage, margin, qty, entry_price, liq_price, tp, sl, open_fee)
  values (p_user, p_symbol, p_side, p_lev, p_margin, notional / p_price, p_price, liq_price(p_side, p_price, p_lev), p_tp, p_sl, fee)
  returning * into pos;
  perform ledger(p_user, -(p_margin + fee), 'open', pos.id, null,
    format('%s %s %sx', p_symbol, case when p_side = 'long' then 'Long' else 'Short' end, p_lev));
  update profiles set volume = volume + notional where id = p_user;
  perform check_open_achievements(pos, p.balance);
  return pos;
end $$;

create or replace function public.svc_place_order(
  p_user uuid, p_symbol text, p_side text, p_lev integer, p_margin numeric, p_price numeric,
  p_tp numeric default null, p_sl numeric default null
) returns orders language plpgsql security definer set search_path = public as $$
declare p profiles; o orders; fee numeric;
begin
  if p_side not in ('long', 'short') then raise exception 'Geçersiz yön'; end if;
  if p_price is null or p_price <= 0 then raise exception 'Geçersiz fiyat'; end if;
  p_margin := round(p_margin, 2);
  p := open_checks(p_user, p_symbol, p_lev, p_margin);
  if (select count(*) from orders where user_id = p_user and status = 'open') >= 30 then
    raise exception 'En fazla 30 bekleyen emir olabilir';
  end if;
  fee := round(p_margin * p_lev * c_maker() * (1 - fee_discount(p.xp)), 4);
  if p.balance < p_margin + fee then
    raise exception 'Bakiye yetersiz: % $ marjin + % $ komisyon gerekir', p_margin, fee;
  end if;
  insert into orders (user_id, symbol, side, leverage, margin, price, tp, sl, fee)
  values (p_user, p_symbol, p_side, p_lev, p_margin, p_price, p_tp, p_sl, fee) returning * into o;
  perform ledger(p_user, -(p_margin + fee), 'order', null, o.id,
    format('%s %s limit emri', p_symbol, case when p_side = 'long' then 'Long' else 'Short' end));
  return o;
end $$;

create or replace function public.svc_close_position(
  p_pos uuid, p_price numeric, p_reason text, p_fraction numeric default 1, p_at timestamptz default now(), p_user uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pos positions; part positions; prof profiles;
  f numeric := coalesce(p_fraction, 1);
  q numeric; m numeric; ofee numeric; gross numeric; cfee numeric; pay numeric; net numeric; r double precision;
  st text := 'closed'; px numeric := p_price; comeback boolean := false; xp integer;
begin
  if p_reason not in ('manual', 'tp', 'sl', 'liq') then raise exception 'Geçersiz kapanış nedeni'; end if;
  if f <= 0 or f > 1 then raise exception 'Kapatma oranı geçersiz'; end if;
  select * into pos from positions where id = p_pos for update;
  if pos.id is null then raise exception 'Pozisyon bulunamadı'; end if;
  if p_user is not null and pos.user_id <> p_user then raise exception 'Pozisyon bulunamadı'; end if;
  if pos.status <> 'open' then raise exception 'Pozisyon zaten kapanmış'; end if;
  if p_reason = 'liq' then f := 1; px := pos.liq_price; st := 'liquidated'; end if;
  if px is null or px <= 0 then raise exception 'Geçersiz fiyat'; end if;

  -- elle kapatırken fiyat likidasyonu geçmişse pozisyon likide sayılır
  if p_reason <> 'liq' and ((pos.side = 'long' and px <= pos.liq_price) or (pos.side = 'short' and px >= pos.liq_price)) then
    f := 1; px := pos.liq_price; st := 'liquidated'; p_reason := 'liq';
  end if;

  if f >= 0.9999 then f := 1; end if;
  q := case when f = 1 then pos.qty else pos.qty * f end;
  m := case when f = 1 then pos.margin else round(pos.margin * f, 4) end;
  ofee := case when f = 1 then pos.open_fee else round(pos.open_fee * f, 4) end;
  gross := case when pos.side = 'long' then q * (px - pos.entry_price) else q * (pos.entry_price - px) end;
  r := (gross / m)::double precision;
  if st = 'liquidated' then
    cfee := 0; pay := 0; r := -1; -- marjinin tamamı gider
  else
    cfee := round(q * px * c_taker() * (1 - fee_discount((select pr.xp from profiles pr where pr.id = pos.user_id))), 4);
    pay := greatest(0, round(m + gross - cfee, 4));
  end if;
  net := pay - m - ofee;

  if f = 1 then
    update positions set status = st, close_price = px, close_fee = cfee, payout = pay, pnl = net, roe = r,
      close_reason = p_reason, closed_at = p_at, checked_until = greatest(checked_until, p_at)
    where id = pos.id returning * into part;
  else
    update positions set qty = qty - q, margin = margin - m, open_fee = open_fee - ofee where id = pos.id;
    insert into positions (user_id, symbol, side, leverage, margin, qty, entry_price, liq_price, tp, sl, open_fee, status,
      close_price, close_fee, payout, pnl, roe, close_reason, parent_id, order_id, opened_at, closed_at, checked_until)
    values (pos.user_id, pos.symbol, pos.side, pos.leverage, m, q, pos.entry_price, pos.liq_price, pos.tp, pos.sl, ofee, 'closed',
      px, cfee, pay, net, r, p_reason, pos.id, pos.order_id, pos.opened_at, p_at, p_at)
    returning * into part;
  end if;

  if pay > 0 then
    perform ledger(pos.user_id, pay, 'close', part.id, null,
      format('%s %s kapandı (%s)', pos.symbol, case when pos.side = 'long' then 'Long' else 'Short' end,
        case p_reason when 'tp' then 'kâr al' when 'sl' then 'zarar durdur' else 'elle' end));
  end if;

  select * into prof from profiles where id = pos.user_id for update;
  comeback := net > 0 and prof.liq_pending;
  update profiles set
    trades = trades + 1,
    wins = wins + (net > 0)::int,
    losses = losses + (net <= 0)::int,
    liquidations = liquidations + (st = 'liquidated')::int,
    streak = case when net > 0 then streak + 1 else 0 end,
    best_streak = greatest(best_streak, case when net > 0 then streak + 1 else 0 end),
    realized_pnl = realized_pnl + net,
    volume = volume + case when st = 'liquidated' then 0 else q * px end,
    best_trade = greatest(best_trade, net),
    best_roe = greatest(best_roe, r),
    liq_pending = case when st = 'liquidated' then true when net > 0 then false else liq_pending end
  where id = pos.user_id returning * into prof;

  -- işlem XP'si: 5 + kârlıysa 10 + her 1.000 $ hacim için 1 (en çok 25). 50 $ altı işlemlere XP yok.
  xp := case when m * pos.leverage < 50 then 0
             else 5 + case when net > 0 then 10 else 0 end + least(25, floor(m * pos.leverage / 1000)::int) end;
  if xp > 0 then perform add_trade_xp(pos.user_id, xp); end if;

  perform check_close_achievements(part, prof, comeback);
  return jsonb_build_object('position', to_jsonb(part), 'payout', pay, 'pnl', net);
end $$;

revoke execute on function public.level_for(integer), public.fee_discount(integer) from public, anon;
grant execute on function public.level_for(integer), public.fee_discount(integer) to authenticated, service_role;
