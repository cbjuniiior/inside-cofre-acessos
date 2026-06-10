import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import WebSocket from 'ws'

// O Node 20 que vem no Electron não tem WebSocket nativo; o Realtime do supabase-js
// exige um. Não usamos Realtime aqui, mas o createClient o instancia mesmo assim.
const globalWithWs = globalThis as unknown as { WebSocket?: unknown }
if (!globalWithWs.WebSocket) {
  globalWithWs.WebSocket = WebSocket
}

const url = import.meta.env.MAIN_VITE_SUPABASE_URL
const anonKey = import.meta.env.MAIN_VITE_SUPABASE_ANON_KEY

// Armazenamento em arquivo para o login do time persistir entre reinícios.
let storePath = ''
function getStorePath(): string {
  if (!storePath) storePath = join(app.getPath('userData'), 'auth-store.json')
  return storePath
}
function readStore(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(getStorePath(), 'utf8'))
  } catch {
    return {}
  }
}
function writeStore(data: Record<string, string>): void {
  writeFileSync(getStorePath(), JSON.stringify(data), 'utf8')
}

const fileStorage = {
  getItem(key: string): string | null {
    return readStore()[key] ?? null
  },
  setItem(key: string, value: string): void {
    const s = readStore()
    s[key] = value
    writeStore(s)
  },
  removeItem(key: string): void {
    const s = readStore()
    delete s[key]
    writeStore(s)
  }
}

let client: SupabaseClient | null = null

export function isConfigured(): boolean {
  return Boolean(url && anonKey)
}

export function getSupabase(): SupabaseClient {
  if (!isConfigured()) {
    throw new Error(
      'Supabase não configurado. Preencha o arquivo .env com MAIN_VITE_SUPABASE_URL e MAIN_VITE_SUPABASE_ANON_KEY.'
    )
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        storage: fileStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    })
  }
  return client
}
