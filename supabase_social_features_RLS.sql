-- AtlantisMC — Sosyal özellikler (2/2)
-- RLS: kişisel favori / not / engelleme kayıtlarını hesap sahibine kilitler.
-- Supabase SQL Editor'da, 1. dosyadan SONRA çalıştır.

begin;

alter table public.user_favorites enable row level security;
alter table public.user_private_notes enable row level security;
alter table public.user_blocks enable row level security;

drop policy if exists "favorites_select_own" on public.user_favorites;
create policy "favorites_select_own"
on public.user_favorites
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "favorites_insert_own" on public.user_favorites;
create policy "favorites_insert_own"
on public.user_favorites
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "favorites_delete_own" on public.user_favorites;
create policy "favorites_delete_own"
on public.user_favorites
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "private_notes_select_own" on public.user_private_notes;
create policy "private_notes_select_own"
on public.user_private_notes
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "private_notes_insert_own" on public.user_private_notes;
create policy "private_notes_insert_own"
on public.user_private_notes
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "private_notes_update_own" on public.user_private_notes;
create policy "private_notes_update_own"
on public.user_private_notes
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "private_notes_delete_own" on public.user_private_notes;
create policy "private_notes_delete_own"
on public.user_private_notes
for delete
to authenticated
using (user_id = auth.uid());

drop policy if exists "blocks_select_own" on public.user_blocks;
create policy "blocks_select_own"
on public.user_blocks
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "blocks_insert_own" on public.user_blocks;
create policy "blocks_insert_own"
on public.user_blocks
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "blocks_delete_own" on public.user_blocks;
create policy "blocks_delete_own"
on public.user_blocks
for delete
to authenticated
using (user_id = auth.uid());

commit;
