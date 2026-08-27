-- Atlantis MC FINAL — Supabase backend repair
-- Mevcut users/messages korunur.
-- Bu script'i Supabase SQL Editor'da tek seferde çalıştır.

begin;

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add column if not exists last_seen timestamptz;

alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists avatar_url text;

alter table public.messages
  alter column user_id drop not null;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles readable"
on public.profiles
for select to anon, authenticated
using (true);

drop policy if exists "profiles_owner_update" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
create policy "profiles_owner_update"
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "messages readable" on public.messages;
drop policy if exists "messages_public_read" on public.messages;
drop policy if exists "messages_auth_select" on public.messages;
create policy "messages readable"
on public.messages
for select to anon, authenticated
using (true);

drop policy if exists "messages_owner_update" on public.messages;
create policy "messages_owner_update"
on public.messages
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own messages delete" on public.messages;
drop policy if exists "messages_owner_delete" on public.messages;
create policy "own messages delete"
on public.messages
for delete to authenticated
using (user_id = auth.uid());

create or replace function public.set_my_username(new_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(new_username);
  taken boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if clean !~ '^[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9]{2,15}$' then
    raise exception 'Kullanıcı adı 3-16 karakter olmalı.';
  end if;
  select exists(
    select 1 from public.profiles
    where lower(username)=lower(clean) and id<>auth.uid()
  ) into taken;
  if taken then raise exception 'Bu kullanıcı adı zaten kullanılıyor.'; end if;
  insert into public.profiles(id,username,updated_at)
  values(auth.uid(),clean,now())
  on conflict(id) do update set username=excluded.username,updated_at=now();
  return true;
end;
$$;
revoke all on function public.set_my_username(text) from public;
grant execute on function public.set_my_username(text) to authenticated;

create or replace function public.update_my_profile(
  new_avatar_url text,
  new_bio text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(coalesce(new_bio,'')) > 180 then
    raise exception 'Açıklama en fazla 180 karakter olabilir.';
  end if;
  if new_avatar_url is not null and char_length(new_avatar_url) > 950000 then
    raise exception 'Profil fotoğrafı çok büyük.';
  end if;

  update public.profiles
  set bio=coalesce(new_bio,''), avatar_url=new_avatar_url, updated_at=now()
  where id=auth.uid();

  if not found then
    insert into public.profiles(id,username,bio,avatar_url,updated_at)
    values(auth.uid(),null,coalesce(new_bio,''),new_avatar_url,now());
  end if;

  select * into p from public.profiles where id=auth.uid();

  return jsonb_build_object(
    'id',p.id,
    'username',p.username,
    'site_role',p.site_role,
    'muted_until',p.muted_until,
    'bio',p.bio,
    'avatar_url',p.avatar_url,
    'last_seen',p.last_seen,
    'created_at',p.created_at,
    'updated_at',p.updated_at
  );
end;
$$;
revoke all on function public.update_my_profile(text,text) from public;
grant execute on function public.update_my_profile(text,text) to authenticated;

create or replace function public.send_chat_message(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(p_message);
  sender_id uuid := auth.uid();
  sender_username text;
  sender_avatar text;
  last_time timestamptz;
  new_id bigint;
  new_created timestamptz;
begin
  if char_length(clean)<1 or char_length(clean)>300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  if sender_id is null then
    select count(*) into new_id
    from public.messages
    where user_id is null and created_at > now()-interval '3 seconds';

    if new_id >= 10 then
      raise exception 'Anonim sohbet şu anda çok yoğun. Birkaç saniye bekle.';
    end if;

    insert into public.messages(user_id,username,message,avatar_url)
    values(null,'Anonim',clean,null)
    returning id,created_at into new_id,new_created;

    return jsonb_build_object(
      'ok',true,
      'message',jsonb_build_object('id',new_id,'user_id',null,'username','Anonim','message',clean,'created_at',new_created,'edited_at',null,'avatar_url',null)
    );
  end if;

  select username,avatar_url into sender_username,sender_avatar
  from public.profiles where id=sender_id;

  if sender_username is null or btrim(sender_username)='' then
    raise exception 'Önce kullanıcı adını belirlemelisin.';
  end if;

  if exists(
    select 1 from public.profiles
    where id=sender_id and muted_until is not null and muted_until>now()
  ) then
    raise exception 'Sohbet kullanımın geçici olarak kısıtlandı.';
  end if;

  select created_at into last_time
  from public.messages where user_id=sender_id
  order by created_at desc limit 1;

  if last_time is not null and last_time>now()-interval '3 seconds' then
    raise exception 'Yeni mesaj göndermek için biraz bekle.';
  end if;

  insert into public.messages(user_id,username,message,avatar_url)
  values(sender_id,sender_username,clean,sender_avatar)
  returning id,created_at into new_id,new_created;

  return jsonb_build_object(
    'ok',true,
    'message',jsonb_build_object('id',new_id,'user_id',sender_id,'username',sender_username,'message',clean,'created_at',new_created,'edited_at',null,'avatar_url',sender_avatar)
  );
end;
$$;
revoke all on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to anon,authenticated;

-- Eski frontend/cached dosyalar için geriye dönük uyumluluk.
create or replace function public.send_anonymous_chat_message(p_message text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.send_chat_message(p_message);
$$;
revoke all on function public.send_anonymous_chat_message(text) from public;
grant execute on function public.send_anonymous_chat_message(text) to anon,authenticated;

create or replace function public.edit_my_chat_message(p_message_id bigint,p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.messages;
  clean text := btrim(p_message);
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if char_length(clean)<1 or char_length(clean)>300 then raise exception 'Mesaj 1-300 karakter olmalı.'; end if;
  update public.messages
  set message=clean,edited_at=now()
  where id=p_message_id and user_id=auth.uid()
  returning * into r;
  if not found then raise exception 'Bu mesajı düzenleyemezsin.'; end if;
  return jsonb_build_object('ok',true,'message',jsonb_build_object('id',r.id,'user_id',r.user_id,'username',r.username,'message',r.message,'created_at',r.created_at,'edited_at',r.edited_at,'avatar_url',r.avatar_url));
end;
$$;
revoke all on function public.edit_my_chat_message(bigint,text) from public;
grant execute on function public.edit_my_chat_message(bigint,text) to authenticated;

create or replace function public.delete_my_chat_message(p_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.messages where id=p_message_id and user_id=auth.uid();
  if not found then raise exception 'Bu mesajı silemezsin.'; end if;
  return true;
end;
$$;
revoke all on function public.delete_my_chat_message(bigint) from public;
grant execute on function public.delete_my_chat_message(bigint) to authenticated;

create or replace function public.touch_my_last_seen()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles set last_seen=now(),updated_at=now() where id=auth.uid();
$$;
revoke all on function public.touch_my_last_seen() from public;
grant execute on function public.touch_my_last_seen() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id,username)
  values(new.id,nullif(new.raw_user_meta_data->>'username',''))
  on conflict(id) do update set username=coalesce(public.profiles.username,excluded.username),updated_at=now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Realtime
 do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
commit;
