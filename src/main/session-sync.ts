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

/** Baixa a sessão criptografada do Supabase e injeta os cookies na sessão isolada. */
export async function pullSession(profileId: string, ses: Session): Promise<void> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('sessions')
    .select('ciphertext, iv, tag')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return // ainda não há sessão salva para este perfil

  const cookies = JSON.parse(decrypt(getKey(), data)) as Cookie[]

  // O servidor é a fonte da verdade: zera os cookies locais e recria o snapshot
  // exato. Evita misturar cookies antigos do disco com os sincronizados.
  await ses.clearStorageData({ storages: ['cookies'] })

  for (const c of cookies) {
    // Cookies host-only e com prefixo __Host- NÃO podem ter `domain` definido,
    // senão o Chromium rejeita (e é justamente onde mora a auth do Google).
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

/** Lê os cookies da sessão isolada, criptografa e sobe para o Supabase. */
export async function pushSession(profileId: string, ses: Session): Promise<void> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const cookies = await ses.cookies.get({})
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
}
