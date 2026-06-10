export type ProfileService = 'gmail' | 'hostinger' | 'cpanel' | 'outro'

export type Squad = 'genesis' | 'high_impact'

export type ProxyProtocol = 'http' | 'https' | 'socks5'

export interface Proxy {
  id: string
  label: string
  host: string
  port: number
  protocol: ProxyProtocol
  has_creds: boolean
}

export interface ProxyInput {
  label: string
  host: string
  port: number
  protocol: ProxyProtocol
  username?: string | null
  password?: string | null
}

export interface Profile {
  id: string
  client_name: string
  service: ProfileService
  squad: Squad | null
  url: string
  tags: string[]
  proxy_id: string | null
  in_use_by: string | null
  in_use_by_email: string | null
  in_use_by_name: string | null
  in_use_at: string | null
  has_session: boolean
  updated_at: string
  created_at: string
}

export interface ProfileInput {
  client_name: string
  service: ProfileService
  squad: Squad | null
  url: string
  tags: string[]
  proxy_id: string | null
}

export interface AuditEntry {
  id: string
  profile_id: string | null
  profile_name: string | null
  user_email: string | null
  user_name: string | null
  action: string
  created_at: string
}

export type Role = 'admin' | 'member'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
}

export interface Member {
  id: string
  email: string | null
  name: string | null
  role: Role
}

export interface Bookmark {
  id: string
  profile_id: string
  title: string
  url: string
}

export interface TabState {
  id: number
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  favicon: string | null
}

export interface BrowserProfileInfo {
  id: string
  client_name: string
  service: ProfileService
}

export interface VaultStatus {
  initialized: boolean
  hasSlot: boolean
  canBootstrap: boolean
  mustChange: boolean
}

export interface VaultAccess {
  user_id: string
  must_change: boolean
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string }
