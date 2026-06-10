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
