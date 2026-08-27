-- Atlantis MC — moderation extension
-- Safe to run after the existing Atlantis SQL.
-- Does not delete users or messages.

begin;

-- Ensure moderation functions exist and are executable by authenticated users.
create or replace function public.has_site_role(required_role text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  current_role text;
begin
  select site_role into current_role from public.profiles where id = auth.uid();
  if current_role = 'admin' then return true; end if;
  if required_role = 'admin' then return false; end if;
  return current_role = 'moderator';
end;
$$;
revoke all on function public.has_site_role(text) from public;
grant execute on function public.has_site_role(text) to authenticated;

create or replace function public.moderation_delete_message(target_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_site_role('moderator') then
    raise exception 'no permission';
  end if;
  delete from public.messages where id = target_message_id;
  return true;
end;
$$;
revoke all on function public.moderation_delete_message(bigint) from public;
grant execute on function public.moderation_delete_message(bigint) to authenticated;

create or replace function public.moderation_set_mute(target_user_id uuid, duration_seconds integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  until_time timestamptz;
begin
  if not public.has_site_role('moderator') then
    raise exception 'no permission';
  end if;

  if duration_seconds < 0 then
    raise exception 'invalid duration';
  end if;

  select site_role into target_role from public.profiles where id = target_user_id;

  if target_role = 'admin' and (select site_role from public.profiles where id = auth.uid()) <> 'admin' then
    raise exception 'cannot mute admin';
  end if;

  if duration_seconds = 0 then
    until_time := null;
  else
    until_time := now() + make_interval(secs => duration_seconds);
  end if;

  update public.profiles
  set muted_until = until_time, updated_at = now()
  where id = target_user_id;

  return until_time;
end;
$$;
revoke all on function public.moderation_set_mute(uuid,integer) from public;
grant execute on function public.moderation_set_mute(uuid,integer) to authenticated;

create or replace function public.admin_set_role(target_user_id uuid, new_role text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare own_role text;
begin
  select site_role into own_role from public.profiles where id = auth.uid();
  if own_role <> 'admin' then raise exception 'no permission'; end if;
  if new_role not in ('user','moderator','admin') then raise exception 'invalid role'; end if;
  if target_user_id = auth.uid() then raise exception 'cannot change your own role'; end if;
  update public.profiles set site_role = new_role, updated_at = now() where id = target_user_id;
  return true;
end;
$$;
revoke all on function public.admin_set_role(uuid,text) from public;
grant execute on function public.admin_set_role(uuid,text) to authenticated;

-- Keep required chat/profile read permissions.
alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
for select to anon, authenticated using (true);

drop policy if exists "messages readable" on public.messages;
create policy "messages readable" on public.messages
for select to anon, authenticated using (true);

notify pgrst, 'reload schema';
commit;
