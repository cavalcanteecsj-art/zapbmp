import makeDebug from 'debug'
import type { PrismaClient } from '@prisma/client'
import {
  WASocket,
  DisconnectReason,
  makeWASocket,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'
import { usePrismaAuthState } from './dbAuth.js'

const debug = makeDebug('worker')

type Broadcaster = (msg: any) => void

type Session = {
  sock: WASocket
  lastQR?: string
}

export class InstancesManager {
  private prisma: PrismaClient
  private sessions = new Map<string, Session>()
  private broadcast: Broadcaster

  constructor(prisma: PrismaClient, broadcast: Broadcaster) {
    this.prisma = prisma
    this.broadcast = broadcast
  }

  has(id: string) { return this.sessions.has(id) }
  getQR(id: string) { return this.sessions.get(id)?.lastQR }
  getSelfIdentifiers(id: string): { jid: string | null, digits: string | null } {
    const s = this.sessions.get(id)
    const jid = s?.sock?.user?.id || null
    const bare = jid ? (jid.split('@')[0] || '').split(':')[0] : ''
    const digits = bare ? bare.replace(/\D/g, '') : ''
    return { jid, digits: digits || null }
  }

  async start(id: string) {
    if (this.sessions.has(id)) return
    const inst = await this.prisma.instance.findUnique({ where: { id } })
    if (!inst) throw new Error('Instance not found')

    const { state, saveCreds } = await usePrismaAuthState(this.prisma, id)
    const { version } = await fetchLatestBaileysVersion()
    const sock = makeWASocket({ version, auth: state, printQRInTerminal: false })

    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u
      if (qr) {
        this.sessions.get(id)!.lastQR = qr
        this.broadcast({ type: 'INSTANCE_QR', instanceId: id, qr })
      }
      if (connection === 'open') {
        await this.prisma.instance.update({ where: { id }, data: { status: 'ACTIVE', lastSeen: new Date() } })
        this.broadcast({ type: 'INSTANCE_STATUS', instanceId: id, status: 'active' })
      }
      if (connection === 'close') {
        const reason = (lastDisconnect as any)?.error?.output?.statusCode || (lastDisconnect as any)?.error?.reason || (lastDisconnect as any)?.code
        debug('connection closed', reason)
        await this.prisma.instance.update({ where: { id }, data: { status: 'ERROR' } }).catch(() => {})
        this.broadcast({ type: 'INSTANCE_STATUS', instanceId: id, status: 'error' })
      }
    })

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const m of messages) {
        const jid = m.key.remoteJid || ''
        if (!jid.endsWith('@g.us')) continue
        const text = extractText(m) || ''
        if (!text) continue
        const mentioned = (m.message?.extendedTextMessage?.contextInfo?.mentionedJid as string[] | undefined) || []
        const selfId = sock.user?.id || ''
        const selfBare = (selfId.split('@')[0] || '').split(':')[0]
        const selfBareJid = selfBare ? `${selfBare}@s.whatsapp.net` : ''
        const textDigits = text.replace(/\D/g, '')
        const selfDigits = selfBare.replace(/\D/g, '')
        const isMentionJid = !!selfBareJid && (mentioned.includes(selfBareJid) || mentioned.includes(selfId))
        const isMentionDigits = !!selfDigits && textDigits.includes(selfDigits)
        if (!(isMentionJid || isMentionDigits)) continue
        const mentionId = String(m.key.id)
        const groupId = jid
        // Load default tags for the group
        const groupTags = await this.prisma.groupTag.findMany({ where: { groupId } })
        const groupTagNames = groupTags.map(gt => gt.tagName)
        const record = await this.prisma.mention.upsert({
          where: { mentionId },
          create: {
            mentionId,
            groupId,
            groupName: 'Grupo',
            requesterName: m.pushName || 'Cliente',
            requesterPhone: (m.key.participant || null),
            messagePreview: text.slice(0, 280),
            status: 'OPEN',
            targetSeconds: 300,
            tags: Array.from(new Set([
              ...groupTagNames,
              ...(selfDigits ? [`@${selfDigits}`] : [])
            ])),
            instanceId: id,
          },
          update: { messagePreview: text.slice(0, 280), instanceId: id },
        })
        this.broadcast({ type: 'NEW_MENTION', mention: toFrontend(record) })
      }
    })

    this.sessions.set(id, { sock })
  }

  async stop(id: string) {
    const s = this.sessions.get(id)
    if (!s) return
    try { await s.sock.logout() } catch {}
    this.sessions.delete(id)
    await this.prisma.instance.update({ where: { id }, data: { status: 'PAUSED' } }).catch(() => {})
    this.broadcast({ type: 'INSTANCE_STATUS', instanceId: id, status: 'paused' })
  }

  async send(id: string, to: string, text: string) {
    const s = this.sessions.get(id)
    if (!s) throw new Error('Instance not started')
    await s.sock.sendMessage(normalizeJid(to), { text })
  }
}

function normalizeJid(n: string) {
  const digits = n.replace(/\D/g, '')
  return digits.endsWith('@s.whatsapp.net') || digits.endsWith('@g.us') ? digits : `${digits}@s.whatsapp.net`
}

function toFrontend(m: any) {
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
    status: (m.status || '').toLowerCase(),
    targetSeconds: m.targetSeconds,
    tags: (m.tags as any) || []
  }
}

function extractText(m: any): string | undefined {
  const msg = m.message || {}
  if (msg.conversation) return msg.conversation
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text
  if (msg.imageMessage?.caption) return msg.imageMessage.caption
  if (msg.videoMessage?.caption) return msg.videoMessage.caption
  return undefined
}

