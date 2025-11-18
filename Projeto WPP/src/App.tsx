import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Input } from "./components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "./components/ui/select";
import { updateMentionTags, getTags, createTag, deleteTag } from "./lib/api";
import { Bell, Clock, Filter, RefreshCcw, ShieldCheck, AlertTriangle, Hash, Users, MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// =============================
// Dashboard de SLA para WhatsApp (Z-API)
// =============================
// Correções importantes:
// 1) Proteção contra respostas não-JSON (ex.: HTML/XML 404) ao fazer fetch().
// 2) Proteção no WebSocket: parse do payload com try/catch (evt.data pode não ser JSON).
// 3) Correção no exportCsv: uso correto de "\n" em vez de quebra de linha literal dentro de string.
// 4) Modo Demo automático se a API não estiver disponível.
// 5) Pequena suíte de auto-testes exibida na UI (não afeta produção).
" em vez de quebra de linha literal dentro de string."
// 4) Modo Demo automático se a API não estiver disponível.
// 5) Pequena suíte de auto-testes exibida na UI (não afeta produção).

export type SLAStatus = "open" | "ok" | "late" | "breached";
export interface SLAItem {
  mentionId: string;
  groupId: string;
  groupName: string;
  requesterName: string;
  requesterPhone?: string;
  messagePreview: string;
  createdAt: string;
  firstReplyAt?: string;
  assignee?: string;
  status: SLAStatus;
  targetSeconds: number;
  tags?: string[];
}

const seed: SLAItem[] = [
  {
    mentionId: "A1",
    groupId: "5511999999999-group",
    groupName: "Clientes • Suporte",
    requesterName: "Maria Silva",
    requesterPhone: "5511988887777",
    messagePreview: "@suporte o boleto não baixa no app",
    createdAt: new Date(Date.now() - 1000 * 60 * 7).toISOString(),
    status: "late",
    targetSeconds: 60 * 5,
    tags: ["@suporte", "prioridade:alta"],
  },
  {
    mentionId: "B2",
    groupId: "5511888888888-group",
    groupName: "Onboarding Cliente X",
    requesterName: "Carlos",
    messagePreview: "gente, @suporte conseguem ver meu erro 403?",
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    status: "open",
    targetSeconds: 60 * 5,
    tags: ["@suporte"],
  },
  {
    mentionId: "C3",
    groupId: "5511777777777-group",
    groupName: "Projeto PIX – Beta",
    requesterName: "Ana",
    messagePreview: "responderam por aqui (ok)",
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    firstReplyAt: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    assignee: "João (Analista)",
    status: "ok",
    targetSeconds: 60 * 10,
    tags: ["@suporte"],
  },
];

function secondsBetween(aISO: string, bISO?: string) {
  const a = new Date(aISO).getTime();
  const b = bISO ? new Date(bISO).getTime() : Date.now();
  return Math.max(0, Math.round((b - a) / 1000));
}
function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}
function statusBadge(status: SLAStatus) {
  const map: Record<SLAStatus, { label: string; icon: React.ReactNode }> = {
    open: { label: "Aberto", icon: <Clock className="h-3.5 w-3.5" /> },
    ok: { label: "OK", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    late: { label: "Atrasando", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    breached: { label: "Estourado", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  };
  const { label, icon } = map[status];
  return (
    <Badge className="rounded-2xl px-2 py-1 text-[11px] font-medium gap-1">{icon}{label}</Badge>
  );
}
async function safeJson(r: Response) {
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json") || ct.includes("application/problem+json")) {
    return r.json();
  }
  const text = await r.text();
  throw new Error(`Non-JSON response (${ct || "unknown"}): ${text.slice(0, 80)}`);
}
async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} on ${url} :: ${t.slice(0, 80)}`);
  }
  return safeJson(res);
}

export default function WhatsAppSlaDashboard() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | SLAStatus>("all");
  const [view, setView] = useState<"dashboard" | "apresentacao">("dashboard");
  const [demoMode, setDemoMode] = useState(false);
  const [items, setItems] = useState<SLAItem[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [trend, setTrend] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [tests, setTests] = useState<{ name: string; ok: boolean; detail?: string }[]>([]);
  const [itemView, setItemView] = useState<'cards' | 'list'>('cards');
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [tagInputById, setTagInputById] = useState<Record<string, string>>({});
  const [tagsCatalog, setTagsCatalog] = useState<string[]>([]);
  const [manageTagsOpen, setManageTagsOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  const setTagInput = (id: string, v: string) => setTagInputById(prev => ({ ...prev, [id]: v }));
  async function saveTags(mentionId: string, tags: string[]) {
    try {
      await updateMentionTags(mentionId, tags);
      setItems(prev => prev.map(it => it.mentionId === mentionId ? { ...it, tags } : it));
      setTagsCatalog(prev => Array.from(new Set([...(prev||[]), ...tags.map(t=>t.toLowerCase())])));
    } catch (e: any) {
      logDiag(`tags: ${e?.message || String(e)}`);
    }
  }

  async function refreshTags() {
    try { const list = await getTags(); setTagsCatalog(list); } catch {}
  }

  async function onCreateTag() {
    const raw = newTagName || '';
    if (!raw.trim()) return;
    try { await createTag(raw); setNewTagName(''); await refreshTags(); } catch (e:any) { logDiag(String(e?.message||e)); }
  }

  async function onDeleteTag(name: string) {
    try { await deleteTag(name); await refreshTags(); } catch (e:any) { logDiag(String(e?.message||e)); }
  }

  const API_BASE = import.meta.env.VITE_API_BASE || "";
// Configure via .env / Vercel → Project Settings → Environment Variables

  function logDiag(msg: string) {
    setDiagnostics((d) => [new Date().toLocaleTimeString(), msg, ...d].slice(0, 12));
    try { console.warn("[SLA-DIAG]", msg); } catch {}
  }
  function activateDemo(reason?: string) {
    if (reason) logDiag(`Ativando DEMO: ${reason}`);
    setDemoMode(true);
    setItems(seed);
    const demoStats = {
      avgResponseSec: 180,
      p95ResponseSec: 480,
      slaOkPct: 82,
      openCount: 3,
      lateCount: 1,
      breachedCount: 0,
      dailyTrend: [
        { day: "2025-10-25", avgSec: 210 },
        { day: "2025-10-26", avgSec: 195 },
        { day: "2025-10-27", avgSec: 180 },
        { day: "2025-10-28", avgSec: 175 },
        { day: "2025-10-29", avgSec: 165 },
        { day: "2025-10-30", avgSec: 178 },
        { day: "2025-10-31", avgSec: 160 }
      ],
      heatmap: Array.from({length:7},(_,d)=>Array.from({length:24},(_,h)=> (h>8&&h<19?Math.floor(Math.random()*4):0))),
      ranking: {
        analysts: [
          { name: "João", avgSec: 140, count: 18 },
          { name: "Ana", avgSec: 160, count: 15 },
          { name: "Carlos", avgSec: 220, count: 12 }
        ],
        groups: [
          { name: "Clientes • Suporte", avgSec: 150, count: 20 },
          { name: "Projeto PIX – Beta", avgSec: 210, count: 10 },
          { name: "Onboarding Cliente X", avgSec: 180, count: 8 }
        ]
      }
    };
    setStats(demoStats);
    setTrend(demoStats.dailyTrend);
  }

  function runSelfTests() {
    const results: { name: string; ok: boolean; detail?: string }[] = [];
    try { JSON.parse("<?xml version=\"1.0\"?><x />"); results.push({ name: "Rejeita XML em JSON.parse", ok: false }); }
    catch { results.push({ name: "Rejeita XML em JSON.parse", ok: true }); }
    const d = formatDuration(125);
    results.push({ name: "formatDuration(125) == '2m 5s'", ok: d === "2m 5s", detail: d });
    const t1 = new Date("2025-10-31T10:00:00Z").toISOString();
    const t2 = new Date("2025-10-31T10:03:30Z").toISOString();
    results.push({ name: "secondsBetween 210s", ok: secondsBetween(t1, t2) === 210, detail: String(secondsBetween(t1, t2)) });
    const sample = [{...seed[0]}, {...seed[1]}];
    const onlyOpen = sample.filter(s => s.status === "open").length;
    results.push({ name: "Filtro status (open) == 1", ok: onlyOpen === 1, detail: String(onlyOpen) });
    setTests(results);
  }

  useEffect(() => {
    runSelfTests();
    if (!API_BASE) { activateDemo("API_BASE vazio"); return; }
    let ws: WebSocket | null = null;
    (async () => {
      try {
        const data = await fetchJson(`${API_BASE}/api/slas`);
        setItems(data);
        const s = await fetchJson(`${API_BASE}/api/stats`);
        setStats(s);
        setTrend(s?.dailyTrend ?? []);
      } catch (e: any) {
        logDiag(e?.message || String(e));
        activateDemo("Falha ao carregar API real");
        return;
      }
      try {
        // Prefer API_BASE for WebSocket when provided (e.g., different domain on Vercel/Render)
        const base = (import.meta as any).env?.VITE_API_BASE || "";
        let wsUrl: string;
        if (base) {
          try {
            const u = new URL(base);
            u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
            u.pathname = '/ws';
            u.search = '';
            u.hash = '';
            wsUrl = u.toString();
          } catch {
            wsUrl = base.replace(/^http/, 'ws').replace(/\/?$/, '') + '/ws';
          }
        } else {
          wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
        }
        ws = new WebSocket(wsUrl);
        ws.onmessage = (evt) => {
          try {
            const msg = typeof evt.data === "string" ? JSON.parse(evt.data) : evt.data;
            if (msg?.type === "NEW_MENTION" && msg.mention) {
              setItems(prev => [msg.mention, ...prev]);
            } else if (msg?.type === "SLA_UPDATED" && msg.mentionId) {
              setItems(prev => prev.map(it => it.mentionId === msg.mentionId ? { ...it, status: msg.status ?? it.status, firstReplyAt: msg.firstReplyAt ?? it.firstReplyAt, tags: msg.tags ?? it.tags } : it));
            }
          } catch (err: any) {
            logDiag(`WS payload não-JSON ignorado: ${String(err?.message || err)}`);
          }
          if (!demoMode) fetchJson(`${API_BASE}/api/stats`).then(setStats).catch((e)=>logDiag(`stats refresh: ${e.message}`));
        };
        ws.onerror = () => logDiag("WebSocket erro");
      } catch (e: any) {
        logDiag(`Falha ao abrir WebSocket: ${e?.message || e}`);
      }
    })();
    return () => { try { ws?.close(); } catch {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return items.filter((i) => {
      const okStatus = status === "all" ? true : i.status === status;
      const q = query.toLowerCase();
      const okQuery = !q
        ? true
        : [
            i.groupName,
            i.messagePreview,
            i.requesterName,
            i.assignee ?? "",
            i.groupId,
            i.mentionId,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q);
      return okStatus && okQuery;
    });
  }, [items, query, status]);

  function colorByStatus(s: SLAStatus) {
    switch (s) {
      case "ok": return "border-green-200";
      case "late": return "border-amber-200";
      case "breached": return "border-rose-200";
      default: return "border-slate-200";
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (demoMode || !API_BASE) {
        activateDemo("Atualização em modo demo");
      } else {
        const data = await fetchJson(`${API_BASE}/api/slas`);
        setItems(data);
        const s = await fetchJson(`${API_BASE}/api/stats`);
        setStats(s);
        setTrend(s?.dailyTrend ?? []);
      }
    } catch (e: any) {
      logDiag(e?.message || String(e));
      activateDemo("Erro no refresh real");
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const exportCsv = () => {
    const header = ["mentionId","groupId","groupName","requesterName","createdAt","firstReplyAt","status","targetSeconds"].join(",");
    const rows = items.map(m => [m.mentionId,m.groupId,m.groupName,JSON.stringify(m.requesterName||""),m.createdAt,m.firstReplyAt||"",m.status,m.targetSeconds].join(","));
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sla_export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const escalateNow = async (m: SLAItem) => {
    if (demoMode || !API_BASE) { logDiag("Escalar: simulado (DEMO)"); return; }
    await fetch(`${API_BASE}/api/actions/escalar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: m.groupId, mentionId: m.mentionId })
    }).catch((e)=>logDiag(`escalar: ${e.message}`));
  };
  const markResponded = async (m: SLAItem) => {
    if (demoMode || !API_BASE) { logDiag("Encerrar: simulado (DEMO)"); return; }
    await fetch(`${API_BASE}/api/actions/encerrar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: m.groupId, mentionId: m.mentionId })
    }).catch((e)=>logDiag(`encerrar: ${e.message}`));
  };

  return (
    <div className="min-h-screen w-full bg-white px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Acompanhamento de Conversas – SLA WhatsApp</h1>
            <p className="text-sm text-slate-500">Monitore menções ao suporte nos grupos e o tempo até a primeira resposta do analista.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={handleRefresh} disabled={refreshing} className="gap-2">
              <RefreshCcw className={"h-4 w-4 " + (refreshing ? "animate-spin" : "")}/> Atualizar
            </Button>
            <Button className="gap-2" onClick={exportCsv}><Bell className="h-4 w-4"/> Exportar CSV</Button>
            <Button variant="secondary" onClick={()=>{ setManageTagsOpen(v=>!v); if(!tagsCatalog.length){ (async()=>{ try{ const list = await getTags(); setTagsCatalog(list);} catch{} })(); } }}>Tags</Button>
            <Button variant={view==='dashboard'?"default":"secondary"} onClick={()=>setView('dashboard')}>Dashboard</Button>
            <Button variant={view==='apresentacao'?"default":"secondary"} onClick={()=>setView('apresentacao')}>Modo Apresentação</Button>
            <Badge onClick={()=>{ if(demoMode){ setDemoMode(false); setDiagnostics(d=>["Demo OFF",...d]); } else { activateDemo("toggle manual"); } }} className="cursor-pointer">Demo: {demoMode? 'ON':'OFF'}</Badge>
          </div>
        </motion.header>

        {manageTagsOpen && (
          <div className="mb-4 rounded-xl border border-slate-200 p-3">
            <div className="text-sm font-medium mb-2">Gerenciar tags</div>
            <div className="flex items-center gap-2 mb-3">
              <Input className="h-9 w-64" placeholder="Adicionar tags (separe por vírgulas)" value={newTagName} onChange={(e)=>setNewTagName(e.target.value)} />
              <Button onClick={onCreateTag}>Adicionar</Button>
              <Button variant="secondary" onClick={refreshTags}>Atualizar lista</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tagsCatalog.map((t) => (
                <span key={t} className="inline-flex items-center gap-1">
                  <Badge variant="secondary" className="rounded-xl">
                    <Hash className="mr-1 h-3 w-3"/>{t}
                  </Badge>
                  <button className="text-xs text-slate-500 hover:text-rose-700" onClick={()=>onDeleteTag(t)}>x</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {diagnostics.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-medium mb-1">Diagnóstico (últimos eventos)</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {diagnostics.slice(0,6).map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          </div>
        )}

        {view==='dashboard' && stats && (
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
            <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Média de Resposta</div><div className="text-lg font-semibold">{Math.round(stats.avgResponseSec)}s</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-slate-500">P95</div><div className="text-lg font-semibold">{Math.round(stats.p95ResponseSec)}s</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-slate-500">SLA dentro do alvo</div><div className="text-lg font-semibold">{Math.round(stats.slaOkPct)}%</div></CardContent></Card>
            <Card><CardContent className="p-4"><div className="text-xs text-slate-500">Abertos</div><div className="text-lg font-semibold">{stats.openCount}</div></CardContent></Card>
            <div className="col-span-1 md:col-span-4 h-44 rounded-2xl border border-slate-200">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="avgSec" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {view==='apresentacao' && (
          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card><CardContent className="p-6 text-center"><div className="text-xs uppercase text-slate-500">Tempo médio</div><div className="text-3xl font-semibold">{Math.round(stats?.avgResponseSec||0)}s</div></CardContent></Card>
              <Card><CardContent className="p-6 text-center"><div className="text-xs uppercase text-slate-500">Dentro do SLA</div><div className="text-3xl font-semibold">{Math.round(stats?.slaOkPct||0)}%</div></CardContent></Card>
              <Card><CardContent className="p-6 text-center"><div className="text-xs uppercase text-slate-500">P95</div><div className="text-3xl font-semibold">{Math.round(stats?.p95ResponseSec||0)}s</div></CardContent></Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="col-span-2 h-64 rounded-2xl border border-slate-200">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ left: 8, right: 8, top: 16, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="avgSec" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="col-span-1 p-4 rounded-2xl border border-slate-200">
                <div className="text-sm font-medium mb-2">Ranking Analistas (média)</div>
                <div className="space-y-2">
                  {(stats?.ranking?.analysts||[]).map((r:any,i:number)=> (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{i+1}. {r.name}</span>
                      <span>{r.avgSec}s • {r.count}</span>
                    </div>
                  ))}
                </div>
                <div className="text-sm font-medium mt-4 mb-2">Grupos mais críticos</div>
                <div className="space-y-2">
                  {(stats?.ranking?.groups||[]).map((r:any,i:number)=> (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>{i+1}. {r.name}</span>
                      <span>{r.avgSec}s • {r.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-6 p-4 rounded-2xl border border-slate-200">
              <div className="text-sm font-medium mb-3">Heatmap de demanda (mensagens com @suporte)</div>
              <div className="grid" style={{gridTemplateColumns: "repeat(24, minmax(0,1fr))", gap: 2}}>
                {Array.from({length:7}).map((_,dow)=> (
                  <React.Fragment key={dow}>
                    {Array.from({length:24}).map((_,h)=> {
                      const intensity = stats?.heatmap?.[dow]?.[h] ?? 0;
                      const alpha = Math.min(0.08 + intensity*0.12, 0.9);
                      return <div key={h} className="h-6 rounded" title={`D${dow} ${h}:00 • ${intensity}`} style={{background:`rgba(0,0,0,${alpha})`}}/>;
                    })}
                  </React.Fragment>
                ))}
              </div>
              <div className="mt-2 text-xs text-slate-500">Linhas = dias (D0=Domingo), colunas = hora do dia (0-23).</div>
            </div>
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-500"/>
            <Select value={status} onValueChange={(v: any) => setStatus(v)}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Status"/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="open">Abertos</SelectItem>
                <SelectItem value="ok">OK</SelectItem>
                <SelectItem value="late">Atrasando</SelectItem>
                <SelectItem value="breached">Estourados</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por grupo, mensagem, analista, id…"/>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-sm text-slate-600">Visualização</span>
          <Select value={itemView} onValueChange={(v) => setItemView(v as 'cards'|'list')}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cards">Cartões</SelectItem>
              <SelectItem value="list">Lista</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {itemView === 'cards' ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((i) => {
              const statusColor = colorByStatus(i.status);
              return (
                <Card key={i.mentionId} className={`border ${statusColor} rounded-2xl shadow-sm` }>
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-slate-500"/>
                        <span className="text-sm font-medium">{i.groupName}</span>
                      </div>
                      <div className="flex items-center gap-2">{statusBadge(i.status)}</div>
                    </div>

                    <div className="mb-3 grid grid-cols-12 gap-2">
                      <div className="col-span-12">
                        <div className="flex items-start gap-2 text-slate-700">
                          <MessageSquare className="mt-0.5 h-4 w-4"/>
                        <p className="text-sm leading-relaxed">{i.messagePreview}</p>
                      </div>
                    </div>
                    <div className="col-span-12 md:col-span-6">
                      <div className="text-xs text-slate-500">Solicitante</div>
                      <div className="text-sm">{i.requesterName}</div>
                    </div>
                    <div className="col-span-6 md:col-span-3">
                      <div className="text-xs text-slate-500">Desde</div>
                      <div className="text-sm">{formatDuration(secondsBetween(i.createdAt))}</div>
                    </div>
                    <div className="col-span-6 md:col-span-3">
                      <div className="text-xs text-slate-500">Alvo</div>
                      <div className="text-sm">{formatDuration(i.targetSeconds)}</div>
                    </div>
                  </div>

                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {i.tags?.map((t) => (
                      <span key={t} className="inline-flex items-center gap-1">
                        <Badge variant="secondary" className="rounded-xl">
                          <Hash className="mr-1 h-3 w-3"/>{t}
                        </Badge>
                        <button className="text-xs text-slate-500 hover:text-rose-700" onClick={() => saveTags(i.mentionId, (i.tags||[]).filter(x=>x.toLowerCase()!==t.toLowerCase()))}>x</button>
                      </span>
                    ))}
                    <div className="flex items-center gap-2">
                      <Input className="h-8 w-40" placeholder="Nova tag (separe por vírgulas)" value={tagInputById[i.mentionId] || ''} onChange={(e)=>setTagInput(i.mentionId, e.target.value)} />
                      <Button size="sm" onClick={() => { const raw=(tagInputById[i.mentionId]||''); const parts=raw.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); if(parts.length===0) return; const current=(i.tags||[]).map(t=>t.trim().toLowerCase()); const next=Array.from(new Set([...current, ...parts])); saveTags(i.mentionId, next); setTagInput(i.mentionId, ''); }}>Adicionar</Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="gap-1">
                      <Clock className="h-4 w-4"/> Detalhes
                    </Button>
                    <Button size="sm" className="gap-1" onClick={() => markResponded(i)}>
                      <ShieldCheck className="h-4 w-4"/> Marcar como respondido
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1 ml-auto" onClick={() => escalateNow(i)}>
                      <AlertTriangle className="h-4 w-4"/> Escalar agora
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Grupo</th>
                    <th className="text-left px-4 py-2 font-medium">Solicitante</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Desde</th>
                    <th className="text-left px-4 py-2 font-medium">Alvo</th>
                    <th className="text-left px-4 py-2 font-medium">Ações</th>
                    <th className="text-left px-4 py-2 font-medium">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => (
                    <React.Fragment key={i.mentionId}>
                      <tr className="border-t">
                        <td className="px-4 py-2 align-top">
                          <div className="font-medium">{i.groupName}</div>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <div className="text-sm">{i.requesterName}</div>
                        </td>
                        <td className="px-4 py-2 align-top">
                          {statusBadge(i.status)}
                        </td>
                        <td className="px-4 py-2 align-top">{formatDuration(secondsBetween(i.createdAt))}</td>
                        <td className="px-4 py-2 align-top">{formatDuration(i.targetSeconds)}</td>
                        <td className="px-4 py-2 align-top">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" className="gap-1" onClick={() => markResponded(i)}>
                              <ShieldCheck className="h-4 w-4"/> Responder
                            </Button>
                            <Button size="sm" variant="destructive" className="gap-1" onClick={() => escalateNow(i)}>
                              <AlertTriangle className="h-4 w-4"/> Escalar
                            </Button>
                          </div>
                        </td>
                        <td className="px-4 py-2 align-top">
                          <Button size="sm" variant="secondary" onClick={() => setExpandedById(prev => ({ ...prev, [i.mentionId]: !prev[i.mentionId] }))}>
                            {expandedById[i.mentionId] ? 'Ocultar' : 'Detalhes'}
                          </Button>
                        </td>
                      </tr>
                      {expandedById[i.mentionId] && (
                        <tr className="border-t bg-slate-50/50">
                          <td className="px-4 py-3 text-slate-700" colSpan={7}>
                            <div className="space-y-3">
                              <div className="flex items-start gap-2">
                                <MessageSquare className="mt-0.5 h-4 w-4"/>
                                <p className="text-sm leading-relaxed">{i.messagePreview}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {i.tags?.map((t) => (
                                  <span key={t} className="inline-flex items-center gap-1">
                                    <Badge variant="secondary" className="rounded-xl">
                                      <Hash className="mr-1 h-3 w-3"/>{t}
                                    </Badge>
                                    <button className="text-xs text-slate-500 hover:text-rose-700" onClick={() => saveTags(i.mentionId, (i.tags||[]).filter(x=>x.toLowerCase()!==t.toLowerCase()))}>x</button>
                                  </span>
                                ))}
                                <div className="flex items-center gap-2">
                                  <Input className="h-8 w-40" placeholder="Nova tag (separe por vírgulas)" value={tagInputById[i.mentionId] || ''} onChange={(e)=>setTagInput(i.mentionId, e.target.value)} />
                                  <Button size="sm" onClick={() => { const raw=(tagInputById[i.mentionId]||''); const parts=raw.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean); if(parts.length===0) return; const current=(i.tags||[]).map(t=>t.trim().toLowerCase()); const next=Array.from(new Set([...current, ...parts])); saveTags(i.mentionId, next); setTagInput(i.mentionId, ''); }}>Adicionar</Button>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {filtered.length === 0 && (
          <div className="mt-10 text-center text-sm text-slate-500">Nenhuma menção encontrada para os filtros atuais.</div>
        )}

        {tests.length > 0 && (
          <div className="mt-8 rounded-xl border border-slate-200 p-3">
            <div className="text-sm font-medium mb-2">Auto-testes</div>
            <ul className="text-xs space-y-1">
              {tests.map((t, i) => (
                <li key={i} className={t.ok ? "text-emerald-700" : "text-rose-700"}>
                  {t.ok ? "✓" : "✗"} {t.name}{t.detail ? ` (detalhe: ${t.detail})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="mt-8 text-center text-xs text-slate-400">
          <div className="flex items-center justify-center gap-2">
            <span>Conecte este dashboard ao seu back-end para dados reais.</span>
          </div>
        </footer>
      </div>
    </div>
  );
  
}
/*
<div className="flex gap-2">
  <button
    className="px-3 py-1 rounded-xl bg-emerald-600 text-white hover:opacity-90"
    onClick={() => handleEncerrar(item.mentionId)}
    title="Marcar como respondido"
  >
    Encerrar
  </button>

  <div className="flex items-center gap-2">
    <select
      className="border rounded-xl px-2 py-1"
      defaultValue=""
      onChange={(e) => {
        const val = e.target.value;
        if (val) handleEscalar(item.mentionId, val);
      }}
    >
      <option value="" disabled>Escalonar para...</option>
      <option value="N2">Suporte N2</option>
      <option value="N3">Suporte N3</option>
      <option value="COORD">Coordenação</option>
    </select>
  </div>
</div>

  }
  useEffect(() => { refreshTags(); }, []);

  useEffect(() => {
    (async () => {
      try { const list = await getTags(); setTagsCatalog(list); } catch {}
    })();
  }, []);
*/
