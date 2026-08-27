-- Atlantis MC — FINAL ONE LAST DATABASE PATCH
-- Safe to run after the previously successful Atlantis MC SQL.
-- Does not delete users or existing chat messages.

begin;

-- ------------------------------------------------------------
-- CHAT TABLE PERMISSIONS
-- ------------------------------------------------------------
grant select on public.messages to anon, authenticated;
grant insert on public.messages to anon, authenticated;
grant update, delete on public.messages to authenticated;

do $$
begin
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relname='messages_id_seq'
  ) then
    grant usage, select on sequence public.messages_id_seq to anon, authenticated;
  end if;
end $$;

alter table public.messages alter column user_id drop not null;
alter table public.messages enable row level security;

-- Replace conflicting message policies with the intended rules.
drop policy if exists "messages readable" on public.messages;
drop policy if exists "messages_public_read" on public.messages;
drop policy if exists "messages_auth_select" on public.messages;
create policy "messages readable"
on public.messages for select to anon, authenticated using (true);

drop policy if exists "messages_anon_insert" on public.messages;
create policy "messages_anon_insert"
on public.messages for insert to anon
with check (
  user_id is null
  and username = 'Anonim'
  and char_length(btrim(message)) between 1 and 300
  and avatar_url is null
);

drop policy if exists "messages_auth_insert" on public.messages;
create policy "messages_auth_insert"
on public.messages for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "messages_owner_update" on public.messages;
create policy "messages_owner_update"
on public.messages for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own messages delete" on public.messages;
drop policy if exists "messages_owner_delete" on public.messages;
create policy "own messages delete"
on public.messages for delete to authenticated
using (user_id = auth.uid());

-- ------------------------------------------------------------
-- PROFILE TABLE PERMISSIONS
-- ------------------------------------------------------------
grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;
alter table public.profiles enable row level security;

drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles readable"
on public.profiles for select to anon, authenticated using (true);

drop policy if exists "profiles_owner_update" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
create policy "profiles_owner_update"
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- ------------------------------------------------------------
-- PROFILE PHOTO STORAGE
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ------------------------------------------------------------
-- PROFILE RPC — DROP FIRST SO RETURN TYPE CANNOT CONFLICT
-- ------------------------------------------------------------
drop function if exists public.update_my_profile(text, text);

create function public.update_my_profile(
  new_avatar_url text,
  new_bio text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if char_length(coalesce(new_bio,'')) > 180 then
    raise exception 'Açıklama en fazla 180 karakter olabilir.';
  end if;

  update public.profiles
  set avatar_url = new_avatar_url,
      bio = coalesce(new_bio,''),
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'Profil kaydı bulunamadı.';
  end if;

  select * into result
  from public.profiles
  where id = auth.uid();

  return result;
end;
$$;

revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- ------------------------------------------------------------
-- CHAT RPCs — ENSURE CORRECT IDENTITY
-- ------------------------------------------------------------
create or replace function public.send_chat_message(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(p_message);
  p record;
  last_time timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın.';
  end if;

  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  select username, muted_until, avatar_url
  into p
  from public.profiles
  where id = auth.uid();

  if p.username is null then
    raise exception 'Kullanıcı adın bulunamadı.';
  end if;

  if p.muted_until is not null and p.muted_until > now() then
    raise exception 'Sohbet kullanımın geçici olarak kısıtlandı.';
  end if;

  select created_at into last_time
  from public.messages
  where user_id = auth.uid()
  order by created_at desc
  limit 1;

  if last_time is not null and last_time > now() - interval '3 seconds' then
    raise exception 'Yeni mesaj göndermek için biraz bekle.';
  end if;

  insert into public.messages(user_id, username, message, avatar_url)
  values(auth.uid(), p.username, clean, p.avatar_url);

  return jsonb_build_object('ok', true, 'username', p.username);
end;
$$;

revoke all on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to authenticated;

create or replace function public.send_anonymous_chat_message(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(p_message);
begin
  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  insert into public.messages(user_id, username, message, avatar_url)
  values(null, 'Anonim', clean, null);

  return jsonb_build_object('ok', true, 'username', 'Anonim');
end;
$$;

revoke all on function public.send_anonymous_chat_message(text) from public;
grant execute on function public.send_anonymous_chat_message(text) to anon, authenticated;

-- ------------------------------------------------------------
-- REALTIME + POSTGREST SCHEMA CACHE
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception when undefined_object then
  null;
end $$;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- SIX-DIGIT EMAIL CHANGE CODE STORAGE
-- The Edge Function in this package is responsible for sending/verifying it.
-- ------------------------------------------------------------
create table if not exists public.email_change_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  new_email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists email_change_codes_user_created_idx
on public.email_change_codes(user_id, created_at desc);

alter table public.email_change_codes enable row level security;
revoke all on table public.email_change_codes from anon, authenticated;

commit;

-- ------------------------------------------------------------
-- FINAL CHAT/ACTIVITY POLISH
-- Idempotent additions for live active status and fast chat updates.
-- ------------------------------------------------------------
begin;

alter table public.profiles
  add column if not exists last_seen timestamptz;

drop function if exists public.touch_my_last_seen();
create function public.touch_my_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update public.profiles
  set last_seen = now(),
      updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.touch_my_last_seen() from public;
grant execute on function public.touch_my_last_seen() to authenticated;

create or replace function public.send_chat_message(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(p_message);
  p record;
  sent public.messages;
  last_time timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Giriş yapmalısın.';
  end if;

  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  select username, muted_until, avatar_url
  into p
  from public.profiles
  where id = auth.uid();

  if p.username is null then
    raise exception 'Kullanıcı adın bulunamadı.';
  end if;

  if p.muted_until is not null and p.muted_until > now() then
    raise exception 'Sohbet kullanımın geçici olarak kısıtlandı.';
  end if;

  select created_at into last_time
  from public.messages
  where user_id = auth.uid()
  order by created_at desc
  limit 1;

  if last_time is not null and last_time > now() - interval '3 seconds' then
    raise exception 'Yeni mesaj göndermek için biraz bekle.';
  end if;

  insert into public.messages(user_id, username, message, avatar_url)
  values(auth.uid(), p.username, clean, p.avatar_url)
  returning * into sent;

  return jsonb_build_object(
    'ok', true,
    'id', sent.id,
    'user_id', sent.user_id,
    'username', sent.username,
    'message', sent.message,
    'created_at', sent.created_at,
    'edited_at', sent.edited_at,
    'avatar_url', sent.avatar_url
  );
end;
$$;

revoke all on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to authenticated;

create or replace function public.send_anonymous_chat_message(p_message text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(p_message);
  sent public.messages;
begin
  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  insert into public.messages(user_id, username, message, avatar_url)
  values(null, 'Anonim', clean, null)
  returning * into sent;

  return jsonb_build_object(
    'ok', true,
    'id', sent.id,
    'user_id', null,
    'username', 'Anonim',
    'message', sent.message,
    'created_at', sent.created_at,
    'edited_at', sent.edited_at,
    'avatar_url', null
  );
end;
$$;

revoke all on function public.send_anonymous_chat_message(text) from public;
grant execute on function public.send_anonymous_chat_message(text) to anon, authenticated;

-- Keep the public chat small and remove stale messages automatically when new messages arrive.
create or replace function public.prune_atlantis_chat_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.messages
  where created_at < now() - interval '30 days';

  delete from public.messages
  where id in (
    select id
    from public.messages
    order by created_at desc, id desc
    offset 300
  );

  return new;
end;
$$;

revoke all on function public.prune_atlantis_chat_messages() from public;

drop trigger if exists trg_prune_atlantis_chat_messages on public.messages;
create trigger trg_prune_atlantis_chat_messages
after insert on public.messages
for each row
execute function public.prune_atlantis_chat_messages();

notify pgrst, 'reload schema';

commit;
