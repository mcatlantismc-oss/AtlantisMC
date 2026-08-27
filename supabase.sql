-- Atlantis MC / Supabase migration
-- Run this in Supabase SQL Editor AFTER making a backup / confirming current schema.

begin;

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add column if not exists last_seen timestamptz;

alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists avatar_url text;

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read"
on public.profiles
for select to anon, authenticated
using (true);

drop policy if exists "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update"
on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "messages_auth_select" on public.messages;
create policy "messages_auth_select"
on public.messages
for select to authenticated
using (true);

drop policy if exists "messages_owner_update" on public.messages;
create policy "messages_owner_update"
on public.messages
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "messages_owner_delete" on public.messages;
create policy "messages_owner_delete"
on public.messages
for delete to authenticated
using (user_id = auth.uid());

create or replace function public.touch_my_last_seen()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles
  set last_seen = now()
  where id = auth.uid();
$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

commit;
