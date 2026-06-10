import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app, type Session, type Cookie, type CookiesSetDetails } from 'electron'
import { getSupabase } from './supabase'
import { getKey } from './vault'
import { encrypt, decrypt } from './crypto'
import { getCurrentUser } from './auth'

/**
 * Memória local do último push por perfil (hash do snapshot enviado por ESTA
 * máquina). Permite o "pull defensivo": se o servidor ainda tem exatamente o
 * nosso último push, os cookies no disco local são iguais ou mais novos — e
 * injetar o snapshot regrediria a sessão (fatal para o Google, que rotaciona
 * tokens e invalida tudo ao ver um token antigo reutilizado).
 */
interface SessionMeta {
  lastPushHash: string
}

function metaPath(): string {
  return join(app.getPath('userData'), 'session-meta.json')
}

function readMeta(): Record<string, SessionMeta> {
  try {
    return JSON.parse(readFileSync(metaPath(), 'utf8')) as Record<string, SessionMeta>
  } catch {
    return {}
  }
}

function writeMeta(meta: Record<string, SessionMeta>): void {
  try {
    writeFileSync(metaPath(), JSON.stringify(meta))
  } catch {
    /* metadado é otimização — falha de escrita não pode quebrar o fluxo */
  }
}

/**
 * Snapshot do localStorage por origem: `{ "https://app.kiwify.com": { token: "..." } }`.
 * Muitos SPAs (Kiwify, etc.) guardam o token de auth aqui, não em cookie — então
 * sincronizar só cookies não basta para manter a sessão.
 */
export type LocalStorageMap = Record<string, Record<string, string>>

/** Formato persistido no Supabase (criptografado). */
interface StoredSnapshot {
  cookies: Cookie[]
  localStorage?: LocalStorageMap
}

/** Monta uma URL válida para um cookie a partir do domínio/path armazenado. */
function cookieUrl(c: Cookie): string {
  const domain = (c.domain ?? '').replace(/^\./, '')
  const scheme = c.secure ? 'https' : 'http'
  return `${scheme}://${domain}${c.path ?? '/'}`
}

/** Hash estável do conjunto cookies + localStorage — diz se a sessão mudou. */
function hashState(cookies: Cookie[], ls: LocalStorageMap): string {
  const norm = cookies.map((c) => `${c.domain}|${c.name}|${c.path}|${c.value}`).sort()
  const lsNorm = Object.entries(ls)
    .flatMap(([origin, kv]) => Object.entries(kv).map(([k, v]) => `LS|${origin}|${k}|${v}`))
    .sort()
  return createHash('sha256')
    .update([...norm, ...lsNorm].join('\n'))
    .digest('hex')
}

/**
 * Baixa a sessão criptografada do Supabase e injeta os cookies na sessão isolada.
 * Retorna o hash resultante (baseline) e o localStorage a injetar nas abas.
 */
export async function pullSession(
  profileId: string,
  ses: Session
): Promise<{ hash: string; localStorage: LocalStorageMap }> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('sessions')
    .select('ciphertext, iv, tag')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  if (data) {
    // Compatível com o formato antigo (array de cookies puro) e o novo (objeto).
    const parsed = JSON.parse(decrypt(getKey(), data)) as Cookie[] | StoredSnapshot
    const cookies = Array.isArray(parsed) ? parsed : parsed.cookies
    const serverLs: LocalStorageMap = Array.isArray(parsed) ? {} : parsed.localStorage ?? {}
    const serverHash = hashState(cookies, serverLs)

    // Pull defensivo: se o snapshot do servidor é exatamente o último push DESTA
    // máquina, ninguém salvou depois de nós — o estado local no disco é igual ou
    // mais novo (cookies E localStorage persistem na partição). Não injeta nada
    // para não regredir a sessão; retorna localStorage vazio (mantém o do disco).
    const localCookies = await ses.cookies.get({})
    if (localCookies.length > 0 && serverHash === readMeta()[profileId]?.lastPushHash) {
      return { hash: serverHash, localStorage: {} }
    }

    // Outra máquina salvou por último: o servidor é a fonte da verdade.
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

    return { hash: hashState(await ses.cookies.get({}), serverLs), localStorage: serverLs }
  }

  return { hash: hashState(await ses.cookies.get({}), {}), localStorage: {} }
}

/**
 * Criptografa cookies + localStorage da sessão e sobe para o Supabase.
 * Se `baselineHash` for informado e nada mudou, NÃO sobrescreve (retorna null).
 * Retorna o novo hash quando salva.
 */
export async function pushSession(
  profileId: string,
  ses: Session,
  localStorage: LocalStorageMap,
  baselineHash?: string
): Promise<string | null> {
  const cookies = await ses.cookies.get({})
  const hash = hashState(cookies, localStorage)
  if (baselineHash && hash === baselineHash) return null // nada mudou — não sobrescreve

  const sb = getSupabase()
  const user = await getCurrentUser()
  const snapshot: StoredSnapshot = { cookies, localStorage }
  const enc = encrypt(getKey(), JSON.stringify(snapshot))
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

  const meta = readMeta()
  meta[profileId] = { lastPushHash: hash }
  writeMeta(meta)
  return hash
}
