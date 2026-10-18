/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Neon Auth (Better Auth) → Configure Auth → Auth URL */
  readonly VITE_NEON_AUTH_URL?: string;
  /** Neon → Data API → API URL (termina em /rest/v1) */
  readonly VITE_NEON_DATA_API_URL?: string;
  /** E-mail exibido no botão "Solicitar liberação" quando o teste expira */
  readonly VITE_SUPPORT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
