-- Atlantis MC — FINAL CHAT/PERMISSION REPAIR
-- Run once in Supabase SQL Editor.
-- Does NOT delete users or messages.

begin;

alter table public.messages
  alter column user_id drop not null;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

-- Public read for the chat.
drop policy if exists "messages readable" on public.messages;
drop policy if exists "messages_public_read" on public.messages;
drop policy if exists "messages_auth_select" on public.messages;

create policy "messages readable"
on public.messages
for select
to anon, authenticated
using (true);

-- Logged-in users may modify only their own messages.
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

-- Anonymous fallback insert. The RPC remains the primary path.
drop policy if exists "messages_anon_insert" on public.messages;
create policy "messages_anon_insert"
on public.messages
for insert
to anon
with check (
  user_id is null
  and username = 'Anonim'
  and char_length(btrim(message)) between 1 and 300
  and avatar_url is null
);

-- Logged-in fallback is restricted to the caller's own UUID.
drop policy if exists "messages_auth_insert" on public.messages;
create policy "messages_auth_insert"
on public.messages
for insert
to authenticated
with check (user_id = auth.uid());

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
begin
  if char_length(clean) < 1 or char_length(clean) > 300 then
    raise exception 'Mesaj 1-300 karakter olmalı.';
  end if;

  insert into public.messages(
    user_id, username, message, avatar_url
  )
  values(
    null, 'Anonim', clean, null
  );

  return jsonb_build_object(
    'ok', true,
    'username', 'Anonim'
  );
end;
$$;

revoke all on function public.send_anonymous_chat_message(text) from public;
grant execute on function public.send_anonymous_chat_message(text) to anon, authenticated;

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

  select created_at
  into last_time
  from public.messages
  where user_id = auth.uid()
  order by created_at desc
  limit 1;

  if last_time is not null and last_time > now() - interval '3 seconds' then
    raise exception 'Yeni mesaj göndermek için biraz bekle.';
  end if;

  insert into public.messages(
    user_id, username, message, avatar_url
  )
  values(
    auth.uid(), p.username, clean, p.avatar_url
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.send_chat_message(text) from public;
grant execute on function public.send_chat_message(text) to authenticated;

create or replace function public.update_my_profile(
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
  set
    avatar_url = new_avatar_url,
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

revoke all on function public.update_my_profile(text,text) from public;
grant execute on function public.update_my_profile(text,text) to authenticated;

-- Profile reads are public, edits are owner-only.
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles readable"
on public.profiles
for select
to anon, authenticated
using (true);

drop policy if exists "profiles_owner_update" on public.profiles;
drop policy if exists "users update own profile" on public.profiles;
create policy "profiles_owner_update"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- Ensure Realtime is enabled for messages.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
exception
  when undefined_object then
    null;
end $$;

notify pgrst, 'reload schema';

commit;
