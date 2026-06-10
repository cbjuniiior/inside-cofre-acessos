import https from 'https'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { getSupabase } from './supabase'
import { getKey } from './vault'
import { encrypt, decrypt } from './crypto'
import { getCurrentUser } from './auth'
import { logAudit } from './audit'
import type { Proxy, ProxyInput, ProxyProtocol } from '../shared/types'

interface ProxyRow {
  id: string
  label: string
  host: string
  port: number
  protocol: ProxyProtocol
  creds_ciphertext: string | null
  creds_iv: string | null
  creds_tag: string | null
}

function rowToProxy(r: ProxyRow): Proxy {
  return {
    id: r.id,
    label: r.label,
    host: r.host,
    port: r.port,
    protocol: r.protocol,
    has_creds: Boolean(r.creds_ciphertext)
  }
}

export async function listProxies(): Promise<Proxy[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('proxies').select('*').order('label')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => rowToProxy(r as ProxyRow))
}

function credsColumns(input: ProxyInput): Record<string, string | null> {
  if (input.username || input.password) {
    const enc = encrypt(
      getKey(),
      JSON.stringify({ username: input.username ?? '', password: input.password ?? '' })
    )
    return { creds_ciphertext: enc.ciphertext, creds_iv: enc.iv, creds_tag: enc.tag }
  }
  return { creds_ciphertext: null, creds_iv: null, creds_tag: null }
}

export async function createProxy(input: ProxyInput): Promise<Proxy> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const { data, error } = await sb
    .from('proxies')
    .insert({
      label: input.label,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      ...credsColumns(input),
      created_by: user?.id ?? null
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  await logAudit('criou proxy', null, input.label, `${input.protocol}://${input.host}:${input.port}`)
  return rowToProxy(data as ProxyRow)
}

export async function updateProxy(id: string, input: ProxyInput): Promise<Proxy> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('proxies')
    .update({
      label: input.label,
      host: input.host,
      port: input.port,
      protocol: input.protocol,
      ...credsColumns(input)
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  await logAudit('editou proxy', null, input.label, `${input.protocol}://${input.host}:${input.port}`)
  return rowToProxy(data as ProxyRow)
}

export async function removeProxy(id: string): Promise<void> {
  const sb = getSupabase()
  const { data } = await sb.from('proxies').select('label').eq('id', id).maybeSingle()
  const { error } = await sb.from('proxies').delete().eq('id', id)
  if (error) throw new Error(error.message)
  await logAudit('excluiu proxy', null, data?.label ?? null)
}

interface ProxyConfig {
  host: string
  port: number
  protocol: ProxyProtocol
  username?: string | null
  password?: string | null
}

function agentFor(cfg: ProxyConfig): HttpsProxyAgent<string> | SocksProxyAgent {
  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password ?? '')}@`
    : ''
  if (cfg.protocol === 'socks5') {
    return new SocksProxyAgent(`socks5://${auth}${cfg.host}:${cfg.port}`)
  }
  return new HttpsProxyAgent(`http://${auth}${cfg.host}:${cfg.port}`)
}

/** Faz uma requisição pelo proxy e retorna o IP de saída visto pela internet. */
function fetchExitIp(cfg: ProxyConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://api.ipify.org?format=json',
      { agent: agentFor(cfg), timeout: 12000 },
      (res) => {
        let body = ''
        res.on('data', (d) => (body += d))
        res.on('end', () => {
          try {
            const ip = JSON.parse(body).ip
            if (typeof ip === 'string') resolve(ip)
            else reject(new Error('Resposta inesperada do teste de IP.'))
          } catch {
            reject(new Error('Resposta inválida do teste de IP.'))
          }
        })
      }
    )
    req.on('error', (e) => reject(new Error(`Falha ao conectar pelo proxy: ${e.message}`)))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Tempo esgotado ao conectar pelo proxy.'))
    })
  })
}

/** Testa uma config digitada (ainda não salva). */
export async function testProxyConfig(cfg: ProxyConfig): Promise<{ ip: string }> {
  return { ip: await fetchExitIp(cfg) }
}

/** Testa um proxy já salvo (descriptografa as credenciais). */
export async function testProxyById(id: string): Promise<{ ip: string }> {
  const sb = getSupabase()
  const { data, error } = await sb.from('proxies').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  const r = data as ProxyRow
  let username: string | undefined
  let password: string | undefined
  if (r.creds_ciphertext && r.creds_iv && r.creds_tag) {
    const c = JSON.parse(
      decrypt(getKey(), { ciphertext: r.creds_ciphertext, iv: r.creds_iv, tag: r.creds_tag })
    ) as { username: string; password: string }
    username = c.username
    password = c.password
  }
  return { ip: await fetchExitIp({ host: r.host, port: r.port, protocol: r.protocol, username, password }) }
}

/** Resolve os dados de proxy de um perfil para o processo de abertura do navegador. */
export async function resolveProfileProxy(
  proxyId: string
): Promise<{ rules: string; username?: string; password?: string } | null> {
  const sb = getSupabase()
  const { data, error } = await sb.from('proxies').select('*').eq('id', proxyId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as ProxyRow
  const rules = r.protocol === 'socks5' ? `socks5://${r.host}:${r.port}` : `${r.host}:${r.port}`
  if (r.creds_ciphertext && r.creds_iv && r.creds_tag) {
    const c = JSON.parse(
      decrypt(getKey(), { ciphertext: r.creds_ciphertext, iv: r.creds_iv, tag: r.creds_tag })
    ) as { username: string; password: string }
    return { rules, username: c.username, password: c.password }
  }
  return { rules }
}
