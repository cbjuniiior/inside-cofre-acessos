import { getSupabase } from './supabase'
import type { AuthUser, Role } from '../shared/types'
import type { User } from '@supabase/supabase-js'

function nameFromMetadata(meta: Record<string, unknown> | undefined, email: string): string {
  const full = meta?.full_name
  return typeof full === 'string' && full.trim() ? full.trim() : email
}

/** Registra/atualiza o membro do time e resolve o papel (admin/membro). */
async function resolveUser(user: User): Promise<AuthUser> {
  const email = user.email ?? ''
  const name = nameFromMetadata(user.user_metadata, email)
  const sb = getSupabase()
  // Upsert preserva o role existente (não enviamos role no payload).
  await sb.from('members').upsert({ id: user.id, email, name }, { onConflict: 'id' })
  const { data } = await sb.from('members').select('role').eq('id', user.id).maybeSingle()
  const role: Role = data?.role === 'admin' ? 'admin' : 'member'
  return { id: user.id, email, name, role }
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const sb = getSupabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  if (!data.user?.email) throw new Error('Usuário sem e-mail válido.')
  return resolveUser(data.user)
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut()
  if (error) throw new Error(error.message)
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const { data } = await getSupabase().auth.getUser()
  if (!data.user?.email) return null
  return resolveUser(data.user)
}

export async function updateName(name: string): Promise<AuthUser> {
  const sb = getSupabase()
  const { data, error } = await sb.auth.updateUser({ data: { full_name: name.trim() } })
  if (error) throw new Error(error.message)
  if (!data.user?.email) throw new Error('Sessão inválida.')
  await sb.from('members').update({ name: name.trim() }).eq('id', data.user.id)
  return resolveUser(data.user)
}

export async function changePassword(newPassword: string): Promise<void> {
  if (newPassword.length < 6) throw new Error('A senha deve ter ao menos 6 caracteres.')
  const { error } = await getSupabase().auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}
