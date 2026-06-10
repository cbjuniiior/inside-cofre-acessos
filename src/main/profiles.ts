import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import { logAudit } from './audit'
import { squadLabel } from '../shared/squads'
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
  pending_delete?: boolean
  delete_requested_by: string | null
  delete_requested_by_name: string | null
  delete_requested_at: string | null
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
    pending_delete: Boolean(r.pending_delete),
    delete_requested_by: r.delete_requested_by ?? null,
    delete_requested_by_name: r.delete_requested_by_name ?? null,
    delete_requested_at: r.delete_requested_at ?? null,
    updated_at: r.updated_at,
    created_at: r.created_at
  }
}

export async function listProfiles(): Promise<Profile[]> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const { data, error } = await sb
    .from('profiles')
    .select('*, sessions(profile_id)')
    .order('client_name')
  if (error) throw new Error(error.message)
  const all = (data ?? []).map((r: Record<string, unknown>) => {
    // sessions.profile_id é PK+FK (relação 1-para-1): o PostgREST devolve
    // `sessions` como objeto (ou null), não como array.
    const s = r.sessions
    const hasSession = Array.isArray(s) ? s.length > 0 : s != null
    return rowToProfile({ ...(r as unknown as ProfileRow), has_session: hasSession })
  })
  // Perfis com exclusão pendente ficam ocultos para membros; admins os veem
  // (a tela mostra a fila de aprovação).
  return user?.role === 'admin' ? all : all.filter((p) => !p.pending_delete)
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
  await logAudit(
    'criou perfil',
    data.id,
    input.client_name,
    `${input.service} · squad ${squadLabel(input.squad)} · ${input.url}`
  )
  return rowToProfile(data as ProfileRow)
}

/** Resume o que mudou entre o perfil salvo e o novo input (para o log). */
function diffProfile(old: ProfileRow, input: ProfileInput): string | null {
  const changes: string[] = []
  if (old.client_name !== input.client_name) changes.push(`cliente: ${old.client_name} → ${input.client_name}`)
  if ((old.squad ?? null) !== input.squad)
    changes.push(`squad: ${squadLabel(old.squad ?? null)} → ${squadLabel(input.squad)}`)
  if (old.service !== input.service) changes.push(`serviço: ${old.service} → ${input.service}`)
  if (old.url !== input.url) changes.push('URL')
  if ((old.tags ?? []).join(',') !== input.tags.join(',')) changes.push('tags')
  if ((old.proxy_id ?? null) !== input.proxy_id) changes.push('proxy')
  return changes.length ? changes.join(' · ') : null
}

export async function updateProfile(id: string, input: ProfileInput): Promise<Profile> {
  const sb = getSupabase()
  const { data: old } = await sb.from('profiles').select('*').eq('id', id).maybeSingle()
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
  await logAudit(
    'editou perfil',
    id,
    input.client_name,
    old ? diffProfile(old as ProfileRow, input) : null
  )
  return rowToProfile(data as ProfileRow)
}

/** Membro pede a exclusão: o perfil fica oculto até um admin aprovar ou recusar. */
export async function requestDeleteProfile(id: string): Promise<void> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const { data, error } = await sb
    .from('profiles')
    .update({
      pending_delete: true,
      delete_requested_by: user?.id ?? null,
      delete_requested_by_name: user?.name ?? user?.email ?? null,
      delete_requested_at: new Date().toISOString()
    })
    .eq('id', id)
    .select('client_name')
    .single()
  if (error) throw new Error(error.message)
  await logAudit(
    'solicitou exclusão de perfil',
    id,
    data?.client_name ?? null,
    'aguardando aprovação de um admin'
  )
}

/** Admin aprova a exclusão solicitada: apaga o perfil de verdade. */
export async function approveDeleteProfile(id: string): Promise<void> {
  const user = await getCurrentUser()
  if (user?.role !== 'admin') throw new Error('Apenas administradores podem aprovar exclusões.')
  const sb = getSupabase()
  const { data } = await sb
    .from('profiles')
    .select('client_name, delete_requested_by_name')
    .eq('id', id)
    .maybeSingle()
  const { error } = await sb.from('profiles').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit(
    'aprovou exclusão de perfil',
    null,
    data?.client_name ?? null,
    data?.delete_requested_by_name ? `solicitada por ${data.delete_requested_by_name}` : null
  )
}

/** Admin recusa a exclusão: o perfil volta a aparecer para todos. */
export async function rejectDeleteProfile(id: string): Promise<void> {
  const user = await getCurrentUser()
  if (user?.role !== 'admin') throw new Error('Apenas administradores podem recusar exclusões.')
  const sb = getSupabase()
  const { data } = await sb
    .from('profiles')
    .select('client_name, delete_requested_by_name')
    .eq('id', id)
    .maybeSingle()
  const { error } = await sb
    .from('profiles')
    .update({
      pending_delete: false,
      delete_requested_by: null,
      delete_requested_by_name: null,
      delete_requested_at: null
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit(
    'recusou exclusão de perfil',
    id,
    data?.client_name ?? null,
    data?.delete_requested_by_name ? `solicitada por ${data.delete_requested_by_name}` : null
  )
}

export async function removeProfile(id: string): Promise<void> {
  const sb = getSupabase()
  const { data } = await sb.from('profiles').select('client_name, squad').eq('id', id).maybeSingle()
  const { error } = await sb.from('profiles').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit(
    'excluiu perfil',
    null,
    data?.client_name ?? null,
    data ? `squad ${squadLabel(data.squad ?? null)}` : null
  )
}
