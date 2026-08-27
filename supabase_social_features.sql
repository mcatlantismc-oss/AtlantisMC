-- AtlantisMC — Sosyal özellikler (1/2)
-- Bu dosya TABLOLARI oluşturur.
-- Favori arkadaş + kişisel not + kullanıcı engelleme.
-- RLS ayrı dosyada: supabase_social_features_RLS.sql
--
-- ÖNEMLİ:
-- RLS kurulmadan önce bu özellikleri herkese açık production'da kullanma.
-- 2. SQL dosyasını da çalıştırmadan kullanıcıların verilerini bu tablolara yazdırma.

begin;

create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  favorite_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, favorite_user_id),
  constraint user_favorites_not_self check (user_id <> favorite_user_id)
);

create table if not exists public.user_private_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, target_user_id),
  constraint user_private_notes_not_self check (user_id <> target_user_id),
  constraint user_private_notes_length check (char_length(note) <= 500)
);

create table if not exists public.user_blocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, blocked_user_id),
  constraint user_blocks_not_self check (user_id <> blocked_user_id)
);

create index if not exists user_favorites_user_idx
  on public.user_favorites(user_id, created_at desc);

create index if not exists user_private_notes_user_idx
  on public.user_private_notes(user_id, updated_at desc);

create index if not exists user_blocks_user_idx
  on public.user_blocks(user_id, created_at desc);

-- Gerekli PostgREST erişimini sadece authenticated kullanıcıya aç.
-- RLS ikinci dosyada bu erişimi satır bazında sınırlar.
grant select, insert, update, delete
  on public.user_favorites
  to authenticated;

grant select, insert, update, delete
  on public.user_private_notes
  to authenticated;

grant select, insert, update, delete
  on public.user_blocks
  to authenticated;

commit;
