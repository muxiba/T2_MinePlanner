import { createClient, SupabaseAuthAdapter } from '@neondatabase/neon-js';

// URLs públicas do projeto Neon (produção). Podem ser trocadas por variáveis de ambiente,
// por exemplo para apontar para um branch de testes do banco.
const DEFAULT_AUTH_URL = 'https://ep-twilight-butterfly-b67jaa0n.neonauth.c-2.sa-east-1.aws.neon.tech/neondb/auth';
const DEFAULT_DATA_API_URL = 'https://ep-twilight-butterfly-b67jaa0n.apirest.c-2.sa-east-1.aws.neon.tech/neondb/rest/v1';

const authUrl = (import.meta.env.VITE_NEON_AUTH_URL as string | undefined) || DEFAULT_AUTH_URL;
const dataApiUrl = (import.meta.env.VITE_NEON_DATA_API_URL as string | undefined) || DEFAULT_DATA_API_URL;

/** true quando as variáveis do Neon foram configuradas (local ou no Vercel). */
export const isDbConfigured = Boolean(authUrl && dataApiUrl);

/**
 * Cliente único do app: login (Neon Auth, com API no estilo Supabase) e
 * consultas à Data API. O token do usuário logado vai junto em cada consulta,
 * e as políticas RLS do banco decidem o que ele pode ver e alterar.
 */
function makeClient() {
  return createClient({
    auth: {
      url: authUrl!,
      adapter: SupabaseAuthAdapter(),
      // Visitante sem login recebe um token anônimo (usado só para abrir a página de convite).
      allowAnonymous: true,
    },
    dataApi: { url: dataApiUrl! },
  });
}

export type DbClient = ReturnType<typeof makeClient>;

export const db: DbClient = isDbConfigured
  ? makeClient()
  : // Cliente "vazio" só para o app não quebrar; a tela de configuração é exibida antes de qualquer uso.
    (null as unknown as DbClient);

/** Traduz mensagens de erro comuns do login e do banco para português. */
export function translateError(error: unknown): string {
  const msg = (error as { message?: string })?.message ?? String(error ?? 'Erro desconhecido');
  const map: Array<[RegExp, string]> = [
    [/invalid (login credentials|email or password)|invalid password|user not found/i, 'E-mail ou senha incorretos.'],
    [/email not (confirmed|verified)/i, 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).'],
    [/user already (registered|exists)|already exists/i, 'Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.'],
    [/password (should be at least|is too short|too short)/i, 'A senha deve ter pelo menos 8 caracteres.'],
    [/rate limit|too many requests/i, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    [/network|failed to fetch/i, 'Sem conexão com o servidor. Verifique sua internet.'],
    [/row-level security|permission denied/i, 'Você não tem permissão para esta ação.'],
    [/jwt expired|session expired/i, 'Sua sessão expirou. Entre novamente.'],
    [/invalid origin|origin not allowed/i, 'Este endereço não está autorizado no Neon Auth (Trusted domains).'],
  ];
  for (const [re, pt] of map) if (re.test(msg)) return pt;
  return msg;
}
