import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { db, translateError } from '@/lib/db';
import { useAuth } from '@/auth/AuthProvider';
import { ROLE_LABELS, type Role } from '@/lib/db-types';
import { AuthLayout } from '@/components/ui/AuthLayout';
import { Alert, Button, Field, FullScreenLoader } from '@/components/ui';

interface InviteInfo {
  company_name: string;
  email: string;
  role: Role;
  expired: boolean;
  accepted: boolean;
}

const AcceptInvitePage: React.FC = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { session, profile, refresh, switchCompany, signOut } = useAuth();
  const [invite, setInvite] = useState<InviteInfo | null | undefined>(undefined);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    db.rpc('get_invitation', { p_token: token }).then(({ data, error }) => {
      setInvite(error ? null : ((data as InviteInfo[] | null)?.[0] ?? null));
    });
  }, [token]);

  if (invite === undefined) return <FullScreenLoader />;

  if (!invite || invite.expired || invite.accepted) {
    const msg = !invite
      ? 'Convite não encontrado. Confira se o link foi copiado inteiro.'
      : invite.accepted
        ? 'Este convite já foi utilizado.'
        : 'Este convite expirou. Peça um novo ao administrador da empresa.';
    return (
      <AuthLayout title="Convite indisponível">
        <Alert tone="warning">{msg}</Alert>
        <Link to="/entrar" className="mt-6 inline-block text-sm font-semibold text-emerald-700 hover:underline">
          Ir para o login
        </Link>
      </AuthLayout>
    );
  }

  const title = `Entrar na ${invite.company_name}`;
  const subtitle = `Você foi convidado como ${ROLE_LABELS[invite.role].toLowerCase()}.`;

  const accept = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await db.rpc('accept_invitation', { p_token: token });
    if (error) {
      setLoading(false);
      return setError(translateError(error));
    }
    await refresh();
    switchCompany(data as string);
    navigate('/', { replace: true });
  };

  const signUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fullName.trim().length < 3) return setError('Informe seu nome completo.');
    if (password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.');
    setLoading(true);
    setError(null);
    const { data, error } = await db.auth.signUp({
      email: invite.email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/convite/${token}`, data: { name: fullName.trim() } },
    });
    if (error) {
      setLoading(false);
      return setError(translateError(error));
    }
    if (!data?.session) {
      // Confirmação de e-mail ligada: o link do e-mail traz a pessoa de volta a este convite.
      setLoading(false);
      return setSent(true);
    }
    await db.rpc('sync_profile', { p_full_name: fullName.trim() });
    await accept();
  };

  // Já logado (e não no meio do cadastro feito nesta tela)
  if (session && !loading) {
    const sameEmail = profile?.email?.toLowerCase() === invite.email.toLowerCase();
    return (
      <AuthLayout title={title} subtitle={subtitle}>
        {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
        {sameEmail ? (
          <Button onClick={accept} loading={loading} className="w-full py-3">
            Aceitar convite
          </Button>
        ) : (
          <div className="space-y-4">
            <Alert tone="warning">
              Este convite é para <strong>{invite.email}</strong>, mas você está conectado como {profile?.email}.
            </Alert>
            <Button variant="secondary" onClick={() => void signOut()} className="w-full">
              Sair e entrar com {invite.email}
            </Button>
          </div>
        )}
      </AuthLayout>
    );
  }

  if (sent) {
    return (
      <AuthLayout title="Confirme seu e-mail">
        <Alert tone="success">
          Enviamos um link de confirmação para <strong>{invite.email}</strong>. Depois de confirmar, você já entra na{' '}
          {invite.company_name}.
        </Alert>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      <form onSubmit={signUp} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="E-mail" value={invite.email} readOnly disabled />
        <Field label="Seu nome" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <Field label="Crie uma senha" type="password" autoComplete="new-password" hint="Mínimo de 8 caracteres." value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={loading} className="w-full py-3">
          Criar conta e entrar
        </Button>
      </form>
      <p className="mt-8 text-sm text-black/55">
        Já tem conta com este e-mail?{' '}
        <Link to={`/entrar?next=/convite/${token}`} className="font-semibold text-emerald-700 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
};

export default AcceptInvitePage;
