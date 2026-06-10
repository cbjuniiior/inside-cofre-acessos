import { getSupabase } from './supabase'
import { logAudit } from './audit'
import { squadLabel } from '../shared/squads'
import type { Member, Role, Squad } from '../shared/types'

export async function listMembers(): Promise<Member[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('members')
    .select('id, email, name, role, squad')
    .order('role')
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as Member[]
}

async function memberName(id: string): Promise<string | null> {
  const sb = getSupabase()
  const { data } = await sb.from('members').select('name, email').eq('id', id).maybeSingle()
  return data?.name ?? data?.email ?? null
}

export async function setMemberRole(id: string, role: Role): Promise<void> {
  // A RLS garante que só admin consegue alterar o papel de outro usuário.
  const sb = getSupabase()
  const { error } = await sb.from('members').update({ role }).eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit(
    'alterou papel de membro',
    null,
    await memberName(id),
    `novo papel: ${role === 'admin' ? 'Admin' : 'Membro'}`
  )
}

export async function setMemberSquad(id: string, squad: Squad | null): Promise<void> {
  // A RLS garante que só admin consegue alterar o squad de um usuário.
  const sb = getSupabase()
  const { error } = await sb.from('members').update({ squad }).eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit('alterou squad de membro', null, await memberName(id), `novo squad: ${squadLabel(squad)}`)
}

/** Admin cria um novo membro (via Edge Function com service_role). */
export async function createMember(
  email: string,
  name: string,
  squad: Squad | null
): Promise<{ tempPassword: string; email: string }> {
  const sb = getSupabase()
  const { data, error } = await sb.functions.invoke('manage-team', {
    body: { action: 'create', email, name, squad }
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  await logAudit('adicionou membro', null, name || email, `${email} · squad ${squadLabel(squad)}`)
  return data as { tempPassword: string; email: string }
}

/** Admin remove um membro do time (apaga a conta de autenticação). */
export async function deleteMember(userId: string): Promise<void> {
  const name = await memberName(userId)
  const sb = getSupabase()
  const { data, error } = await sb.functions.invoke('manage-team', {
    body: { action: 'delete', userId }
  })
  if (error) throw new Error(error.message)
  if (data?.error) throw new Error(data.error)
  await logAudit('removeu membro', null, name)
}
