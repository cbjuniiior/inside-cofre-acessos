import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
}

function tempPassword(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey)

    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller.user) return json({ error: 'Nao autenticado' })

    const { data: me } = await admin
      .from('members')
      .select('role')
      .eq('id', caller.user.id)
      .maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Apenas admins podem gerenciar usuarios.' })

    const body = await req.json()
    const action = body.action

    if (action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const name = String(body.name ?? '').trim()
      const squadRaw = body.squad == null ? null : String(body.squad)
      const squad = squadRaw === 'genesis' || squadRaw === 'high_impact' ? squadRaw : null
      if (!email) return json({ error: 'E-mail obrigatorio.' })
      const password = tempPassword()
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name }
      })
      if (createErr || !created.user) return json({ error: createErr?.message ?? 'Falha ao criar usuario.' })
      await admin
        .from('members')
        .upsert({ id: created.user.id, email, name: name || null, role: 'member', squad })
      return json({ tempPassword: password, email })
    }

    if (action === 'delete') {
      const userId = String(body.userId ?? '')
      if (!userId) return json({ error: 'userId obrigatorio.' })
      if (userId === caller.user.id) return json({ error: 'Voce nao pode remover a si mesmo.' })
      const { error: delErr } = await admin.auth.admin.deleteUser(userId)
      if (delErr) return json({ error: delErr.message })
      return json({ ok: true })
    }

    return json({ error: 'Acao invalida.' })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
