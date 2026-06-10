import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import type { AuditCategory, AuditEntry, AuditQuery } from '../shared/types'

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

export const AUDIT_PAGE_SIZE = 50

// Padrões de ação por categoria (as ações são frases em pt-BR).
const CATEGORY_PATTERNS: Record<AuditCategory, string[]> = {
  perfil: ['%perfil%'],
  sessao: ['%sessão%'],
  equipe: ['%membro%', '%papel%', '%squad%'],
  cofre: ['%cofre%'],
  proxy: ['%proxy%'],
  login: ['%entrou%']
}

/** Remove caracteres que quebram a sintaxe do filtro `or()` do PostgREST. */
function sanitizeLike(s: string): string {
  return s.replace(/[,()]/g, ' ').trim()
}

/** Consulta paginada e filtrada do log (página de Logs do admin). */
export async function queryAudit(q: AuditQuery): Promise<AuditEntry[]> {
  const user = await getCurrentUser()
  if (user?.role !== 'admin') throw new Error('Apenas administradores podem ver o log de atividades.')
  const sb = getSupabase()
  let query = sb
    .from('audit_log')
    .select('id, profile_id, profile_name, user_email, user_name, action, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(AUDIT_PAGE_SIZE)
  if (q.userEmail) query = query.eq('user_email', q.userEmail)
  if (q.category && CATEGORY_PATTERNS[q.category]) {
    query = query.or(CATEGORY_PATTERNS[q.category].map((p) => `action.ilike.${p}`).join(','))
  }
  if (q.search?.trim()) {
    const s = sanitizeLike(q.search)
    if (s) {
      query = query.or(
        ['user_name', 'user_email', 'profile_name', 'action', 'detail']
          .map((col) => `${col}.ilike.%${s}%`)
          .join(',')
      )
    }
  }
  if (q.before) query = query.lt('created_at', q.before)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as AuditEntry[]
}
