import { createHash } from 'crypto'
import { type Session, type Cookie, type CookiesSetDetails } from 'electron'
import { getSupabase } from './supabase'
import { getKey } from './vault'
import { encrypt, decrypt } from './crypto'
import { getCurrentUser } from './auth'

/** Monta uma URL válida para um cookie a partir do domínio/path armazenado. */
function cookieUrl(c: Cookie): string {
  const domain = (c.domain ?? '').replace(/^\./, '')
  const scheme = c.secure ? 'https' : 'http'
  return `${scheme}://${domain}${c.path ?? '/'}`
}

/** Hash estável do conjunto de cookies — usado para saber se a sessão mudou. */
function hashCookies(cookies: Cookie[]): string {
  const norm = cookies.map((c) => `${c.domain}|${c.name}|${c.path}|${c.value}`).sort()
  return createHash('sha256').update(norm.join('\n')).digest('hex')
}

/**
 * Baixa a sessão criptografada do Supabase e injeta os cookies na sessão isolada.
 * Retorna o hash dos cookies resultantes (baseline para detectar mudanças).
 */
export async function pullSession(profileId: string, ses: Session): Promise<string> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('sessions')
    .select('ciphertext, iv, tag')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  if (data) {
    const cookies = JSON.parse(decrypt(getKey(), data)) as Cookie[]
    // O servidor é a fonte da verdade: zera os cookies locais e recria o snapshot.
    await ses.clearStorageData({ storages: ['cookies'] })
    for (const c of cookies) {
      // Cookies host-only / __Host- NÃO podem ter `domain` (onde mora a auth do Google).
      const hostOnly = c.hostOnly || c.name.startsWith('__Host-')
      const details: CookiesSetDetails = {
        url: cookieUrl(c),
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite
      }
      if (!hostOnly) details.domain = c.domain
      if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate
      try {
        await ses.cookies.set(details)
      } catch {
        // Cookie inválido/expirado — ignora e segue.
      }
    }
  }

  return hashCookies(await ses.cookies.get({}))
}

/**
 * Lê os cookies da sessão isolada, criptografa e sobe para o Supabase.
 * Se `baselineHash` for informado e nada mudou, NÃO sobrescreve (retorna null).
 * Retorna o novo hash quando salva.
 */
export async function pushSession(
  profileId: string,
  ses: Session,
  baselineHash?: string
): Promise<string | null> {
  const cookies = await ses.cookies.get({})
  const hash = hashCookies(cookies)
  if (baselineHash && hash === baselineHash) return null // nada mudou — não sobrescreve

  const sb = getSupabase()
  const user = await getCurrentUser()
  const enc = encrypt(getKey(), JSON.stringify(cookies))
  const { error } = await sb.from('sessions').upsert(
    {
      profile_id: profileId,
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      tag: enc.tag,
      updated_by: user?.id ?? null,
      updated_by_email: user?.email ?? null,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'profile_id' }
  )
  if (error) throw new Error(error.message)
  return hash
}
