import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Trash2, UserPlus } from 'lucide-react';
import { db, translateError } from '@/lib/db';
import { useAuth } from '@/auth/AuthProvider';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card, Field, Select } from '@/components/ui';
import { formatCnpj } from '@/lib/format';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  STATUS_LABELS,
  trialDaysLeft,
  type Invitation,
  type MemberRow,
  type Role,
} from '@/lib/db-types';

const inviteLink = (token: string) => `${window.location.origin}/convite/${token}`;

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copiar link' }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      className="px-3 py-1.5 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
      {copied ? 'Copiado' : label}
    </Button>
  );
};

const CompanyPage: React.FC = () => {
  const { current, session, refresh } = useAuth();
  const company = current!.company;
  const companyId = current!.company_id;
  const myId = session!.user.id;

  const [name, setName] = useState(company.name);
  const [cnpj, setCnpj] = useState(company.cnpj ?? '');
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyMsg, setCompanyMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('planner');
  const [inviting, setInviting] = useState(false);
  const [newInvite, setNewInvite] = useState<Invitation | null>(null);

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([
      db
        .from('company_members')
        .select('user_id, role, created_at, profile:profiles(email, full_name)')
        .eq('company_id', companyId)
        .order('created_at'),
      db
        .from('invitations')
        .select('id, email, role, token, accepted_at, expires_at, created_at')
        .eq('company_id', companyId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ]);
    if (m.error || i.error) setError(translateError(m.error ?? i.error));
    setMembers((m.data ?? []) as unknown as MemberRow[]);
    setInvites((i.data ?? []) as Invitation[]);
  }, [companyId]);

  useEffect(() => {
    void load();
    setName(company.name);
    setCnpj(company.cnpj ?? '');
  }, [load, company.name, company.cnpj]);

  const saveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCompany(true);
    const { error } = await db.from('companies').update({ name: name.trim(), cnpj: cnpj || null }).eq('id', companyId);
    setSavingCompany(false);
    if (error) return setCompanyMsg({ tone: 'error', text: translateError(error) });
    setCompanyMsg({ tone: 'success', text: 'Dados da empresa salvos.' });
    void refresh();
  };

  const changeRole = async (userId: string, role: Role) => {
    const { error } = await db.rpc('set_member_role', { p_company: companyId, p_user: userId, p_role: role });
    if (error) setError(translateError(error));
    else {
      setError(null);
      await load();
      if (userId === myId) await refresh();
    }
  };

  const removeMember = async (m: MemberRow) => {
    const who = m.profile?.full_name || m.profile?.email || 'este usuário';
    if (!window.confirm(`Remover ${who} da ${company.name}? A pessoa perde o acesso imediatamente.`)) return;
    const { error } = await db.rpc('remove_member', { p_company: companyId, p_user: m.user_id });
    if (error) setError(translateError(error));
    else {
      setError(null);
      await load();
      if (m.user_id === myId) await refresh();
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Informe um e-mail válido para o convite.');
    if (members.some((m) => m.profile?.email?.toLowerCase() === email)) return setError('Esta pessoa já faz parte da empresa.');
    setInviting(true);
    const { data, error } = await db
      .from('invitations')
      .insert({ company_id: companyId, email, role: inviteRole, invited_by: myId })
      .select('id, email, role, token, accepted_at, expires_at, created_at')
      .single();
    setInviting(false);
    if (error) return setError(translateError(error));
    setError(null);
    setInviteEmail('');
    setNewInvite(data as Invitation);
    await load();
  };

  const revokeInvite = async (id: string) => {
    const { error } = await db.from('invitations').delete().eq('id', id);
    if (error) setError(translateError(error));
    else {
      if (newInvite?.id === id) setNewInvite(null);
      await load();
    }
  };

  const mailto = (inv: Invitation) =>
    `mailto:${inv.email}?subject=${encodeURIComponent(`Convite para o T2MinePlanner — ${company.name}`)}&body=${encodeURIComponent(
      `Olá! Você foi convidado para acessar o planejamento de produção da ${company.name} no T2MinePlanner.\n\nCrie seu acesso por este link (válido por 7 dias):\n${inviteLink(inv.token)}`,
    )}`;

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Empresa e usuários</h1>
          <p className="mt-1 text-sm text-black/50">
            {STATUS_LABELS[company.status]}
            {company.status === 'trial' && `: ${trialDaysLeft(company)} dia(s) restantes de teste`}
          </p>
        </header>

        {error && <Alert tone="error">{error}</Alert>}

        <Card title="Dados da empresa">
          <form onSubmit={saveCompany} className="grid items-end gap-4 sm:grid-cols-[2fr_1.3fr_auto]">
            <Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
            <Field label="CNPJ" value={cnpj} onChange={(e) => setCnpj(formatCnpj(e.target.value))} placeholder="00.000.000/0000-00" />
            <Button type="submit" loading={savingCompany}>
              Salvar
            </Button>
          </form>
          {companyMsg && <div className="mt-4"><Alert tone={companyMsg.tone}>{companyMsg.text}</Alert></div>}
        </Card>

        <Card title="Convidar pessoa" description="Gere um link de acesso e envie por e-mail ou WhatsApp. O link vale por 7 dias e só funciona para o e-mail informado.">
          <form onSubmit={invite} className="grid items-end gap-4 sm:grid-cols-[2fr_1.2fr_auto]">
            <Field label="E-mail" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <Select label="Papel" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" loading={inviting}>
              <UserPlus size={16} /> Gerar convite
            </Button>
          </form>
          <p className="mt-2 text-xs text-black/45">{ROLE_DESCRIPTIONS[inviteRole]}.</p>

          {newInvite && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-medium text-emerald-950">Convite criado para {newInvite.email}</p>
              <code className="mt-2 block truncate rounded-lg bg-white px-3 py-2 text-xs text-black/70">{inviteLink(newInvite.token)}</code>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton text={inviteLink(newInvite.token)} />
                <a href={mailto(newInvite)} className="inline-flex items-center rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/[0.03]">
                  Abrir no e-mail
                </a>
              </div>
            </div>
          )}
        </Card>

        <Card title={`Usuários (${members.length})`}>
          <ul className="divide-y divide-black/5">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.profile?.full_name || m.profile?.email}
                    {m.user_id === myId && <span className="ml-2 text-xs font-normal text-black/40">(você)</span>}
                  </p>
                  {m.profile?.full_name && <p className="truncate text-xs text-black/45">{m.profile.email}</p>}
                </div>
                <select
                  aria-label={`Papel de ${m.profile?.email ?? 'usuário'}`}
                  value={m.role}
                  onChange={(e) => void changeRole(m.user_id, e.target.value as Role)}
                  className="rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
                >
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void removeMember(m)}
                  className="rounded-lg p-2 text-black/35 transition-colors hover:bg-red-50 hover:text-red-600"
                  aria-label={`Remover ${m.profile?.email ?? 'usuário'}`}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {invites.length > 0 && (
          <Card title="Convites pendentes">
            <ul className="divide-y divide-black/5">
              {invites.map((inv) => {
                const expired = new Date(inv.expires_at) <= new Date();
                return (
                  <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{inv.email}</p>
                      <p className="text-xs text-black/45">
                        {ROLE_LABELS[inv.role]} ·{' '}
                        {expired ? <span className="text-red-600">expirado</span> : `vale até ${new Date(inv.expires_at).toLocaleDateString('pt-BR')}`}
                      </p>
                    </div>
                    {!expired && <CopyButton text={inviteLink(inv.token)} />}
                    <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => void revokeInvite(inv.id)}>
                      {expired ? 'Remover' : 'Cancelar'}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default CompanyPage;
