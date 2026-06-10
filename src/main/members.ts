import { getSupabase } from './supabase'
import type { Member, Role } from '../shared/types'

export async function listMembers(): Promise<Member[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('members')
    .select('id, email, name, role')
    .order('role')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Member[]
}

export async function setMemberRole(id: string, role: Role): Promise<void> {
  // A RLS garante que só admin consegue alterar o papel de outro usuário.
  const sb = getSupabase()
  const { error } = await sb.from('members').update({ role }).eq('id', id)
  if (error) throw new Error(error.message)
}

/** Admin cria um novo membro (via Edge Function com service_role). */
export async function createMember(
  email: string,
  name: string
): Promise<{ tempPassword: string; email: string }> {
  const sb = getSupabase()
  const { data, error } = await sb.functions.invoke('manage-team', {
    body: { action: 'create', email, name }
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  return data as { tempPassword: string; email: string }
}

/** Admin remove um membro do time (apaga a conta de autenticação). */
export async function deleteMember(userId: string): Promise<void> {
  const sb = getSupabase()
  const { data, error } = await sb.functions.invoke('manage-team', {
    body: { action: 'delete', userId }
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
}
