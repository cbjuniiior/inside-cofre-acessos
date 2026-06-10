import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import { logAudit } from './audit'
import type { Profile, ProfileInput } from '../shared/types'

interface ProfileRow {
  id: string
  client_name: string
  service: Profile['service']
  squad: Profile['squad']
  url: string
  tags: string[] | null
  proxy_id: string | null
  needs_login: boolean
  in_use_by: string | null
  in_use_by_email: string | null
  in_use_by_name: string | null
  in_use_at: string | null
  has_session?: boolean
  updated_at: string
  created_at: string
}

function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    client_name: r.client_name,
    service: r.service,
    squad: r.squad ?? null,
    url: r.url,
    tags: r.tags ?? [],
    proxy_id: r.proxy_id,
    needs_login: r.needs_login ?? false,
    in_use_by: r.in_use_by,
    in_use_by_email: r.in_use_by_email,
    in_use_by_name: r.in_use_by_name,
    in_use_at: r.in_use_at,
    has_session: Boolean(r.has_session),
    updated_at: r.updated_at,
    created_at: r.created_at
  }
}

export async function listProfiles(): Promise<Profile[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('profiles')
    .select('*, sessions(profile_id)')
    .order('client_name')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: Record<string, unknown>) => {
    // sessions.profile_id é PK+FK (relação 1-para-1): o PostgREST devolve
    // `sessions` como objeto (ou null), não como array.
    const s = r.sessions
    const hasSession = Array.isArray(s) ? s.length > 0 : s != null
    return rowToProfile({ ...(r as unknown as ProfileRow), has_session: hasSession })
  })
}

export async function createProfile(input: ProfileInput): Promise<Profile> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const row = {
    client_name: input.client_name,
    service: input.service,
    squad: input.squad,
    url: input.url,
    tags: input.tags,
    proxy_id: input.proxy_id,
    created_by: user?.id ?? null
  }
  const { data, error } = await sb.from('profiles').insert(row).select('*').single()
  if (error) throw new Error(error.message)
  await logAudit('criou perfil', data.id, input.client_name)
  return rowToProfile(data as ProfileRow)
}

export async function updateProfile(id: string, input: ProfileInput): Promise<Profile> {
  const sb = getSupabase()
  const row = {
    client_name: input.client_name,
    service: input.service,
    squad: input.squad,
    url: input.url,
    tags: input.tags,
    proxy_id: input.proxy_id,
    updated_at: new Date().toISOString()
  }
  const { data, error } = await sb.from('profiles').update(row).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  await logAudit('editou perfil', id, input.client_name)
  return rowToProfile(data as ProfileRow)
}

export async function removeProfile(id: string): Promise<void> {
  const sb = getSupabase()
  const { data } = await sb.from('profiles').select('client_name').eq('id', id).maybeSingle()
  const { error } = await sb.from('profiles').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit('excluiu perfil', null, data?.client_name ?? null)
}
