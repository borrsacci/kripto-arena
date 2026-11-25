-- =====================================================================
-- Kripto Arena: veritabanı şeması
-- Tüm para (sanal USDT) hareketleri sadece aşağıdaki SECURITY DEFINER fonksiyonlarla
-- yapılır; tablolara doğrudan yazma yetkisi yoktur. İşlem açma/kapama fonksiyonları
-- sadece sunucu (service_role) tarafından, gerçek piyasa fiyatıyla çağrılır. Böylece
-- uygulama değiştirilse bile kimse kendine para yazamaz veya uydurma fiyattan işlem yapamaz.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tablolar ----------

create table public.coins (
  symbol text primary key,
  max_leverage integer not null check (max_leverage between 1 and 125),
  active boolean not null default true,
  sort integer not null
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 24),
  is_admin boolean not null default false,
  status text not null default 'active' check (status in ('active', 'disabled')),
  balance numeric(20, 4) not null default 0 check (balance >= 0),
  -- kullanıcıya verilen toplam sermaye (başlangıç + admin + kurtarma). Net kâr = varlık − deposits
  deposits numeric(20, 4) not null default 0,
  xp integer not null default 0,
  xp_day date,
  xp_today integer not null default 0,
  trades integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  liquidations integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  realized_pnl numeric(20, 4) not null default 0,
  volume numeric(24, 4) not null default 0,
  best_trade numeric(20, 4) not null default 0,
  best_roe double precision not null default 0,
  liq_pending boolean not null default false,
  daily_streak integer not null default 0,
  last_daily date,
  last_bailout_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index one_admin on public.profiles ((true)) where is_admin;

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  symbol text not null references public.coins (symbol),
  side text not null check (side in ('long', 'short')),
  leverage integer not null check (leverage between 1 and 125),
  margin numeric(20, 4) not null check (margin > 0),
  qty numeric(38, 14) not null check (qty > 0),
  entry_price numeric(30, 12) not null check (entry_price > 0),
  liq_price numeric(30, 12) not null,
  tp numeric(30, 12),
  sl numeric(30, 12),
  open_fee numeric(20, 4) not null default 0,
  status text not null default 'open' check (status in ('open', 'closed', 'liquidated')),
  close_price numeric(30, 12),
  close_fee numeric(20, 4),
  payout numeric(20, 4),
  pnl numeric(20, 4), -- net: payout − marjin − açılış komisyonu
  roe double precision, -- brüt kâr / marjin
  close_reason text check (close_reason in ('manual', 'tp', 'sl', 'liq')),
  parent_id uuid references public.positions (id) on delete set null, -- kısmi kapanışta asıl pozisyon
  order_id uuid,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  checked_until timestamptz not null default now()
);
create index positions_open_idx on public.positions (symbol) where status = 'open';
create index positions_user_idx on public.positions (user_id, status, closed_at desc);
create index positions_closed_idx on public.positions (closed_at) where status <> 'open';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  symbol text not null references public.coins (symbol),
  side text not null check (side in ('long', 'short')),
  leverage integer not null check (leverage between 1 and 125),
  margin numeric(20, 4) not null check (margin > 0),
  price numeric(30, 12) not null check (price > 0),
  tp numeric(30, 12),
  sl numeric(30, 12),
  fee numeric(20, 4) not null, -- emir verilirken ayrılan komisyon
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  position_id uuid references public.positions (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  checked_until timestamptz not null default now()
);
create index orders_open_idx on public.orders (symbol) where status = 'open';
create index orders_user_idx on public.orders (user_id, created_at desc);

create table public.transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount numeric(20, 4) not null,
  balance_after numeric(20, 4) not null,
  kind text not null check (kind in ('signup', 'admin', 'bailout', 'open', 'close', 'order', 'order_cancel')),
  position_id uuid,
  order_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index transactions_user_idx on public.transactions (user_id, id desc);

create table public.achievement_defs (
  code text primary key,
  xp integer not null check (xp >= 0)
);

create table public.achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.achievement_defs (code),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

create table public.equity_snapshots (
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null,
  equity numeric(20, 4) not null,
  deposits numeric(20, 4) not null,
  primary key (user_id, at)
);

create table public.app_config (
  key text primary key,
  value text not null
);

-- ---------- Sabit veriler ----------

insert into public.coins (symbol, max_leverage, sort) values
  ('BTC', 125, 1), ('ETH', 100, 2), ('SOL', 75, 3), ('BNB', 75, 4), ('XRP', 75, 5), ('DOGE', 50, 6),
  ('ADA', 50, 7), ('AVAX', 50, 8), ('LINK', 50, 9), ('TRX', 50, 10), ('TON', 50, 11), ('SUI', 50, 12),
  ('LTC', 50, 13), ('DOT', 50, 14), ('PEPE', 25, 15), ('SHIB', 25, 16);

insert into public.achievement_defs (code, xp) values
  ('first_trade', 50), ('first_win', 50), ('first_short', 30), ('limit_fill', 40),
  ('lev_10', 30), ('lev_50', 75), ('lev_100', 150), ('all_in', 60), ('liquidated', 25),
  ('roe_100', 100), ('roe_500', 250), ('roe_1000', 500), ('big_win', 200),
  ('streak_3', 50), ('streak_5', 120), ('streak_10', 300),
  ('trades_10', 50), ('trades_100', 200), ('trades_500', 500),
  ('volume_100k', 50), ('volume_1m', 150), ('volume_10m', 400), ('daily_7', 100),
  ('profit_1k', 75), ('profit_10k', 200), ('profit_100k', 600), ('double_up', 300),
  ('tp_hit', 40), ('sl_hit', 40), ('scalper', 60), ('diamond', 100), ('hedge', 30), ('coins_5', 50),
  ('comeback', 75), ('night_owl', 30), ('bailout', 10);

-- tick fonksiyonunu sadece veritabanının zamanlayıcısı çağırabilsin diye gizli anahtar
insert into public.app_config (key, value) values ('tick_secret', encode(gen_random_bytes(24), 'hex'));

-- ---------- Sabitler (engine.ts ile aynı) ----------

create or replace function public.c_taker() returns numeric language sql immutable as $$ select 0.0005::numeric $$;
create or replace function public.c_maker() returns numeric language sql immutable as $$ select 0.0002::numeric $$;
create or replace function public.c_mmr() returns numeric language sql immutable as $$ select 0.005::numeric $$;
create or replace function public.c_min_margin() returns numeric language sql immutable as $$ select 10::numeric $$;
create or replace function public.c_start_balance() returns numeric language sql immutable as $$ select 10000::numeric $$;
create or replace function public.tr_today() returns date language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

-- ---------- Yardımcılar ----------

create or replace function public.require_active() returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  select * into p from profiles where id = auth.uid();
  if p.id is null then raise exception 'Oturum bulunamadı'; end if;
  if p.status <> 'active' then raise exception 'Hesabınız kapalı'; end if;
  return p;
end $$;

create or replace function public.require_admin() returns profiles
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := require_active();
  if not p.is_admin then raise exception 'Bu işlem sadece admin içindir'; end if;
  return p;
end $$;

create or replace function public.ledger(p_user uuid, p_amount numeric, p_kind text, p_pos uuid, p_order uuid, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare b numeric;
begin
  update profiles set balance = balance + round(p_amount, 4) where id = p_user returning balance into b;
  if b is null then raise exception 'Kullanıcı bulunamadı'; end if;
  insert into transactions (user_id, amount, balance_after, kind, position_id, order_id, note)
  values (p_user, round(p_amount, 4), b, p_kind, p_pos, p_order, p_note);
  return b;
end $$;

create or replace function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from profiles where username = lower(btrim(p_username)))
$$;

create or replace function public.liq_price(p_side text, p_entry numeric, p_lev integer) returns numeric
language sql immutable as $$
  select round(case when p_side = 'long' then p_entry * (1 - 1.0 / p_lev + c_mmr())
                    else p_entry * (1 + 1.0 / p_lev - c_mmr()) end, 12)
$$;

-- Yeni hesap: profil + başlangıç sermayesi. İlk hesap admin olur.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first boolean;
  uname text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))));
  dname text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', uname));
begin
  perform pg_advisory_xact_lock(4242);
  first := not exists (select 1 from profiles);
  insert into profiles (id, username, display_name, is_admin, deposits) values (new.id, uname, dname, first, c_start_balance());
  perform ledger(new.id, c_start_balance(), 'signup', null, null, 'Başlangıç sermayesi');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- XP ve başarımlar ----------

-- İşlem XP'si günlük 400 ile sınırlıdır (çok sayıda küçük işlemle seviye kasılmasın)
create or replace function public.add_trade_xp(p_user uuid, p_amount integer) returns integer
language plpgsql security definer set search_path = public as $$
declare p profiles; give integer;
begin
  select * into p from profiles where id = p_user for update;
  if p.xp_day is distinct from tr_today() then p.xp_today := 0; end if;
  give := greatest(0, least(p_amount, 400 - p.xp_today));
  update profiles set xp = xp + give, xp_today = p.xp_today + give, xp_day = tr_today() where id = p_user;
  return give;
end $$;

create or replace function public.grant_achievement(p_user uuid, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into achievements (user_id, code) values (p_user, p_code) on conflict do nothing;
  get diagnostics n = row_count;
  if n > 0 then
    update profiles set xp = xp + (select xp from achievement_defs where code = p_code) where id = p_user;
  end if;
  return n > 0;
end $$;

create or replace function public.check_open_achievements(p_pos positions, p_balance_before numeric) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := p_pos.user_id; h integer;
begin
  perform grant_achievement(u, 'first_trade');
  if p_pos.side = 'short' then perform grant_achievement(u, 'first_short'); end if;
  if p_pos.leverage >= 10 then perform grant_achievement(u, 'lev_10'); end if;
  if p_pos.leverage >= 50 then perform grant_achievement(u, 'lev_50'); end if;
  if p_pos.leverage >= 100 then perform grant_achievement(u, 'lev_100'); end if;
  if p_pos.order_id is not null then perform grant_achievement(u, 'limit_fill'); end if;
  if p_balance_before > 0 and p_pos.margin >= 0.9 * p_balance_before then perform grant_achievement(u, 'all_in'); end if;
  if (select count(distinct symbol) from positions where user_id = u) >= 5 then perform grant_achievement(u, 'coins_5'); end if;
  if exists (select 1 from positions where user_id = u and status = 'open' and symbol = p_pos.symbol and side <> p_pos.side) then
    perform grant_achievement(u, 'hedge');
  end if;
  h := extract(hour from p_pos.opened_at at time zone 'Europe/Istanbul');
  if h between 2 and 4 then perform grant_achievement(u, 'night_owl'); end if;
end $$;

create or replace function public.check_close_achievements(p_pos positions, p_prof profiles, p_comeback boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := p_pos.user_id; held interval := p_pos.closed_at - p_pos.opened_at;
begin
  if p_pos.pnl > 0 then perform grant_achievement(u, 'first_win'); end if;
  if p_pos.status = 'liquidated' then perform grant_achievement(u, 'liquidated'); end if;
  if p_pos.roe >= 1 then perform grant_achievement(u, 'roe_100'); end if;
  if p_pos.roe >= 5 then perform grant_achievement(u, 'roe_500'); end if;
  if p_pos.roe >= 10 then perform grant_achievement(u, 'roe_1000'); end if;
  if p_pos.pnl >= 5000 then perform grant_achievement(u, 'big_win'); end if;
  if p_prof.streak >= 3 then perform grant_achievement(u, 'streak_3'); end if;
  if p_prof.streak >= 5 then perform grant_achievement(u, 'streak_5'); end if;
  if p_prof.streak >= 10 then perform grant_achievement(u, 'streak_10'); end if;
  if p_prof.trades >= 10 then perform grant_achievement(u, 'trades_10'); end if;
  if p_prof.trades >= 100 then perform grant_achievement(u, 'trades_100'); end if;
  if p_prof.trades >= 500 then perform grant_achievement(u, 'trades_500'); end if;
  if p_prof.volume >= 100000 then perform grant_achievement(u, 'volume_100k'); end if;
  if p_prof.volume >= 1000000 then perform grant_achievement(u, 'volume_1m'); end if;
  if p_prof.volume >= 10000000 then perform grant_achievement(u, 'volume_10m'); end if;
  if p_prof.realized_pnl >= 1000 then perform grant_achievement(u, 'profit_1k'); end if;
  if p_prof.realized_pnl >= 10000 then perform grant_achievement(u, 'profit_10k'); end if;
  if p_prof.realized_pnl >= 100000 then perform grant_achievement(u, 'profit_100k'); end if;
  if p_prof.realized_pnl >= p_prof.deposits then perform grant_achievement(u, 'double_up'); end if;
  if p_pos.close_reason = 'tp' then perform grant_achievement(u, 'tp_hit'); end if;
  if p_pos.close_reason = 'sl' then perform grant_achievement(u, 'sl_hit'); end if;
  if p_pos.pnl > 0 and held <= interval '60 seconds' then perform grant_achievement(u, 'scalper'); end if;
  if p_pos.pnl > 0 and held >= interval '24 hours' then perform grant_achievement(u, 'diamond'); end if;
  if p_comeback then perform grant_achievement(u, 'comeback'); end if;
end $$;

-- ---------- İşlem açma (sunucu, gerçek fiyatla) ----------

create or replace function public.open_checks(p_user uuid, p_symbol text, p_lev integer, p_margin numeric)
returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles; c coins;
begin
  select * into p from profiles where id = p_user for update;
  if p.id is null then raise exception 'Kullanıcı bulunamadı'; end if;
  if p.status <> 'active' then raise exception 'Hesabınız kapalı'; end if;
  select * into c from coins where symbol = p_symbol;
  if c.symbol is null or not c.active then raise exception 'Bu coin işleme kapalı'; end if;
  if p_lev < 1 or p_lev > c.max_leverage then raise exception '% için kaldıraç 1x ile %x arasında olmalı', p_symbol, c.max_leverage; end if;
  if p_margin < c_min_margin() then raise exception 'En az % $ marjin gerekir', c_min_margin(); end if;
  if (select count(*) from positions where user_id = p_user and status = 'open') >= 30 then
    raise exception 'En fazla 30 açık pozisyon olabilir';
  end if;
  return p;
end $$;

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
  fee := round(notional * c_taker(), 4);
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

-- ---------- Limit emirler ----------

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
  fee := round(p_margin * p_lev * c_maker(), 4);
  if p.balance < p_margin + fee then
    raise exception 'Bakiye yetersiz: % $ marjin + % $ komisyon gerekir', p_margin, fee;
  end if;
  insert into orders (user_id, symbol, side, leverage, margin, price, tp, sl, fee)
  values (p_user, p_symbol, p_side, p_lev, p_margin, p_price, p_tp, p_sl, fee) returning * into o;
  perform ledger(p_user, -(p_margin + fee), 'order', null, o.id,
    format('%s %s limit emri', p_symbol, case when p_side = 'long' then 'Long' else 'Short' end));
  return o;
end $$;

-- Emir doldu: ayrılan marjinle pozisyon açılır. p_checked: pozisyonun kontrolü bu andan sonra başlar
create or replace function public.svc_fill_order(p_order uuid, p_price numeric, p_at timestamptz, p_checked timestamptz)
returns positions language plpgsql security definer set search_path = public as $$
declare o orders; pos positions; bal numeric;
begin
  select * into o from orders where id = p_order for update;
  if o.id is null or o.status <> 'open' then return null; end if;
  select balance into bal from profiles where id = o.user_id for update;
  insert into positions (user_id, symbol, side, leverage, margin, qty, entry_price, liq_price, tp, sl, open_fee, order_id, opened_at, checked_until)
  values (o.user_id, o.symbol, o.side, o.leverage, o.margin, o.margin * o.leverage / p_price, p_price,
          liq_price(o.side, p_price, o.leverage), o.tp, o.sl, o.fee, o.id, p_at, p_checked)
  returning * into pos;
  update orders set status = 'filled', position_id = pos.id, done_at = p_at where id = o.id;
  update profiles set volume = volume + o.margin * o.leverage where id = o.user_id;
  perform check_open_achievements(pos, bal + o.margin + o.fee);
  return pos;
end $$;

-- Kullanıcı bekleyen emrini iptal eder: ayrılan marjin ve komisyon iade edilir
create or replace function public.cancel_order(p_order uuid) returns orders
language plpgsql security definer set search_path = public as $$
declare me profiles; o orders;
begin
  me := require_active();
  select * into o from orders where id = p_order for update;
  if o.id is null or o.user_id <> me.id then raise exception 'Emir bulunamadı'; end if;
  if o.status <> 'open' then raise exception 'Emir zaten %', case when o.status = 'filled' then 'doldu' else 'iptal edildi' end; end if;
  update orders set status = 'cancelled', done_at = now() where id = o.id returning * into o;
  perform ledger(o.user_id, o.margin + o.fee, 'order_cancel', null, o.id, format('%s limit emri iptal', o.symbol));
  return o;
end $$;

-- ---------- Pozisyon kapatma ----------
-- p_fraction < 1 ise kısmi kapanış: kapanan kısım ayrı bir kayıt olarak geçmişe yazılır.
-- p_user verilirse pozisyonun o kullanıcıya ait olduğu kontrol edilir (elle kapatma).
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
    cfee := round(q * px * c_taker(), 4);
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

create or replace function public.svc_set_tpsl(p_user uuid, p_pos uuid, p_tp numeric, p_sl numeric)
returns positions language plpgsql security definer set search_path = public as $$
declare pos positions;
begin
  update positions set tp = p_tp, sl = p_sl where id = p_pos and user_id = p_user and status = 'open' returning * into pos;
  if pos.id is null then raise exception 'Açık pozisyon bulunamadı'; end if;
  return pos;
end $$;

-- Tarama sonucu tetik yoksa: kalemlerin "kontrol edildi" zamanı ilerletilir
-- p_items: [{"k":"p"|"o","id":"...","t":"2026-..."}]
create or replace function public.svc_mark_checked(p_items jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update positions p set checked_until = greatest(p.checked_until, (x ->> 't')::timestamptz)
  from jsonb_array_elements(p_items) x where x ->> 'k' = 'p' and p.id = (x ->> 'id')::uuid and p.status = 'open';
  update orders o set checked_until = greatest(o.checked_until, (x ->> 't')::timestamptz)
  from jsonb_array_elements(p_items) x where x ->> 'k' = 'o' and o.id = (x ->> 'id')::uuid and o.status = 'open';
end $$;

-- Saatlik varlık kaydı (profil grafiği için). p_rows: [{"user_id":"...","equity":123.4}]
create or replace function public.svc_snapshot(p_at timestamptz, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into equity_snapshots (user_id, at, equity, deposits)
  select (x ->> 'user_id')::uuid, p_at, round((x ->> 'equity')::numeric, 4), pr.deposits
  from jsonb_array_elements(p_rows) x join profiles pr on pr.id = (x ->> 'user_id')::uuid
  on conflict (user_id, at) do update set equity = excluded.equity, deposits = excluded.deposits;
  delete from equity_snapshots where at < now() - interval '120 days';
end $$;

-- ---------- Kullanıcı işlemleri (fiyat gerektirmeyenler) ----------

-- Günlük ödül: XP verir; üst üste gelinen günlerde artar (7. günde en yüksek)
create or replace function public.claim_daily() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me profiles; s integer; gain integer;
begin
  me := require_active();
  select * into me from profiles where id = me.id for update;
  if me.last_daily = tr_today() then raise exception 'Bugünün ödülünü zaten aldınız'; end if;
  s := case when me.last_daily = tr_today() - 1 then me.daily_streak + 1 else 1 end;
  gain := 20 + 5 * (least(s, 7) - 1);
  update profiles set daily_streak = s, last_daily = tr_today(), xp = xp + gain where id = me.id;
  if s >= 7 then perform grant_achievement(me.id, 'daily_7'); end if;
  return jsonb_build_object('xp', gain, 'streak', s);
end $$;

-- Kurtarma paketi: bakiye 500 $ altına düştüyse ve açık işlem yoksa günde bir 5.000 $.
-- Sermaye olarak sayılır; net kârı değiştirmez, sıralamada avantaj sağlamaz.
create or replace function public.claim_bailout() returns numeric
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_active();
  select * into me from profiles where id = me.id for update;
  if me.balance >= 500 then raise exception 'Kurtarma paketi bakiye 500 $ altına düşünce alınabilir'; end if;
  if exists (select 1 from positions where user_id = me.id and status = 'open')
     or exists (select 1 from orders where user_id = me.id and status = 'open') then
    raise exception 'Önce açık pozisyon ve emirlerinizi kapatın';
  end if;
  if me.last_bailout_at > now() - interval '24 hours' then
    raise exception 'Kurtarma paketi 24 saatte bir alınabilir';
  end if;
  update profiles set deposits = deposits + 5000, last_bailout_at = now() where id = me.id;
  perform grant_achievement(me.id, 'bailout');
  return ledger(me.id, 5000, 'bailout', null, null, 'Kurtarma paketi');
end $$;

create or replace function public.update_display_name(p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_active();
  if char_length(btrim(p_name)) not between 2 and 24 then raise exception 'Ad 2-24 karakter olmalı'; end if;
  update profiles set display_name = btrim(p_name) where id = me.id;
end $$;

-- Dönemlik sıralama: verilen andan sonra kapanan işlemlerin net kârı
create or replace function public.period_pnl(p_since timestamptz)
returns table (user_id uuid, pnl numeric, trades integer, wins integer, volume numeric)
language sql stable security definer set search_path = public as $$
  select p.user_id, sum(p.pnl), count(*)::int, count(*) filter (where p.pnl > 0)::int, sum(p.margin * p.leverage)
  from positions p join profiles pr on pr.id = p.user_id and pr.status = 'active'
  where p.status <> 'open' and p.closed_at >= p_since
  group by p.user_id
$$;

-- ---------- Admin ----------

create or replace function public.admin_adjust_balance(p_user uuid, p_amount numeric, p_note text)
returns numeric language plpgsql security definer set search_path = public as $$
declare me profiles; b numeric;
begin
  me := require_admin();
  if p_amount = 0 then raise exception 'Tutar sıfır olamaz'; end if;
  select balance into b from profiles where id = p_user for update;
  if b is null then raise exception 'Kullanıcı bulunamadı'; end if;
  if b + p_amount < 0 then raise exception 'Bakiye eksiye düşemez (mevcut: % $)', b; end if;
  update profiles set deposits = deposits + round(p_amount, 4) where id = p_user;
  return ledger(p_user, p_amount, 'admin', null, null, coalesce(nullif(btrim(p_note), ''), 'Admin'));
end $$;

create or replace function public.admin_grant_all(p_amount numeric, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare me profiles; u uuid; n integer := 0;
begin
  me := require_admin();
  if p_amount <= 0 then raise exception 'Tutar pozitif olmalı'; end if;
  for u in select id from profiles where status = 'active' order by id for update loop
    update profiles set deposits = deposits + round(p_amount, 4) where id = u;
    perform ledger(u, p_amount, 'admin', null, null, coalesce(nullif(btrim(p_note), ''), 'Herkese hediye'));
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.admin_set_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_admin();
  if p_user = me.id then raise exception 'Kendi hesabınızı kapatamazsınız'; end if;
  if p_status not in ('active', 'disabled') then raise exception 'Geçersiz durum'; end if;
  update profiles set status = p_status where id = p_user;
end $$;

create or replace function public.admin_set_coin(p_symbol text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_admin();
  update coins set active = p_active where symbol = p_symbol;
end $$;

-- ---------- Zamanlayıcı (her 30 saniyede tetik taraması) ----------
-- tick_url, sunucu fonksiyonu ilk çalıştığında kendiliğinden yazılır.

do $$ begin
  begin create extension if not exists pg_net; exception when others then raise notice 'pg_net kurulamadı: %', sqlerrm; end;
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron kurulamadı: %', sqlerrm; end;
end $$;

create or replace function public.run_tick() returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from app_config where key = 'tick_url';
  select value into s from app_config where key = 'tick_secret';
  if u is null then return; end if;
  perform net.http_post(
    url := u,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-tick-secret', s),
    timeout_milliseconds := 25000
  );
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('kripto-tick', '30 seconds', 'select public.run_tick()');
    exception when others then
      perform cron.schedule('kripto-tick', '* * * * *', 'select public.run_tick()');
    end;
    perform cron.schedule('kripto-cleanup', '17 3 * * *', $c$ delete from cron.job_run_details where end_time < now() - interval '2 days' $c$);
  end if;
end $$;

-- ---------- Yetkiler ----------

alter table public.coins enable row level security;
alter table public.profiles enable row level security;
alter table public.positions enable row level security;
alter table public.orders enable row level security;
alter table public.transactions enable row level security;
alter table public.achievement_defs enable row level security;
alter table public.achievements enable row level security;
alter table public.equity_snapshots enable row level security;
alter table public.app_config enable row level security;

-- Herkes herkesin pozisyonlarını, başarımlarını ve sıralamasını görebilir (yarışmanın tadı)
create policy coins_read on public.coins for select to authenticated using (true);
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy positions_read on public.positions for select to authenticated using (true);
create policy orders_read on public.orders for select to authenticated using (true);
create policy defs_read on public.achievement_defs for select to authenticated using (true);
create policy achievements_read on public.achievements for select to authenticated using (true);
create policy snapshots_read on public.equity_snapshots for select to authenticated using (true);
create policy transactions_read on public.transactions for select to authenticated using (user_id = auth.uid());
-- app_config: kimse okuyamaz (sadece service_role ve SECURITY DEFINER fonksiyonlar)

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.coins, public.profiles, public.positions, public.orders, public.transactions,
  public.achievement_defs, public.achievements, public.equity_snapshots to authenticated;
grant select, insert, update on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.cancel_order(uuid), public.claim_daily(), public.claim_bailout(),
  public.update_display_name(text), public.period_pnl(timestamptz),
  public.admin_adjust_balance(uuid, numeric, text), public.admin_grant_all(numeric, text),
  public.admin_set_status(uuid, text), public.admin_set_coin(text, boolean)
  to authenticated;
grant execute on function
  public.svc_open_position(uuid, text, text, integer, numeric, numeric, numeric, numeric),
  public.svc_place_order(uuid, text, text, integer, numeric, numeric, numeric, numeric),
  public.svc_fill_order(uuid, numeric, timestamptz, timestamptz),
  public.svc_close_position(uuid, numeric, text, numeric, timestamptz, uuid),
  public.svc_set_tpsl(uuid, uuid, numeric, numeric),
  public.svc_mark_checked(jsonb),
  public.svc_snapshot(timestamptz, jsonb),
  public.period_pnl(timestamptz)
  to service_role;

-- Anlık güncellemeler
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.profiles, public.positions, public.orders, public.achievements, public.coins;
  end if;
end $$;
