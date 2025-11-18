const API_BASE = (import.meta as any).env?.VITE_API_BASE || ''

async function asJson<T>(r: Response): Promise<T> {
  const t = await r.text()
  try {
    return JSON.parse(t)
  } catch {
    throw new Error(`HTTP ${r.status} ${r.statusText}: ${t.slice(0, 120)}`)
  }
}

export async function getInstances() {
  const r = await fetch(`${API_BASE}/api/instances`)
  if (!r.ok) throw new Error(`${r.status}`)
  return asJson<any[]>(r)
}

export async function createInstance(name: string) {
  const r = await fetch(`${API_BASE}/api/instances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function updateInstance(id: string, data: any) {
  const r = await fetch(`${API_BASE}/api/instances/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function deleteInstance(id: string) {
  const r = await fetch(`${API_BASE}/api/instances/${id}`, { method: 'DELETE' })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function startInstance(id: string) {
  const r = await fetch(`${API_BASE}/api/instances/${id}/start`, { method: 'POST' })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function stopInstance(id: string) {
  const r = await fetch(`${API_BASE}/api/instances/${id}/stop`, { method: 'POST' })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function sendMessage(id: string, to: string, text: string) {
  const r = await fetch(`${API_BASE}/api/instances/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, text }) })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function getQR(id: string) {
  const r = await fetch(`${API_BASE}/api/instances/${id}/qr`)
  if (!r.ok) throw new Error(`${r.status}`)
  return asJson<{ qr: string | null }>(r)
}

export function wsURL() {
  if (!API_BASE) return ''
  return API_BASE.replace(/^http/, 'ws') + '/ws'
}

export async function updateMentionTags(mentionId: string, tags: string[]) {
  const r = await fetch(`${API_BASE}/api/actions/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mentionId, tags })
  })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function getTags() {
  const r = await fetch(`${API_BASE}/api/tags`)
  const j = await asJson<string[]>(r)
  if (!r.ok) throw new Error(`${r.status}`)
  return j
}

export async function createTag(name: string) {
  const r = await fetch(`${API_BASE}/api/tags`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}

export async function deleteTag(name: string) {
  const r = await fetch(`${API_BASE}/api/tags/${encodeURIComponent(name)}`, { method: 'DELETE' })
  const j = await asJson<any>(r)
  if (!r.ok) throw new Error(j?.error || `${r.status}`)
  return j
}
