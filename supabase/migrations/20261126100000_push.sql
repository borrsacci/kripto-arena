-- Telefon bildirimleri (Firebase Cloud Messaging): cihaz anahtarları ve kullanıcı tercihi
alter table public.profiles add column push_enabled boolean not null default true;

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
-- kimse doğrudan okuyamaz/yazamaz; sadece aşağıdaki fonksiyonlar ve sunucu (service_role)
revoke all on public.push_tokens from anon, authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;

-- Cihaz anahtarını kaydet (aynı telefon başka hesaba geçtiyse anahtar o hesaba taşınır)
create or replace function public.register_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_active();
  if p_token is null or char_length(p_token) not between 20 and 4096 then raise exception 'Geçersiz bildirim anahtarı'; end if;
  insert into push_tokens (token, user_id) values (p_token, me.id)
  on conflict (token) do update set user_id = excluded.user_id, updated_at = now();
end $$;

-- Çıkış yaparken bu telefona artık bildirim gitmesin
create or replace function public.unregister_push_token(p_token text) returns void
language sql security definer set search_path = public as $$
  delete from push_tokens where token = p_token and user_id = auth.uid()
$$;

create or replace function public.set_push_enabled(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  me := require_active();
  update profiles set push_enabled = p_on where id = me.id;
end $$;

revoke execute on function public.register_push_token(text), public.unregister_push_token(text), public.set_push_enabled(boolean) from public, anon;
grant execute on function public.register_push_token(text), public.unregister_push_token(text), public.set_push_enabled(boolean) to authenticated;
