-- AtlantisMC — Anonymous chat read-only + moderation hardening
-- Run once after the existing AtlantisMC moderation/final SQL patches.
-- Safe/idempotent. Does not delete existing users or messages.
begin;

-- Anonymous visitors may READ chat, but may not INSERT directly.
revoke insert on public.messages from anon;
drop policy if exists "messages_anon_insert" on public.messages;

-- Remove the old anonymous-send RPC so the browser cannot call a security-definer
-- function that creates messages without authentication.
drop function if exists public.send_anonymous_chat_message(text);

-- Make authenticated sending the only supported chat-write path.
drop policy if exists "messages_auth_insert" on public.messages;
create policy "messages_auth_insert"
on public.messages for insert
to authenticated
with check (user_id = auth.uid());

-- Keep message reads public.
grant select on public.messages to anon, authenticated;

-- Strict role hierarchy: moderators can act only on normal users;
-- admins can act on normal users and moderators, but never another admin.
drop function if exists public.moderation_set_mute(uuid,integer);
create function public.moderation_set_mute(
  target_user_id uuid,
  duration_seconds integer
)
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
  select lower(trim(site_role)) into own_role
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

  select lower(trim(site_role)) into target_role
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

-- Only admins can promote/demote moderators. Admins themselves cannot be changed here.
drop function if exists public.admin_set_role(uuid,text);
create function public.admin_set_role(
  target_user_id uuid,
  new_role text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  own_role text;
  target_role text;
  clean_role text := lower(trim(coalesce(new_role,'')));
begin
  select lower(trim(site_role)) into own_role
  from public.profiles
  where id = auth.uid();

  if own_role <> 'admin' then
    raise exception 'no permission';
  end if;

  if clean_role not in ('user','moderator') then
    raise exception 'invalid role';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  select lower(trim(site_role)) into target_role
  from public.profiles
  where id = target_user_id;

  if target_role is null then
    raise exception 'user not found';
  end if;

  if target_role = 'admin' then
    raise exception 'admin role cannot be changed here';
  end if;

  update public.profiles
  set site_role = clean_role,
      updated_at = now()
  where id = target_user_id;

  return true;
end;
$$;
revoke all on function public.admin_set_role(uuid,text) from public;
grant execute on function public.admin_set_role(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
