-- APK ve sürüm bilgisinin konduğu herkese açık depolama klasörü (indirme linki için)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('app', 'app', true) on conflict (id) do update set public = true;
  end if;
end $$;
