import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { db, translateError } from '@/lib/db';
import { AuthLayout } from '@/components/ui/AuthLayout';
import { Alert, Button, Field } from '@/components/ui';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await db.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setLoading(false);
    if (error) return setError(translateError(error));
    setSent(true);
  };

  return (
    <AuthLayout title="Recuperar senha" subtitle="Enviaremos um link para você criar uma nova senha.">
      {sent ? (
        <Alert tone="success">
          Se existir uma conta para <strong>{email}</strong>, o link chegará em instantes. Confira também a caixa de spam.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="E-mail" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={loading} className="w-full py-3">
            Enviar link
          </Button>
        </form>
      )}
      <Link to="/entrar" className="mt-8 inline-block text-sm font-semibold text-emerald-700 hover:underline">
        Voltar para o login
      </Link>
    </AuthLayout>
  );
};

/** Aberta pelo link do e-mail: o Neon Auth devolve um token de redefinição na URL (?token=...). */
export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const linkError = params.get('error');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use pelo menos 8 caracteres.');
    if (password !== confirm) return setError('As senhas não conferem.');
    setLoading(true);
    const { error } = await db.auth.getBetterAuthInstance().resetPassword({ newPassword: password, token: token! });
    setLoading(false);
    if (error) return setError(translateError(error));
    navigate('/entrar', { replace: true, state: { passwordReset: true } });
  };

  return (
    <AuthLayout title="Nova senha">
      {!token || linkError ? (
        <Alert tone="warning">
          Este link expirou ou já foi usado.{' '}
          <Link to="/recuperar-senha" className="font-semibold underline">
            Pedir um novo link
          </Link>
        </Alert>
      ) : (
        <form onSubmit={onSubmit} className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Nova senha" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Field label="Confirmar nova senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button type="submit" loading={loading} className="w-full py-3">
            Salvar nova senha
          </Button>
        </form>
      )}
    </AuthLayout>
  );
};
