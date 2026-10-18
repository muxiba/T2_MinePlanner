import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { db, translateError } from '@/lib/db';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/components/ui/AuthLayout';
import { Alert, Button, Field } from '@/components/ui';
import { safeNext } from '@/lib/format';

const LoginPage: React.FC = () => {
  const { session, reloadSession } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const passwordReset = Boolean((useLocation().state as { passwordReset?: boolean } | null)?.passwordReset);
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (session) return <Navigate to={next} replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await db.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setLoading(false);
      return setError(translateError(error));
    }
    const ok = await reloadSession();
    setLoading(false);
    if (!ok) return setError('O login foi aceito, mas a sessão não foi criada neste navegador. Tente de novo ou use outro navegador.');
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout title="Entrar" subtitle="Acesse os planos de produção da sua empresa.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {passwordReset && !error && <Alert tone="success">Senha alterada. Entre com a nova senha.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex justify-end">
          <Link to="/recuperar-senha" className="text-sm font-medium text-emerald-700 hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" loading={loading} className="w-full py-3">
          Entrar
        </Button>
      </form>
      <p className="mt-8 text-sm text-black/55">
        Sua empresa ainda não usa o T2MinePlanner?{' '}
        <Link to="/cadastro" className="font-semibold text-emerald-700 hover:underline">
          Cadastrar empresa
        </Link>
      </p>
    </AuthLayout>
  );
};

export default LoginPage;
