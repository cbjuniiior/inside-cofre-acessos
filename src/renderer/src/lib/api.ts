import type { ApiResult } from '../../../shared/types'

/** Desempacota um ApiResult: retorna os dados ou lança o erro do processo main. */
export async function call<T>(p: Promise<ApiResult<T>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}
