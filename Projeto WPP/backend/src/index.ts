import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import pino from 'pino'
import { PrismaClient } from '@prisma/client'
import { calcStats } from './stats.js'
import { InstancesManager } from './worker/manager.js'

const log = pino({ transport: { target: 'pino-pretty' } })
const app = express()
const prisma = new PrismaClient()

const PORT = Number(process.env.PORT || 8080)
const rawOrigin = process.env.CORS_ORIGIN || '*'
const CORS_ORIGIN: any = rawOrigin === '*'
  ? '*'
  : rawOrigin.split(',').map(s => s.trim()).filter(Boolean)
const SLA_TARGET_SECONDS = Number(process.env.SLA_TARGET_SECONDS || 300)

app.use(cors({ origin: CORS_ORIGIN, credentials: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => res.json({ ok: true }))

app.get('/health/db', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: true });
  } catch (e:any) {
    res.status(500).json({ ok:false, db:false, error: String(e?.message ?? e) });
  }
});

app.get('/api/slas', async (_req, res) => {
  const data = await prisma.mention.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  type MentionRow = typeof data[number]
  res.json(
    data.map((m: MentionRow) => ({
      mentionId: m.mentionId,
      groupId: m.groupId,
      groupName: m.groupName,
      requesterName: m.requesterName,
      requesterPhone: m.requesterPhone || undefined,
      messagePreview: m.messagePreview,
      createdAt: m.createdAt.toISOString(),
      firstReplyAt: m.firstReplyAt?.toISOString(),
      assignee: m.assignee || undefined,
      status: m.status.toLowerCase(),
      targetSeconds: m.targetSeconds,
      tags: (m.tags as any) || []
    }))
  )
})

app.get('/api/stats', async (_req, res) => {
  const stats = await calcStats(prisma)
  res.json(stats)
})

app.post('/api/webhooks/zapi', async (req, res) => {
  try {
    const ev = req.body
    const text = String(ev.text || ev.message || '')
    const textDigits = text.replace(/\D/g, '')
    const hintedDigits = String(ev.instanceNumber || ev.instance || ev.to || ev.instancePhone || '').replace(/\D/g, '')
    const mentioned: string[] = (ev.mentionedJid || ev.mentions || ev.mentioned || []) as any
    const hintedJid = typeof ev.instanceJid === 'string' ? ev.instanceJid : ''
    const isMentionDigits = hintedDigits ? textDigits.includes(hintedDigits) : false
    const isMentionJid = hintedJid ? (mentioned?.includes(hintedJid) ?? false) : false
    if ((hintedDigits || hintedJid) && !(isMentionDigits || isMentionJid)) {
      return res.status(204).json({ ok: true, skipped: true })
    }
    const mentionId = String(ev.messageId || ev.mentionId)
    // load group-level default tags (if groupId known)
    const groupIdStr = String(ev.groupId || ev.chatId || 'unknown-group')
    const groupDefaults = await prisma.groupTag.findMany({ where: { groupId: groupIdStr } })
    const groupDefaultNames = groupDefaults.map(g => g.tagName)
    const record = await prisma.mention.upsert({
      where: { mentionId },
      create: {
        mentionId,
        groupId: groupIdStr,
        groupName: String(ev.groupName || ev.chatName || 'Grupo'),
        requesterName: String(ev.fromName || ev.senderName || 'Cliente'),
        requesterPhone: ev.from || ev.sender || null,
        messagePreview: text,
        status: 'OPEN',
        targetSeconds: SLA_TARGET_SECONDS,
        tags: Array.from(new Set([
          ...groupDefaultNames,
          ...(Array.isArray(ev.tags) ? ev.tags : []),
          ...(hintedDigits ? ["@" + hintedDigits] : [])
        ])),
      },
      update: {
        messagePreview: text || undefined,
        tags: ev.tags || undefined,
      }
    })

    broadcast({ type: 'NEW_MENTION', mention: toFrontend(record) })
    res.json({ ok: true })
  } catch (e: any) {
    log.error(e)
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/actions/encerrar', async (req, res) => {
  const { mentionId } = req.body || {}
  const updated = await prisma.mention.update({
    where: { mentionId },
    data: { status: 'OK', firstReplyAt: new Date() }
  })
  broadcast({ type: 'SLA_UPDATED', mentionId, status: 'ok', firstReplyAt: updated.firstReplyAt?.toISOString() })
  res.json({ ok: true })
})

app.post('/api/actions/escalar', async (req, res) => {
  const { mentionId } = req.body || {}
  await prisma.mention.update({ where: { mentionId }, data: { status: 'BREACHED' } })
  broadcast({ type: 'SLA_UPDATED', mentionId, status: 'breached' })
  res.json({ ok: true })
})

// Atualiza tags personalizadas de uma mention
app.post('/api/actions/tags', async (req, res) => {
  try {
    const { mentionId, tags } = req.body || {}
    if (!mentionId || !Array.isArray(tags)) return res.status(400).json({ ok: false, error: 'mentionId and tags[] required' })
    const tokens: string[] = []
    for (const el of tags as any[]) {
      const s = String(el)
      for (const part of s.split(',')) {
        const tok = part.trim().toLowerCase()
        if (tok) tokens.push(tok)
      }
    }
    const clean = Array.from(new Set(tokens))
    const updated = await prisma.mention.update({ where: { mentionId }, data: { tags: clean as any } })
    // replicate new tags for future mentions from same group
    const mentionRow = await prisma.mention.findUnique({ where: { mentionId } })
    if (mentionRow) {
      const groupId = mentionRow.groupId
      // ensure tags exist in catalog and group mapping
      for (const name of clean) {
        await prisma.tag.upsert({ where: { name }, create: { name }, update: {} })
        await prisma.groupTag.upsert({ where: { groupId_tagName: { groupId, tagName: name } }, create: { groupId, tagName: name }, update: {} })
      }
    }
    broadcast({ type: 'SLA_UPDATED', mentionId, tags: clean })
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) })
  }
})

// Global tags catalog
app.get('/api/tags', async (_req, res) => {
  const items = await prisma.tag.findMany({ orderBy: { name: 'asc' } })
  res.json(items.map(t => t.name))
})

app.post('/api/tags', async (req, res) => {
  try {
    const { name } = req.body || {}
    if (!name) return res.status(400).json({ ok: false, error: 'name required' })
    const tokens = String(name).split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
    for (const n of tokens) { await prisma.tag.upsert({ where: { name: n }, create: { name: n }, update: {} }) }
    res.json({ ok: true })
  } catch (e:any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) })
  }
})

app.delete('/api/tags/:name', async (req, res) => {
  try {
    const name = String(req.params.name).toLowerCase()
    await prisma.groupTag.deleteMany({ where: { tagName: name } })
    await prisma.tag.delete({ where: { name } })
    res.json({ ok: true })
  } catch (e:any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) })
  }
})

const server = app.listen(PORT, () => log.info(`API on :${PORT}`))
const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(msg: any) {
  const data = JSON.stringify(msg)
  wss.clients.forEach((c: any) => { try { c.send(data) } catch {} })
}

// Instances manager (worker)
const manager = new InstancesManager(prisma, broadcast)

// Instances CRUD
app.get('/api/instances', async (_req, res) => {
  const items = await prisma.instance.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(items.map(i => ({ ...i, createdAt: i.createdAt.toISOString(), updatedAt: i.updatedAt.toISOString(), lastSeen: i.lastSeen?.toISOString() })))
})

app.post('/api/instances', async (req, res) => {
  const { name } = req.body || {}
  if (!name) return res.status(400).json({ ok: false, error: 'name required' })
  const created = await prisma.instance.create({ data: { name } })
  res.json({ ok: true, id: created.id })
})

app.put('/api/instances/:id', async (req, res) => {
  const { id } = req.params
  const { name, status } = req.body || {}
  const updated = await prisma.instance.update({ where: { id }, data: { name: name || undefined, status: status || undefined } })
  res.json({ ok: true, id: updated.id })
})

app.delete('/api/instances/:id', async (req, res) => {
  const { id } = req.params
  await prisma.instance.delete({ where: { id } })
  res.json({ ok: true })
})

// Control endpoints
app.post('/api/instances/:id/start', async (req, res) => {
  const { id } = req.params
  try {
    await manager.start(id)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) })
  }
})

// Webhook por instância (compat)
app.post('/api/webhooks/:instanceId/zapi', async (req, res) => {
  try {
    const { instanceId } = req.params
    const ev = req.body
    const text = String(ev.text || ev.message || '')
    const textDigits = text.replace(/\D/g, '')
    const { jid: selfJid, digits: selfDigits } = manager.getSelfIdentifiers(instanceId)
    const mentioned: string[] = (ev.mentionedJid || ev.mentions || ev.mentioned || []) as any
    const isMentionJid = selfJid ? (mentioned?.includes(selfJid) ?? false) : false
    const isMentionDigits = selfDigits ? textDigits.includes(selfDigits) : false
    if ((selfDigits || selfJid) && !(isMentionJid || isMentionDigits)) {
      return res.status(204).json({ ok: true, skipped: true })
    }
    const mentionId = String(ev.messageId || ev.mentionId)
    const groupIdStr = String(ev.groupId || ev.chatId || 'unknown-group')
    const groupDefaults = await prisma.groupTag.findMany({ where: { groupId: groupIdStr } })
    const groupDefaultNames = groupDefaults.map(g => g.tagName)
    const record = await prisma.mention.upsert({
      where: { mentionId },
      create: {
        mentionId,
        groupId: groupIdStr,
        groupName: String(ev.groupName || ev.chatName || 'Grupo'),
        requesterName: String(ev.fromName || ev.senderName || 'Cliente'),
        requesterPhone: ev.from || ev.sender || null,
        messagePreview: text,
        status: 'OPEN',
        targetSeconds: SLA_TARGET_SECONDS,
        tags: Array.from(new Set([
          ...groupDefaultNames,
          ...(Array.isArray(ev.tags) ? ev.tags : []),
          ...(selfDigits ? ["@" + selfDigits] : [])
        ])),
        instanceId,
      },
      update: {
        messagePreview: text || undefined,
        tags: ev.tags || undefined,
        instanceId,
      }
    })
    broadcast({ type: 'NEW_MENTION', mention: toFrontend(record) })
    res.json({ ok: true })
  } catch (e: any) {
    log.error(e)
    res.status(400).json({ ok: false, error: e.message })
  }
})

app.post('/api/instances/:id/stop', async (req, res) => {
  const { id } = req.params
  await manager.stop(id)
  res.json({ ok: true })
})

app.post('/api/instances/:id/send', async (req, res) => {
  const { id } = req.params
  const { to, text } = req.body || {}
  if (!to || !text) return res.status(400).json({ ok: false, error: 'to and text required' })
  try {
    await manager.send(id, to, text)
    res.json({ ok: true })
  } catch (e: any) {
    res.status(400).json({ ok: false, error: String(e?.message ?? e) })
  }
})

app.get('/api/instances/:id/qr', async (req, res) => {
  const { id } = req.params
  res.json({ qr: manager.getQR(id) || null })
})

function toFrontend(m: { mentionId: string; groupId: string; groupName: string; requesterName: string; requesterPhone: string | null; messagePreview: string; createdAt: Date | string; firstReplyAt: Date | string | null; assignee: string | null; status: string; targetSeconds: number; tags: any }) {
  return {
    mentionId: m.mentionId,
    groupId: m.groupId,
    groupName: m.groupName,
    requesterName: m.requesterName,
    requesterPhone: m.requesterPhone || undefined,
    messagePreview: m.messagePreview,
    createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
    firstReplyAt: m.firstReplyAt instanceof Date ? m.firstReplyAt.toISOString() : m.firstReplyAt,
    assignee: m.assignee || undefined,
    status: m.status.toLowerCase(),
    targetSeconds: m.targetSeconds,
    tags: (m.tags as any) || []
  }
}
