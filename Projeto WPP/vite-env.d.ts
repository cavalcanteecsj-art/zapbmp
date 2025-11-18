// ---------- src/vite-env.d.ts ----------
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Adicione este arquivo ao diretório src/ (src/vite-env.d.ts)
// Ele fornece as definições de tipo para 'import.meta.env' e corrige o erro TS2307.

// No App.tsx, a linha pode permanecer:
// const API_BASE = import.meta.env.VITE_API_BASE || "";
