-- Inside Cofre de Acessos — squads de membros + log de auditoria detalhado
-- Aplicar no SQL Editor do Supabase (ou via MCP/psql).

-- Squad do membro: null = "Inside" (vê apenas acessos Inside); admins veem tudo.
alter table public.members add column if not exists squad text
  check (squad is null or squad in ('genesis', 'high_impact'));

-- Detalhe livre nas entradas de auditoria (log mais rico).
alter table public.audit_log add column if not exists detail text;

-- Squad do usuário logado (security definer para uso em policies).
create or replace function public.current_squad()
returns text
language sql
stable security definer
set search_path to 'public'
as $$
  select squad from public.members where id = auth.uid();
$$;

-- profiles: membro vê acessos do próprio squad + os marcados como Inside (squad null).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (is_admin() or squad is null or squad = public.current_squad());

-- sessions: visibilidade/escrita acompanham a visibilidade do perfil (via RLS de profiles).
drop policy if exists "team full access" on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id));
create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = profile_id));
create policy sessions_update on public.sessions
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id))
  with check (exists (select 1 from public.profiles p where p.id = profile_id));
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id));

-- audit_log: só admin lê; qualquer autenticado insere; ninguém edita/apaga (log imutável).
drop policy if exists "team full access" on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (is_admin());
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (true);

-- members: membro pode atualizar o próprio registro (nome), mas não pode trocar
-- o próprio squad nem virar admin; admin pode tudo.
drop policy if exists members_update on public.members;
create policy members_update on public.members
  for update to authenticated
  using (is_admin() or id = auth.uid())
  with check (
    is_admin()
    or (
      id = auth.uid()
      and role = 'member'
      and squad is not distinct from public.current_squad()
    )
  );
