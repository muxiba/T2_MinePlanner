import React from 'react';
import { NavLink, useNavigate } from 'react-router';
import clsx from 'clsx';
import { Building2, ChevronsUpDown, LogOut, ShieldCheck, TrendingUp, BarChart3 } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { NewVersionBanner } from './NewVersionBanner';
import { ROLE_LABELS, STATUS_LABELS, isCompanyUsable, trialDaysLeft } from '@/lib/db-types';

/**
 * Moldura do aplicativo logado: barra lateral escura com marca, seletor de
 * empresa, navegação da página atual (slot `nav`), ações (slot `footer`) e conta.
 */
export const AppShell: React.FC<{
  nav?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ nav, footer, children }) => {
  const { profile, memberships, current, role, isOwner, switchCompany, signOut } = useAuth();
  const navigate = useNavigate();

  const accountLink = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
      isActive ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white',
    );

  const trialBadge =
    current?.company.status === 'trial' && isCompanyUsable(current.company)
      ? `Teste: ${trialDaysLeft(current.company)} dia(s)`
      : current
        ? STATUS_LABELS[current.company.status]
        : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#F8F9FA] font-sans text-[#1A1A1A]">
      <aside className="z-20 flex w-64 shrink-0 flex-col bg-[#151619] text-white shadow-xl">
        <div className="border-b border-white/10 p-5">
          <NavLink to="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500">
              <TrendingUp size={22} className="text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">T2MinePlanner</span>
          </NavLink>

          {current && (
            <div className="mt-5">
              <label htmlFor="company-switcher" className="sr-only">
                Empresa
              </label>
              <div className="relative">
                <select
                  id="company-switcher"
                  value={current.company_id}
                  onChange={(e) => {
                    switchCompany(e.target.value);
                    navigate('/');
                  }}
                  disabled={memberships.length < 2}
                  className="w-full appearance-none truncate rounded-lg border border-white/10 bg-white/5 py-2 pr-8 pl-3 text-sm font-medium text-white focus:ring-2 focus:ring-emerald-500/40 focus:outline-none disabled:opacity-100"
                >
                  {memberships.map((m) => (
                    <option key={m.company_id} value={m.company_id} className="text-black">
                      {m.company.name}
                    </option>
                  ))}
                </select>
                {memberships.length > 1 && (
                  <ChevronsUpDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-white/40" />
                )}
              </div>
              <p className="mt-1.5 flex justify-between text-[11px] text-white/40">
                <span>{role ? ROLE_LABELS[role] : ''}</span>
                <span className={current.company.status === 'trial' ? 'text-amber-300/80' : undefined}>{trialBadge}</span>
              </p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3" aria-label="Navegação principal">
          {nav}
        </nav>

        {footer && <div className="border-t border-white/10 bg-black/20 p-5">{footer}</div>}

        <div className="space-y-0.5 border-t border-white/10 p-3">
          <NavLink to="/" end className={accountLink}>
            <BarChart3 size={16} /> Planejamento
          </NavLink>
          {role === 'admin' && (
            <NavLink to="/empresa" className={accountLink}>
              <Building2 size={16} /> Empresa e usuários
            </NavLink>
          )}
          {isOwner && (
            <NavLink to="/dono" className={accountLink}>
              <ShieldCheck size={16} /> Dono do sistema
            </NavLink>
          )}
          <button
            onClick={() => void signOut()}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white/55 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut size={16} />
            <span className="min-w-0 flex-1 truncate">Sair{profile?.full_name ? ` (${profile.full_name.split(' ')[0]})` : ''}</span>
          </button>
        </div>
      </aside>

      <main className="relative flex-1 overflow-y-auto">
        <NewVersionBanner />
        {children}
      </main>
    </div>
  );
};
