# Inside Cofre de Acessos

App desktop (Windows/Mac) estilo ADSPower para o time acessar contas de clientes
(Gmail, Hostinger, cPanel…) com **sessões de navegador isoladas, criptografadas e
sincronizadas**, cada perfil com seu próprio **proxy/IP**. Quem abre o perfil entra já
logado — o 2FA é feito uma vez e a sessão é reaproveitada.

> Não é um antidetect/fingerprint-spoofing. É gestão de acesso autorizado, com cripto
> ponta-a-ponta (senha-mestra) e log de auditoria.

## Stack

- Electron + electron-vite + React + TypeScript + Tailwind
- Supabase (Auth do time + Postgres) para o sync
- AES-256-GCM + scrypt (senha-mestra) — o servidor nunca vê dados em claro

## Setup

1. **Dependências:** `npm install`
2. **Banco:** abra o SQL Editor do seu Supabase e rode `supabase/migrations/0001_init.sql`.
3. **Usuários do time:** crie os membros em Authentication → Users no painel do Supabase.
4. **.env:** copie `.env.example` para `.env` e preencha:
   ```
   MAIN_VITE_SUPABASE_URL=...
   MAIN_VITE_SUPABASE_ANON_KEY=...
   ```
   (Nunca coloque a `service_role` no `.env` do app.)
5. **Rodar:** `npm run dev`

## Primeiro uso

1. Login com um usuário do time (Supabase Auth).
2. Defina a **senha-mestra** do workspace (a mesma para todo o time — protege as sessões).
   Ela não é recuperável; guarde com cuidado.
3. Crie um perfil, clique em **Abrir**, faça login na conta do cliente (com 2FA na 1ª vez).
4. Feche a janela do perfil → a sessão é criptografada e sincronizada.
5. Em outra máquina, o mesmo perfil abre já logado.

## Build

- Windows: `npm run build:win` → `dist/*.exe`
- Mac: `npm run build:mac` → `dist/*.dmg` (precisa assinar/notarizar para distribuir)

## Escopo do MVP

Sync de **cookies** (cobre "manter logado" do Google e da maioria dos painéis).
localStorage/IndexedDB e fingerprint ficam para a v2.
