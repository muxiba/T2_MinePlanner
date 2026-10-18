import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { MailCheck } from 'lucide-react';
import { db, translateError } from '@/lib/db';
import { useAuth } from '@/auth/AuthProvider';
import { AuthLayout } from '@/components/ui/AuthLayout';
import { Alert, Button, Field } from '@/components/ui';
import { formatCnpj } from '@/lib/format';
import { savePendingCompany } from '@/lib/pending-company';

const SignUpPage: React.FC = () => {
  const { session, refresh } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', company: '', cnpj: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (session && !sentTo && !loading) return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === 'cnpj' ? formatCnpj(e.target.value) : e.target.value }));

  const validate = () => {
    const v: typeof errors = {};
    if (form.fullName.trim().length < 3) v.fullName = 'Informe seu nome completo.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) v.email = 'Informe um e-mail válido.';
    if (form.company.trim().length < 2) v.company = 'Informe o nome da empresa.';
    if (form.cnpj && form.cnpj.replace(/\D/g, '').length !== 14) v.cnpj = 'O CNPJ deve ter 14 dígitos.';
    if (form.password.length < 8) v.password = 'Use pelo menos 8 caracteres.';
    if (form.confirm !== form.password) v.confirm = 'As senhas não conferem.';
    setErrors(v);
    return Object.keys(v).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);
    const company = { name: form.company.trim(), cnpj: form.cnpj || null };
    const { data, error } = await db.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: { emailRedirectTo: `${window.location.origin}/`, data: { name: form.fullName.trim() } },
    });
    if (error) {
      setLoading(false);
      return setError(translateError(error));
    }
    if (!data?.session) {
      // Confirmação de e-mail ligada: a empresa é criada no primeiro login.
      savePendingCompany(company);
      setLoading(false);
      return setSentTo(form.email.trim());
    }
    await db.rpc('sync_profile', { p_full_name: form.fullName.trim() });
    const { error: companyError } = await db.rpc('create_company', { p_name: company.name, p_cnpj: company.cnpj });
    if (companyError) savePendingCompany(company); // a tela "sem empresa" oferece criar de novo
    await refresh();
    setLoading(false);
    navigate('/', { replace: true });
  };

  if (sentTo) {
    return (
      <AuthLayout title="Confirme seu e-mail">
        <div className="space-y-5">
          <MailCheck className="text-emerald-600" size={40} aria-hidden />
          <p className="text-[15px] leading-relaxed text-black/70">
            Enviamos um link de confirmação para <strong>{sentTo}</strong>. Abra o e-mail e clique no link para
            ativar a conta da <strong>{form.company}</strong>. Seu período de teste de 30 dias começa agora.
          </p>
          <Link to="/entrar" className="inline-block text-sm font-semibold text-emerald-700 hover:underline">
            Voltar para o login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Cadastrar empresa"
      subtitle="Crie o acesso da sua empresa. Você será o administrador e poderá convidar sua equipe. São 30 dias de teste."
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Seu nome" autoComplete="name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
        <Field label="E-mail corporativo" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <div className="grid gap-4 sm:grid-cols-[3fr_2fr]">
          <Field label="Empresa" autoComplete="organization" value={form.company} onChange={set('company')} error={errors.company} />
          <Field label="CNPJ (opcional)" inputMode="numeric" value={form.cnpj} onChange={set('cnpj')} error={errors.cnpj} placeholder="00.000.000/0000-00" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Senha" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} />
          <Field label="Confirmar senha" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} />
        </div>
        <Button type="submit" loading={loading} className="w-full py-3">
          Criar conta da empresa
        </Button>
      </form>
      <p className="mt-8 text-sm text-black/55">
        Já tem conta?{' '}
        <Link to="/entrar" className="font-semibold text-emerald-700 hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
};

export default SignUpPage;
