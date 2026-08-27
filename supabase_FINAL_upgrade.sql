-- Atlantis MC — FINAL Supabase upgrade
-- Run this once AFTER the previous Atlantis schema.
-- This keeps existing accounts/messages and upgrades profile + public chat behavior.

begin;

-- PROFILE FIELDS
alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add column if not exists last_seen timestamptz;

-- MESSAGE FIELDS
alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists avatar_url text;

-- Anonymous messages need no auth.users row.
alter table public.messages
  alter column user_id drop not null;

-- Public profile read.
alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles_public_read" on public.profiles;

create policy "profiles readable"
on public.profiles
for select
to anon, authenticated
using (true);

-- Keep direct profile update possible for authenticated users as fallback.
drop policy if exists "profiles_owner_update" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;

create policy "profiles_owner_update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Public message read.
drop policy if exists "messages readable" on public.messages;
drop policy if exists "messages_auth_select" on public.messages;
drop policy if exists "messages_public_read" on public.messages;

create policy "messages readable"
on public.messages
for select
to anon, authenticated
using (true);

-- Authenticated users can edit/delete only their own messages.
drop policy if exists "messages_owner_update" on public.messages;
create policy "messages_owner_update"
on public.messages
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "own messages delete" on public.messages;
drop policy if exists "messages_owner_delete" on public.messages;

create policy "own messages delete"
on public.messages
for delete
to authenticated
using (user_id = auth.uid());

-- Profile RPC: avoids client-side RLS errors for bio/avatar.
create or replace function public.update_my_profile(
  new_bio text,
  new_avatar_url text
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
    raise exception 'Bio too long';
  end if;

  if new_avatar_url is not null
     and char_length(new_avatar_url) > 1000000 then
    raise exception 'Avatar too large';
  end if;

  update public.profiles
  set
    bio = coalesce(new_bio,''),
    avatar_url = new_avatar_url,
    updated_at = now()
  where id = auth.uid();

  if not found then
    insert into public.profiles(id, username, bio, avatar_url)
    values(
      auth.uid(),
      null,
      coalesce(new_bio,''),
      new_avatar_url
    )
    on conflict (id) do update
    set
      bio = excluded.bio,
      avatar_url = excluded.avatar_url,
      updated_at = now();
  end if;

  select *
  into result
  from public.profiles
  where id = auth.uid();

  return result;
end;
$$;

revoke all on function public.update_my_profile(text,text) from public;
grant execute on function public.update_my_profile(text,text) to authenticated;

-- Authenticated chat sender.
create or replace function public.send_chat_message(
  p_message text
)
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
    raise exception 'not authenticated';
  end if;

  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  select
    username,
    site_role,
    muted_until,
    avatar_url
  into p
  from public.profiles
  where id = auth.uid();

  if p.username is null then
    raise exception 'Kullanıcı adın bulunamadı.';
  end if;

  if p.muted_until is not null
     and p.muted_until > now() then
    raise exception 'Sohbet kullanımın geçici olarak kısıtlandı.';
  end if;

  select created_at
  into last_time
  from public.messages
  where user_id = auth.uid()
  order by created_at desc
  limit 1;

  if last_time is not null
     and last_time > now() - interval '3 seconds' then
    raise exception 'Yeni mesaj göndermek için biraz bekle.';
  end if;

  insert into public.messages(
    user_id,
    username,
    message,
    avatar_url
  )
  values(
    auth.uid(),
    p.username,
    clean,
    p.avatar_url
  );

  return jsonb_build_object(
    'ok', true,
    'muted_until', p.muted_until
  );
end;
$$;

revoke all on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to authenticated;

-- Anonymous public chat sender.
-- Display name is always "Anonim"; no auth identity is stored.
create or replace function public.send_anonymous_chat_message(
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(p_message);
  recent_count integer;
begin
  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  -- Basic global abuse guard. Client also has a 3-second cooldown.
  select count(*)
  into recent_count
  from public.messages
  where user_id is null
    and created_at > now() - interval '3 seconds';

  if recent_count >= 10 then
    raise exception 'Anonim sohbet şu anda çok yoğun. Birkaç saniye bekle.';
  end if;

  insert into public.messages(
    user_id,
    username,
    message,
    avatar_url
  )
  values(
    null,
    'Anonim',
    clean,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'username', 'Anonim'
  );
end;
$$;

revoke all on function public.send_anonymous_chat_message(text) from public;
grant execute on function public.send_anonymous_chat_message(text) to anon, authenticated;

-- Last seen.
create or replace function public.touch_my_last_seen()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set
    last_seen = now(),
    updated_at = now()
  where id = auth.uid();
$$;

revoke all on function public.touch_my_last_seen() from public;
grant execute on function public.touch_my_last_seen() to authenticated;

-- Ensure new auth users get profiles and retain signup username metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(
    id,
    username
  )
  values(
    new.id,
    nullif(
      new.raw_user_meta_data ->> 'username',
      ''
    )
  )
  on conflict (id) do update
  set
    username = coalesce(
      public.profiles.username,
      excluded.username
    ),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert
on auth.users
for each row
execute procedure public.handle_new_user();

-- Keep helper permissions.
revoke all on function public.has_site_role(text) from public;
grant execute on function public.has_site_role(text) to authenticated;

revoke all on function public.set_my_username(text) from public;
grant execute on function public.set_my_username(text) to authenticated;

-- Realtime.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
exception
  when undefined_object then
    null;
end $$;

commit;
