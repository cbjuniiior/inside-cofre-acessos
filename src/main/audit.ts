import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import type { AuditEntry } from '../shared/types'

export async function logAudit(
  action: string,
  profileId: string | null,
  profileName: string | null,
  detail: string | null = null
): Promise<void> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const { error } = await sb.from('audit_log').insert({
    profile_id: profileId,
    profile_name: profileName,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    user_name: user?.name ?? null,
    action,
    detail
  })
  if (error) console.error('Falha ao registrar auditoria:', error.message)
}

export async function listAudit(): Promise<AuditEntry[]> {
  const user = await getCurrentUser()
  // A RLS também bloqueia, mas aqui devolvemos um erro claro.
  if (user?.role !== 'admin') throw new Error('Apenas administradores podem ver o log de atividades.')
  const sb = getSupabase()
  const { data, error } = await sb
    .from('audit_log')
    .select('id, profile_id, profile_name, user_email, user_name, action, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(error.message)
  return (data ?? []) as AuditEntry[]
}
