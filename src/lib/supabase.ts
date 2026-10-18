import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** true quando as variáveis do Supabase foram configuradas (local ou no Vercel). */
export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : // Cliente "vazio" só para o app não quebrar; a tela de configuração é exibida antes de qualquer uso.
    (null as unknown as SupabaseClient);

/** Traduz mensagens de erro comuns do Supabase Auth/Postgres para português. */
export function translateError(error: unknown): string {
  const msg = (error as { message?: string })?.message ?? String(error ?? 'Erro desconhecido');
  const map: Array<[RegExp, string]> = [
    [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
    [/email not confirmed/i, 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).'],
    [/user already registered/i, 'Já existe uma conta com este e-mail. Tente entrar ou recuperar a senha.'],
    [/password should be at least/i, 'A senha deve ter pelo menos 8 caracteres.'],
    [/rate limit|too many requests/i, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    [/network|failed to fetch/i, 'Sem conexão com o servidor. Verifique sua internet.'],
    [/row-level security|permission denied/i, 'Você não tem permissão para esta ação.'],
    [/jwt expired/i, 'Sua sessão expirou. Entre novamente.'],
  ];
  for (const [re, pt] of map) if (re.test(msg)) return pt;
  return msg;
}
