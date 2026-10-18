import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import clsx from 'clsx';
import { db, translateError } from '@/lib/db';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, Card } from '@/components/ui';
import { isCompanyUsable, trialDaysLeft, type CompanyOverview, type CompanyStatus } from '@/lib/db-types';

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : '—');

function statusOf(c: CompanyOverview): { label: string; className: string } {
  if (c.status === 'blocked') return { label: 'Bloqueada', className: 'bg-red-50 text-red-700 ring-red-200' };
  if (c.status === 'active') return { label: 'Ativa', className: 'bg-emerald-50 text-emerald-800 ring-emerald-200' };
  if (!isCompanyUsable(c)) return { label: 'Teste expirado', className: 'bg-amber-50 text-amber-800 ring-amber-200' };
  return { label: `Teste: ${trialDaysLeft(c)} d`, className: 'bg-sky-50 text-sky-800 ring-sky-200' };
}

type Filter = 'all' | CompanyStatus | 'expired';

/** Painel do dono do sistema: acompanha todas as empresas e libera, bloqueia ou estende o teste. */
const OwnerPage: React.FC = () => {
  const [rows, setRows] = useState<CompanyOverview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    const { data, error } = await db.rpc('owner_company_overview');
    if (error) setError(translateError(error));
    else setRows((data ?? []) as CompanyOverview[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (c: CompanyOverview, status: CompanyStatus, trialDays?: number, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(c.id);
    const { error } = await db.rpc('owner_set_company_status', {
      p_company: c.id,
      p_status: status,
      p_trial_days: trialDays ?? null,
      p_notes: null,
    });
    setBusy(null);
    if (error) setError(translateError(error));
    else {
      setError(null);
      await load();
    }
  };

  const editNotes = async (c: CompanyOverview) => {
    const notes = window.prompt(`Anotações sobre ${c.name} (contrato, contato, valores):`, c.notes ?? '');
    if (notes === null) return;
    const { error } = await db.rpc('owner_set_company_status', {
      p_company: c.id,
      p_status: c.status,
      p_trial_days: null,
      p_notes: notes,
    });
    if (error) setError(translateError(error));
    else await load();
  };

  const counts = useMemo(() => {
    const expired = rows.filter((r) => r.status === 'trial' && !isCompanyUsable(r)).length;
    return {
      all: rows.length,
      active: rows.filter((r) => r.status === 'active').length,
      trial: rows.filter((r) => r.status === 'trial').length - expired,
      expired,
      blocked: rows.filter((r) => r.status === 'blocked').length,
    };
  }, [rows]);

  const visible = rows.filter((r) => {
    const q = query.trim().toLowerCase();
    if (q && !`${r.name} ${r.cnpj ?? ''} ${r.admin_emails ?? ''}`.toLowerCase().includes(q)) return false;
    if (filter === 'all') return true;
    if (filter === 'expired') return r.status === 'trial' && !isCompanyUsable(r);
    if (filter === 'trial') return r.status === 'trial' && isCompanyUsable(r);
    return r.status === filter;
  });

  const filters: Array<[Filter, string]> = [
    ['all', 'Todas'],
    ['trial', 'Em teste'],
    ['expired', 'Teste expirado'],
    ['active', 'Ativas'],
    ['blocked', 'Bloqueadas'],
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Dono do sistema</h1>
          <p className="mt-1 text-sm text-black/50">
            Libere quem fechou contrato, bloqueie quem não fechou (os dados são mantidos) ou estenda o teste.
          </p>
        </header>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1 rounded-xl bg-black/[0.04] p-1" role="tablist" aria-label="Filtrar empresas">
            {filters.map(([f, label]) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  filter === f ? 'bg-white font-semibold shadow-sm' : 'text-black/55 hover:text-black',
                )}
              >
                {label} <span className="tabular-nums text-black/40">{counts[f]}</span>
              </button>
            ))}
          </div>
          <label className="relative ml-auto">
            <span className="sr-only">Buscar empresa</span>
            <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-black/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, CNPJ ou e-mail"
              className="w-72 rounded-xl border border-black/10 bg-white py-2 pr-3 pl-9 text-sm focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
            />
          </label>
        </div>

        <Card>
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-black/45">Nenhuma empresa neste filtro.</p>
          ) : (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-black/5 text-left text-xs text-black/45">
                    <th className="px-6 py-2 font-medium">Empresa</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2 text-right font-medium">Usuários</th>
                    <th className="px-3 py-2 font-medium">Cadastro</th>
                    <th className="px-3 py-2 font-medium">Último uso</th>
                    <th className="px-6 py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {visible.map((c) => {
                    const st = statusOf(c);
                    return (
                      <tr key={c.id} className="align-top">
                        <td className="px-6 py-3">
                          <p className="font-medium">{c.name}</p>
                          <p className="text-xs text-black/45">{[c.cnpj, c.admin_emails].filter(Boolean).join(' — ')}</p>
                          <button onClick={() => void editNotes(c)} className="mt-1 text-left text-xs text-black/40 hover:text-emerald-700">
                            {c.notes ? c.notes : 'Adicionar anotação'}
                          </button>
                        </td>
                        <td className="px-3 py-3">
                          <span className={clsx('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', st.className)}>{st.label}</span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{c.member_count}</td>
                        <td className="px-3 py-3 tabular-nums">{fmtDate(c.created_at)}</td>
                        <td className="px-3 py-3 tabular-nums">{fmtDate(c.last_activity)}</td>
                        <td className="px-6 py-3">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {c.status !== 'active' && (
                              <Button className="px-3 py-1.5 text-xs" loading={busy === c.id} onClick={() => void act(c, 'active')}>
                                Liberar
                              </Button>
                            )}
                            {c.status !== 'blocked' && (
                              <Button
                                variant="secondary"
                                className="px-3 py-1.5 text-xs"
                                disabled={busy === c.id}
                                onClick={() => void act(c, 'trial', 15)}
                                title="Coloca em teste por mais 15 dias a partir de hoje"
                              >
                                +15 dias de teste
                              </Button>
                            )}
                            {c.status !== 'blocked' ? (
                              <Button
                                variant="ghost"
                                className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
                                disabled={busy === c.id}
                                onClick={() =>
                                  void act(c, 'blocked', undefined, `Bloquear ${c.name}? Os usuários perdem o acesso, mas os dados ficam guardados.`)
                                }
                              >
                                Bloquear
                              </Button>
                            ) : (
                              <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy === c.id} onClick={() => void act(c, 'trial', 15)}>
                                Reabrir teste
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
};

export default OwnerPage;
