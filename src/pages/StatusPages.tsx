import React, { useState } from 'react';
import { Lock, Building2, Settings2 } from 'lucide-react';
import { db, translateError } from '@/lib/db';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/components/ui/AuthLayout';
import { Alert, Button, Field } from '@/components/ui';
import { formatCnpj } from '@/lib/format';
import { clearPendingCompany, readPendingCompany } from '@/lib/pending-company';

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL;

/** Empresa bloqueada ou com teste expirado. */
export const BlockedPage: React.FC = () => {
  const { current, memberships, switchCompany, signOut, isOwner } = useAuth();
  const company = current!.company;
  const expired = company.status === 'trial';
  const others = memberships.filter((m) => m.company_id !== current!.company_id);

  return (
    <AuthLayout title={expired ? 'Período de teste encerrado' : 'Acesso suspenso'}>
      <div className="space-y-5">
        <Lock className="text-amber-600" size={36} aria-hidden />
        <p className="text-[15px] leading-relaxed text-black/70">
          {expired
            ? `O teste de 30 dias da ${company.name} terminou em ${new Date(company.trial_ends_at).toLocaleDateString('pt-BR')}.`
            : `O acesso da ${company.name} está suspenso.`}{' '}
          Todos os planos e lançamentos continuam guardados. Para liberar o acesso, fale com o responsável pelo sistema.
        </p>
        {SUPPORT_EMAIL && (
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Liberação do T2MinePlanner — ${company.name}`)}`}
            className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Solicitar liberação
          </a>
        )}
        {others.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-black/55">Ou acesse outra empresa:</p>
            {others.map((m) => (
              <Button key={m.company_id} variant="secondary" className="w-full" onClick={() => switchCompany(m.company_id)}>
                {m.company.name}
              </Button>
            ))}
          </div>
        )}
        {isOwner && (
          <a href="/dono" className="block text-center text-sm font-semibold text-emerald-700 hover:underline">
            Abrir painel do dono do sistema
          </a>
        )}
        <Button variant="ghost" className="w-full" onClick={() => void signOut()}>
          Sair
        </Button>
      </div>
    </AuthLayout>
  );
};

/** Usuário logado sem nenhuma empresa (ex.: removido de todas): permite criar uma. */
export const NoCompanyPage: React.FC = () => {
  const { refresh, signOut, switchCompany } = useAuth();
  // Pré-preenche com a empresa digitada no cadastro, se ela ainda não foi criada.
  const [pending] = useState(readPendingCompany);
  const [name, setName] = useState(pending?.name ?? '');
  const [cnpj, setCnpj] = useState(pending?.cnpj ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Informe o nome da empresa.');
    setLoading(true);
    const { data, error } = await db.rpc('create_company', { p_name: name.trim(), p_cnpj: cnpj || null });
    setLoading(false);
    if (error) return setError(translateError(error));
    clearPendingCompany();
    switchCompany(data as string);
    await refresh();
  };

  return (
    <AuthLayout
      title={pending ? 'Falta só criar a empresa' : 'Você ainda não faz parte de uma empresa'}
      subtitle={
        pending
          ? 'Confira os dados e conclua o cadastro. Você será o administrador, com 30 dias de teste.'
          : 'Se alguém da sua empresa já usa o sistema, peça um convite ao administrador. Ou cadastre a sua empresa agora.'
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Nome da empresa" value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="CNPJ (opcional)" value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} placeholder="00.000.000/0000-00" />
        <Button type="submit" loading={loading} className="w-full py-3">
          <Building2 size={16} /> Cadastrar empresa
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void signOut()}>
          Sair
        </Button>
      </form>
    </AuthLayout>
  );
};

/** Exibida quando as variáveis do Neon não foram configuradas no ambiente. */
export const SetupMissingPage: React.FC = () => (
  <AuthLayout title="Configuração pendente">
    <div className="space-y-4 text-[15px] leading-relaxed text-black/70">
      <Settings2 className="text-black/40" size={32} aria-hidden />
      <p>
        Faltam as variáveis <code className="rounded bg-black/5 px-1.5">VITE_NEON_AUTH_URL</code> e{' '}
        <code className="rounded bg-black/5 px-1.5">VITE_NEON_DATA_API_URL</code>.
      </p>
      <p>
        Localmente, crie o arquivo <code className="rounded bg-black/5 px-1.5">.env.local</code> a partir do{' '}
        <code className="rounded bg-black/5 px-1.5">.env.example</code>. No Vercel, cadastre-as em Settings → Environment
        Variables e faça um novo deploy.
      </p>
    </div>
  </AuthLayout>
);
