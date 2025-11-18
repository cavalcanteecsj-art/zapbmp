// src/api.ts
const API_BASE = import.meta.env.VITE_API_BASE as string; // ex.: https://wpp-bmp-1.onrender.com

export async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { credentials: "omit" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any)?.error || `${r.status} ${r.statusText}`);
  return data as T;
}

export async function apiPost<T>(
  path: string,
  body: any,
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any)?.error || `${r.status} ${r.statusText}`);
  return data as T;
}

// Opcional: WebSocket URL (para tempo real)
export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws";
useEffect(() => {
  const ws = new WebSocket(WS_URL);
  ws.onmessage = (e) => {
    // aqui você pode atualizar a lista quando chegar NEW_MENTION / SLA_UPDATED
    const msg = JSON.parse(e.data);
    if (msg?.type) {
      // refaça o fetch da lista ou atualize o item afetado
      reloadList();
    }
  };
  return () => ws.close();
}, []);

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { credentials: "omit" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function apiPost<T>(path: string, body: any, extraHeaders: Record<string,string> = {}): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
  return data;
}
