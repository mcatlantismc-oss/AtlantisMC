-- AtlantisMC — moderation hierarchy + chat lock + clear chat patch
-- Idempotent. Run once in Supabase SQL Editor after the existing moderation/social SQL.
-- Does not delete users. The clear-chat RPC only deletes chat messages when explicitly called.

begin;

alter table public.profiles
  add column if not exists banned_until timestamptz,
  add column if not exists ban_reason text;

create table if not exists public.chat_settings (
  id integer primary key,
  chat_locked boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.chat_settings (id, chat_locked)
values (1, false)
on conflict (id) do nothing;

alter table public.chat_settings enable row level security;

grant select on public.chat_settings to anon, authenticated;

drop policy if exists "chat_settings_select_public" on public.chat_settings;
create policy "chat_settings_select_public"
on public.chat_settings
for select
to anon, authenticated
using (true);

-- Make chat-lock updates visible to Supabase Realtime clients.
alter table public.chat_settings replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'chat_settings'
     ) then
    execute 'alter publication supabase_realtime add table public.chat_settings';
  end if;
exception when others then
  raise notice 'Realtime publication update skipped: %', sqlerrm;
end $$;

-- Server-side hierarchy: admins can moderate normal users and moderators;
-- moderators can moderate normal users only; nobody can moderate an admin.
drop function if exists public.moderation_set_mute(uuid,integer);
create function public.moderation_set_mute(target_user_id uuid, duration_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  own_role text;
  target_role text;
  until_time timestamptz;
begin
  select site_role into own_role
  from public.profiles
  where id = auth.uid();

  if own_role not in ('admin','moderator') then
    raise exception 'no permission';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'cannot mute yourself';
  end if;

  if duration_seconds < -1 then
    raise exception 'invalid duration';
  end if;

  select site_role into target_role
  from public.profiles
  where id = target_user_id;

  if target_role is null then
    raise exception 'user not found';
  end if;

  if target_role = 'admin' then
    raise exception 'cannot mute admin';
  end if;

  if own_role = 'moderator' and target_role = 'moderator' then
    raise exception 'moderators cannot mute other moderators';
  end if;

  if duration_seconds = 0 then
    until_time := null;
  elsif duration_seconds = -1 then
    until_time := '9999-12-31 23:59:59+00'::timestamptz;
  else
    until_time := now() + make_interval(secs => duration_seconds);
  end if;

  update public.profiles
  set muted_until = until_time,
      updated_at = now()
  where id = target_user_id;

  return until_time;
end;
$$;
revoke all on function public.moderation_set_mute(uuid,integer) from public;
grant execute on function public.moderation_set_mute(uuid,integer) to authenticated;

drop function if exists public.moderation_set_ban(uuid,integer,text);
create function public.moderation_set_ban(target_user_id uuid, duration_seconds integer, reason text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  own_role text;
  target_role text;
  until_time timestamptz;
begin
  select site_role into own_role
  from public.profiles
  where id = auth.uid();

  if own_role not in ('admin','moderator') then
    raise exception 'no permission';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'cannot ban yourself';
  end if;

  if duration_seconds < 0 then
    raise exception 'invalid duration';
  end if;

  select site_role into target_role
  from public.profiles
  where id = target_user_id;

  if target_role is null then
    raise exception 'user not found';
  end if;

  if target_role = 'admin' then
    raise exception 'cannot ban admin';
  end if;

  if own_role = 'moderator' and target_role = 'moderator' then
    raise exception 'moderators cannot ban other moderators';
  end if;

  if duration_seconds = 0 then
    until_time := null;
  else
    until_time := now() + make_interval(secs => duration_seconds);
  end if;

  update public.profiles
  set banned_until = until_time,
      ban_reason = nullif(btrim(coalesce(reason,'')),''),
      updated_at = now()
  where id = target_user_id;

  return until_time;
end;
$$;
revoke all on function public.moderation_set_ban(uuid,integer,text) from public;
grant execute on function public.moderation_set_ban(uuid,integer,text) to authenticated;

-- Lock/unlock chat for moderators and admins.
drop function if exists public.moderation_set_chat_lock(boolean);
create function public.moderation_set_chat_lock(lock_chat boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare own_role text;
begin
  select site_role into own_role from public.profiles where id = auth.uid();
  if own_role not in ('admin','moderator') then raise exception 'no permission'; end if;

  update public.chat_settings
  set chat_locked = lock_chat,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1;

  return lock_chat;
end;
$$;
revoke all on function public.moderation_set_chat_lock(boolean) from public;
grant execute on function public.moderation_set_chat_lock(boolean) to authenticated;

drop function if exists public.is_chat_locked();
create function public.is_chat_locked()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select chat_locked from public.chat_settings where id = 1), false);
$$;
revoke all on function public.is_chat_locked() from public;
grant execute on function public.is_chat_locked() to anon, authenticated;

-- Delete every current chat message. Only moderators/admins can execute it.
drop function if exists public.moderation_clear_chat();
create function public.moderation_clear_chat()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  own_role text;
  deleted_count integer;
begin
  select site_role into own_role from public.profiles where id = auth.uid();
  if own_role not in ('admin','moderator') then raise exception 'no permission'; end if;

  delete from public.messages;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.moderation_clear_chat() from public;
grant execute on function public.moderation_clear_chat() to authenticated;

-- Keep role checks consistent for any existing client/server callers.
drop function if exists public.has_site_role(text);
create function public.has_site_role(required_role text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare current_role text;
begin
  select site_role into current_role from public.profiles where id = auth.uid();
  if current_role = 'admin' then return true; end if;
  if required_role = 'admin' then return false; end if;
  return current_role = 'moderator';
end;
$$;
revoke all on function public.has_site_role(text) from public;
grant execute on function public.has_site_role(text) to authenticated;

-- Moderator/admin message deletion.
drop function if exists public.moderation_delete_message(bigint);
create function public.moderation_delete_message(target_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_site_role('moderator') then raise exception 'no permission'; end if;
  delete from public.messages where id = target_message_id;
  return true;
end;
$$;
revoke all on function public.moderation_delete_message(bigint) from public;
grant execute on function public.moderation_delete_message(bigint) to authenticated;

-- Authenticated sending: block chat-locked normal users and muted/banned users.
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
  if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
  if char_length(clean) < 1 or char_length(clean) > 300 then raise exception 'Mesaj 1-300 karakter olmalı.'; end if;

  select username, muted_until, banned_until, avatar_url, site_role
  into p
  from public.profiles
  where id = auth.uid();

  if p.username is null then raise exception 'Kullanıcı adın bulunamadı.'; end if;
  if p.banned_until is not null and p.banned_until > now() then raise exception 'Hesabın geçici olarak yasaklandı.'; end if;
  if p.muted_until is not null and p.muted_until > now() then raise exception 'Sohbet kullanımın geçici olarak kısıtlandı.'; end if;
  if public.is_chat_locked() and p.site_role not in ('admin','moderator') then raise exception 'Sohbet moderatörler tarafından kilitlendi.'; end if;

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
    'ok',true,'id',sent.id,'user_id',sent.user_id,'username',sent.username,
    'message',sent.message,'created_at',sent.created_at,'edited_at',sent.edited_at,
    'avatar_url',sent.avatar_url
  );
end;
$$;
revoke all on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to authenticated;

-- Anonymous users can still read the chat but cannot write while chat-lock is active.
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
  if public.is_chat_locked() then raise exception 'Sohbet moderatörler tarafından kilitlendi.'; end if;
  if char_length(clean) < 1 or char_length(clean) > 300 then raise exception 'Mesaj 1-300 karakter olmalı.'; end if;

  insert into public.messages(user_id, username, message, avatar_url)
  values(null,'Anonim',clean,null)
  returning * into sent;

  return jsonb_build_object(
    'ok',true,'id',sent.id,'user_id',null,'username','Anonim',
    'message',sent.message,'created_at',sent.created_at,'edited_at',sent.edited_at,
    'avatar_url',null
  );
end;
$$;
revoke all on function public.send_anonymous_chat_message(text) from public;
grant execute on function public.send_anonymous_chat_message(text) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
