import React, { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { QRCodeSVG } from 'qrcode.react'
import { getInstances, createInstance, deleteInstance, startInstance, stopInstance, getQR, sendMessage, wsURL } from '../lib/api'

type Instance = {
  id: string
  name: string
  status: 'ACTIVE' | 'PAUSED' | 'ERROR'
  lastSeen?: string
  createdAt: string
  updatedAt: string
}

export default function InstancesPage() {
  const [items, setItems] = useState<Instance[]>([])
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [qrById, setQrById] = useState<Record<string, string | null>>({})
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({})

  async function load() {
    setLoading(true)
    try {
      const list = await getInstances()
      setItems(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const url = wsURL()
    if (!url) return
    const ws = new WebSocket(url)
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg?.type === 'INSTANCE_STATUS') {
          setItems(prev => prev.map(it => it.id === msg.instanceId ? { ...it, status: (msg.status || '').toUpperCase() } as Instance : it))
        }
        if (msg?.type === 'INSTANCE_QR') {
          setQrById(prev => ({ ...prev, [msg.instanceId]: msg.qr }))
        }
      } catch {}
    }
    return () => ws.close()
  }, [])

  async function onCreate() {
    if (!name.trim()) return
    await createInstance(name.trim())
    setName('')
    await load()
  }

  async function onDelete(id: string) {
    if (!confirm('Remover instância?')) return
    await deleteInstance(id)
    await load()
  }

  async function onStart(id: string) {
    await startInstance(id)
    // tenta obter QR após start
    const { qr } = await getQR(id)
    setQrById(prev => ({ ...prev, [id]: qr }))
    await load()
  }

  async function onStop(id: string) {
    await stopInstance(id)
    await load()
  }

  async function onSend(id: string) {
    if (!to || !text) return
    await sendMessage(id, to, text)
    alert('Enviado')
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-xl font-semibold">Instâncias WhatsApp</h1>

      <Card>
        <CardContent className="p-4 flex gap-2 items-center">
          <Input placeholder="Nome da instância" value={name} onChange={(e) => setName(e.target.value)} />
          <Button onClick={onCreate}>Criar</Button>
          <Button variant="secondary" onClick={load} disabled={loading}>{loading ? 'Carregando...' : 'Atualizar'}</Button>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-gray-600">Visualização</span>
            <Select value={viewMode} onValueChange={(v) => setViewMode((v as 'cards' | 'list'))}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cards">Cartões</SelectItem>
                <SelectItem value="list">Lista</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {viewMode === 'cards' ? (
        <div className="grid md:grid-cols-2 gap-4">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="font-medium">{it.name}</div>
                    <div className="text-xs text-gray-500">{it.id}</div>
                  </div>
                  <div className="text-sm">
                    <span className={`px-2 py-1 rounded ${it.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : it.status === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{it.status}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => onStart(it.id)}>Iniciar</Button>
                  <Button variant="secondary" onClick={() => onStop(it.id)}>Parar</Button>
                  <Button variant="destructive" onClick={() => onDelete(it.id)}>Remover</Button>
                </div>

                <div className="grid grid-cols-2 gap-2 items-start">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">QR Code</div>
                  {qrById[it.id] ? (
                    <QRCodeSVG value={qrById[it.id] || ''} size={200} className="border rounded"/>
                  ) : (
                    <div className="text-xs text-gray-500">Sem QR. Clique em Iniciar para gerar.</div>
                  )}
                </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Enviar teste</div>
                    <Input placeholder="Telefone (DDD+numero)" value={to} onChange={(e) => setTo(e.target.value)} />
                    <Input placeholder="Mensagem" value={text} onChange={(e) => setText(e.target.value)} />
                    <Button onClick={() => onSend(it.id)}>Enviar</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Nome</th>
                  <th className="text-left px-4 py-2 font-medium">ID</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Ações</th>
                  <th className="text-left px-4 py-2 font-medium">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <React.Fragment key={it.id}>
                    <tr className="border-t">
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium">{it.name}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="text-xs text-gray-500 break-all">{it.id}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <span className={`px-2 py-1 rounded ${it.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : it.status === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{it.status}</span>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => onStart(it.id)}>Iniciar</Button>
                          <Button variant="secondary" onClick={() => onStop(it.id)}>Parar</Button>
                          <Button variant="destructive" onClick={() => onDelete(it.id)}>Remover</Button>
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Button variant="secondary" onClick={() => setExpandedById(prev => ({ ...prev, [it.id]: !prev[it.id] }))}>
                          {expandedById[it.id] ? 'Ocultar' : 'Detalhes'}
                        </Button>
                      </td>
                    </tr>
                    {expandedById[it.id] && (
                      <tr className="border-t bg-slate-50/50">
                        <td className="px-4 py-3" colSpan={5}>
                          <div className="grid md:grid-cols-2 gap-4 items-start">
                            <div className="space-y-2">
                              <div className="text-sm font-medium">QR Code</div>
                    {qrById[it.id] ? (
                      <QRCodeSVG value={qrById[it.id] || ''} size={200} className="border rounded"/>
                    ) : (
                      <div className="text-xs text-gray-500">Sem QR. Clique em Iniciar para gerar.</div>
                    )}
                  </div>
                            <div className="space-y-2">
                              <div className="text-sm font-medium">Enviar teste</div>
                              <Input placeholder="Telefone (DDD+numero)" value={to} onChange={(e) => setTo(e.target.value)} />
                              <Input placeholder="Mensagem" value={text} onChange={(e) => setText(e.target.value)} />
                              <Button onClick={() => onSend(it.id)}>Enviar</Button>
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
    </div>
  )
}
