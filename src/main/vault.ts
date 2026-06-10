import { randomBytes } from 'crypto'
import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import { logAudit } from './audit'
import { deriveKey, newSalt, newDek, wrapKey, unwrapKey, makeVerifier, checkVerifier } from './crypto'
import type { VaultStatus, VaultAccess } from '../shared/types'

async function memberName(userId: string): Promise<string | null> {
  const sb = getSupabase()
  const { data } = await sb.from('members').select('name, email').eq('id', userId).maybeSingle()
  return data?.name ?? data?.email ?? null
}

// A DEK (chave dos dados) vive SOMENTE em memória, no processo main.
let dek: Buffer | null = null

export function isUnlocked(): boolean {
  return dek !== null
}

export function getKey(): Buffer {
  if (!dek) throw new Error('Cofre travado. Destrave com sua senha do cofre.')
  return dek
}

export function lock(): void {
  dek = null
}

interface WorkspaceRow {
  id: number
  kdf_salt: string | null
  verifier_ciphertext: string | null
  verifier_iv: string | null
  verifier_tag: string | null
  dek_verifier_ciphertext: string | null
  dek_verifier_iv: string | null
  dek_verifier_tag: string | null
}

interface SlotRow {
  user_id: string
  salt: string
  wrapped_dek_ciphertext: string
  wrapped_dek_iv: string
  wrapped_dek_tag: string
  must_change: boolean
}

async function getWorkspace(): Promise<WorkspaceRow | null> {
  const sb = getSupabase()
  const { data, error } = await sb.from('workspace').select('*').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as WorkspaceRow) ?? null
}

async function getSlot(userId: string): Promise<SlotRow | null> {
  const sb = getSupabase()
  const { data, error } = await sb.from('vault_keys').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as SlotRow) ?? null
}

function dekVerifier(ws: WorkspaceRow): { ciphertext: string; iv: string; tag: string } | null {
  if (!ws.dek_verifier_ciphertext || !ws.dek_verifier_iv || !ws.dek_verifier_tag) return null
  return {
    ciphertext: ws.dek_verifier_ciphertext,
    iv: ws.dek_verifier_iv,
    tag: ws.dek_verifier_tag
  }
}

async function upsertSlot(userId: string, password: string, mustChange: boolean): Promise<void> {
  if (!dek) throw new Error('Cofre travado.')
  const sb = getSupabase()
  const salt = newSalt()
  const kek = deriveKey(password, salt)
  const w = wrapKey(kek, dek)
  const { error } = await sb.from('vault_keys').upsert(
    {
      user_id: userId,
      salt,
      wrapped_dek_ciphertext: w.ciphertext,
      wrapped_dek_iv: w.iv,
      wrapped_dek_tag: w.tag,
      must_change: mustChange,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(error.message)
}

export async function vaultStatus(): Promise<VaultStatus> {
  const ws = await getWorkspace()
  if (!ws) return { initialized: false, hasSlot: false, canBootstrap: false, mustChange: false }
  const user = await getCurrentUser()
  const slot = user ? await getSlot(user.id) : null
  return {
    initialized: true,
    hasSlot: Boolean(slot),
    canBootstrap: Boolean(ws.verifier_ciphertext && ws.kdf_salt),
    mustChange: Boolean(slot?.must_change)
  }
}

/** Primeira configuração de um workspace novo (sem nenhum dado ainda). */
export async function initializeVault(password: string): Promise<void> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  if (!user) throw new Error('Faça login primeiro.')
  const d = newDek()
  const dv = makeVerifier(d)
  const { error } = await sb.from('workspace').insert({
    id: 1,
    dek_verifier_ciphertext: dv.ciphertext,
    dek_verifier_iv: dv.iv,
    dek_verifier_tag: dv.tag
  })
  if (error) throw new Error(error.message)
  dek = d
  await upsertSlot(user.id, password, false)
}

export async function unlockVault(password: string): Promise<boolean> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  if (!user) throw new Error('Faça login primeiro.')
  const ws = await getWorkspace()
  if (!ws) throw new Error('Workspace ainda não inicializado.')

  const slot = await getSlot(user.id)

  // 1) Caminho normal: o usuário tem slot próprio.
  if (slot) {
    let d: Buffer
    try {
      const kek = deriveKey(password, slot.salt)
      d = unwrapKey(kek, {
        ciphertext: slot.wrapped_dek_ciphertext,
        iv: slot.wrapped_dek_iv,
        tag: slot.wrapped_dek_tag
      })
    } catch {
      return false // senha do cofre errada (falha do GCM)
    }
    const dv = dekVerifier(ws)
    if (dv && !checkVerifier(d, dv)) return false
    dek = d
    return true
  }

  // 2) Bootstrap: usuário sem slot, mas conhece a senha-mestra legada do workspace.
  if (ws.verifier_ciphertext && ws.kdf_salt && ws.verifier_iv && ws.verifier_tag) {
    const oldKey = deriveKey(password, ws.kdf_salt)
    const ok = checkVerifier(oldKey, {
      ciphertext: ws.verifier_ciphertext,
      iv: ws.verifier_iv,
      tag: ws.verifier_tag
    })
    if (ok) {
      dek = oldKey
      // Garante o verificador da DEK na primeira migração.
      if (!dekVerifier(ws)) {
        const dv = makeVerifier(oldKey)
        await sb
          .from('workspace')
          .update({
            dek_verifier_ciphertext: dv.ciphertext,
            dek_verifier_iv: dv.iv,
            dek_verifier_tag: dv.tag
          })
          .eq('id', 1)
      }
      // Cria o slot pessoal deste usuário com a senha digitada.
      await upsertSlot(user.id, password, false)
      return true
    }
  }

  return false
}

/** Troca a senha do cofre do próprio usuário (precisa estar destravado). */
export async function changeVaultPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 8) throw new Error('A senha do cofre deve ter ao menos 8 caracteres.')
  if (!dek) throw new Error('Destrave o cofre antes de trocar a senha.')
  const user = await getCurrentUser()
  if (!user) throw new Error('Faça login primeiro.')
  await upsertSlot(user.id, newPassword, false)
}

/** Admin concede/reseta o acesso de um usuário, gerando uma senha temporária. */
export async function grantAccess(userId: string): Promise<string> {
  if (!dek) throw new Error('Destrave o cofre antes de conceder acesso.')
  const temp = randomBytes(6).toString('base64url') // ~8 caracteres legíveis
  await upsertSlot(userId, temp, true)
  await logAudit('concedeu acesso ao cofre', null, await memberName(userId))
  return temp
}

/** Admin revoga o acesso de um usuário (remove o slot). */
export async function revokeAccess(userId: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('vault_keys').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
  await logAudit('revogou acesso ao cofre', null, await memberName(userId))
}

/** Lista quem tem slot de acesso ao cofre (para a tela de Equipe do admin). */
export async function listVaultAccess(): Promise<VaultAccess[]> {
  const sb = getSupabase()
  const { data, error } = await sb.from('vault_keys').select('user_id, must_change')
  if (error) throw new Error(error.message)
  return (data ?? []) as VaultAccess[]
}
