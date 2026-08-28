-- Optional RLS repair. Only needed if you want UPDATE/UPSERT operations on favorites/blocks later.
begin;
alter table public.user_favorites enable row level security;
alter table public.user_blocks enable row level security;
drop policy if exists "favorites_update_own" on public.user_favorites;
create policy "favorites_update_own" on public.user_favorites for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "blocks_update_own" on public.user_blocks;
create policy "blocks_update_own" on public.user_blocks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
commit;
