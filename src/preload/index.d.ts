import type { CofreApi } from './index'

declare global {
  interface Window {
    api: CofreApi
  }
}

export {}
