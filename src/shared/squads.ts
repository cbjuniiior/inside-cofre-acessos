import type { Squad } from './types'

/** Rótulo humano de um squad; null = acesso "Inside" (toda a equipe). */
export function squadLabel(squad: Squad | null): string {
  if (squad === 'genesis') return 'Gênesis'
  if (squad === 'high_impact') return 'High Impact'
  return 'Inside'
}
