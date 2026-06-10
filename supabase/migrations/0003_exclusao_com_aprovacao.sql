-- Inside Cofre de Acessos — membros criam perfis; exclusão de membro exige aprovação de admin.

-- Exclusão pendente: membro solicita, admin aprova (delete real) ou recusa (restaura).
alter table public.profiles
  add column if not exists pending_delete boolean not null default false,
  add column if not exists delete_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists delete_requested_by_name text,
  add column if not exists delete_requested_at timestamptz;

-- Membros podem criar perfis, mas só dentro do que enxergam (Inside ou o próprio squad).
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (is_admin() or squad is null or squad = public.current_squad());

-- Delete real continua exclusivo de admin (membro apenas marca pending_delete via update).
