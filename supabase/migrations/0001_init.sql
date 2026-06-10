-- Inside Cofre de Acessos — schema inicial
-- Aplicar no SQL Editor do Supabase (ou via MCP/psql com a service_role).

-- 1 linha única guardando o salt + verifier da senha-mestra do workspace.
create table if not exists public.workspace (
  id int primary key default 1,
  kdf_salt text not null,
  verifier_ciphertext text not null,
  verifier_iv text not null,
  verifier_tag text not null,
  created_at timestamptz not null default now(),
  constraint workspace_single_row check (id = 1)
);

-- Perfis (uma conta de cliente = um perfil de navegador isolado).
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  service text not null default 'outro',
  url text not null,
  tags text[] not null default '{}',
  proxy_enabled boolean not null default false,
  proxy_host text,
  proxy_port int,
  proxy_creds_ciphertext text,
  proxy_creds_iv text,
  proxy_creds_tag text,
  in_use_by uuid references auth.users(id) on delete set null,
  in_use_by_email text,
  in_use_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Sessão (cookies) criptografada por perfil.
create table if not exists public.sessions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  tag text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

-- Log de auditoria: quem fez o quê e quando.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  profile_name text,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

-- RLS: app interno do time — todo membro autenticado tem acesso total.
alter table public.workspace enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.audit_log enable row level security;

create policy "team full access" on public.workspace
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.profiles
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.sessions
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.audit_log
  for all to authenticated using (true) with check (true);
