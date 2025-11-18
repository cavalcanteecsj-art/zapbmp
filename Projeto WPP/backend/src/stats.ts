import type { PrismaClient } from '@prisma/client'

export async function calcStats(prisma: PrismaClient) {
  const last7 = await prisma.mention.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: 'asc' }
  })

  type Row = typeof last7[number]

  const diffs: number[] = last7
    .filter((m: Row) => m.firstReplyAt)
    .map((m: Row) => Math.max(0, (m.firstReplyAt!.getTime() - m.createdAt.getTime()) / 1000))
    .sort((a: number, b: number) => a - b)

  const avg = diffs.length ? Math.round(diffs.reduce((a: number, b: number) => a + b, 0) / diffs.length) : 0
  const p95 = diffs.length ? Math.round(diffs[Math.floor(diffs.length * 0.95) - 1] || diffs[diffs.length - 1]) : 0

  const total = last7.length || 1
  const ok = last7.filter((m: Row) => m.status === 'OK').length
  const okPct = Math.round((ok / total) * 100)

  const byDay = new Map<string, number[]>()
  for (const m of last7 as Row[]) {
    const day = m.createdAt.toISOString().slice(0, 10)
    const sec = m.firstReplyAt ? (m.firstReplyAt.getTime() - m.createdAt.getTime()) / 1000 : 0
    if (!byDay.has(day)) byDay.set(day, [])
    if (sec > 0) byDay.get(day)!.push(sec)
  }
  const dailyTrend = [...byDay.entries()].map(([day, arr]) => ({
    day,
    avgSec: Math.round(arr.reduce((a: number, b: number) => a + b, 0) / (arr.length || 1))
  }))

  const analysts = new Map<string, number[]>()
  const groups = new Map<string, number[]>()
  for (const m of last7 as Row[]) {
    const k1 = m.assignee || '—'
    const k2 = m.groupName
    const sec = m.firstReplyAt ? (m.firstReplyAt.getTime() - m.createdAt.getTime()) / 1000 : 0
    if (!analysts.has(k1)) analysts.set(k1, [])
    if (!groups.has(k2)) groups.set(k2, [])
    if (sec > 0) {
      analysts.get(k1)!.push(sec)
      groups.get(k2)!.push(sec)
    }
  }
  const toRank = (m: Map<string, number[]>) =>
    [...m.entries()]
      .map(([name, arr]) => ({
        name,
        avgSec: Math.round(arr.reduce((a: number, b: number) => a + b, 0) / (arr.length || 1)),
        count: arr.length
      }))
      .sort((a, b) => a.avgSec - b.avgSec)
      .slice(0, 5)

  return {
    avgResponseSec: avg,
    p95ResponseSec: p95,
    slaOkPct: okPct,
    openCount: last7.filter((m: Row) => m.status === 'OPEN').length,
    lateCount: last7.filter((m: Row) => m.status === 'LATE').length,
    breachedCount: last7.filter((m: Row) => m.status === 'BREACHED').length,
    dailyTrend,
    ranking: { analysts: toRank(analysts), groups: toRank(groups) },
    heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  }
}
