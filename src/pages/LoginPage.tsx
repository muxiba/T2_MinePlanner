import React, { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { supabase, translateError } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/components/ui/AuthLayout';
import { Alert, Button, Field } from '@/components/ui';
import { safeNext } from '@/lib/format';

const LoginPage: React.FC = () => {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
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
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) return setError(translateError(error));
    navigate(next, { replace: true });
  };

  return (
    <AuthLayout title="Entrar" subtitle="Acesse os planos de produção da sua empresa.">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
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
