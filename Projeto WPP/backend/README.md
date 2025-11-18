# Backend do WhatsApp SLA Dashboard

API + WebSocket com **Node 18 + Express + Prisma (PostgreSQL)**.

## Endpoints
- `GET /api/slas` — lista últimas menções (ordenadas por `createdAt desc`)
- `GET /api/stats` — métricas agregadas (média, p95, % dentro do SLA, trend, ranking)
- `POST /api/webhooks/zapi` — recebe eventos do Z-API (novo mention / atualização)
- `POST /api/actions/encerrar` — marca como respondido (define `firstReplyAt` e `status="ok"`)
- `POST /api/actions/escalar` — marca `status="breached"` (exemplo de fluxo de escalonamento)
- `GET /health` — healthcheck
- `WS /ws` — notifica `NEW_MENTION` e `SLA_UPDATED`

## Variáveis de ambiente
```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public
PORT=8080
CORS_ORIGIN=https://seu-front.vercel.app
SLA_TARGET_SECONDS=300
```

## Rodar local
```bash
cd backend
npm i
npx prisma migrate dev --name init
npm run dev
```

## Deploy sugerido
- **Railway** ou **Render** (Node + Postgres) ou **Supabase** (Postgres gerenciado) + deploy do Node em Railway/Render.
- Aponte o front (`VITE_API_BASE`) para a URL do backend (HTTPS).

---
\n+## Instâncias + Worker WhatsApp (MVP)

Endpoints adicionais:

- GET /api/instances | POST /api/instances | PUT /api/instances/:id | DELETE /api/instances/:id
- POST /api/instances/:id/start | POST /api/instances/:id/stop
- POST /api/instances/:id/send – { to, text }
- GET /api/instances/:id/qr – último QR (também via WS INSTANCE_QR)

Observações:

- Sessão WhatsApp persistida no Postgres (tabela WhatsAuth), sem uso de disco.
- Worker captura mensagens de grupo contendo @suporte e cria/atualiza Mention com instanceId.
- Eventos WS: INSTANCE_QR e INSTANCE_STATUS, além dos existentes.
