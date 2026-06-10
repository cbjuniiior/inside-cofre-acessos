// Helpers visuais do log de atividades (painel lateral e página de Logs).

export function actionMeta(action: string): { dot: string } {
  if (action.includes('abriu')) return { dot: 'bg-sky-400' }
  if (action.includes('sessão')) return { dot: 'bg-emerald-400' }
  if (action.includes('criou perfil')) return { dot: 'bg-emerald-400' }
  if (action.includes('editou perfil')) return { dot: 'bg-amber-400' }
  if (action.includes('solicitou exclusão')) return { dot: 'bg-amber-400' }
  if (action.includes('recusou exclusão')) return { dot: 'bg-slate-400' }
  if (action.includes('excluiu') || action.includes('aprovou exclusão')) return { dot: 'bg-red-400' }
  if (action.includes('membro') || action.includes('papel') || action.includes('squad'))
    return { dot: 'bg-purple-400' }
  if (action.includes('cofre')) return { dot: 'bg-brand-500' }
  if (action.includes('proxy')) return { dot: 'bg-sky-400' }
  return { dot: 'bg-slate-400' }
}

export function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/** Rótulo do dia para agrupar o log: Hoje, Ontem ou data por extenso. */
export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'Hoje'
  if (sameDay(d, yesterday)) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
}
