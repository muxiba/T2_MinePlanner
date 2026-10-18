import type { DailyLog, DetailedPremises, Route } from '@/types';

export type Role = 'admin' | 'planner' | 'viewer';
export type CompanyStatus = 'trial' | 'active' | 'blocked';

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  planner: 'Planejador',
  viewer: 'Leitor',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: 'Edita os planos e gerencia usuários e dados da empresa',
  planner: 'Cria e edita planos, lançamentos e cenários',
  viewer: 'Apenas consulta os resultados',
};

export const STATUS_LABELS: Record<CompanyStatus, string> = {
  trial: 'Em teste',
  active: 'Ativa',
  blocked: 'Bloqueada',
};

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  is_platform_owner: boolean;
}

export interface Company {
  id: string;
  name: string;
  cnpj: string | null;
  status: CompanyStatus;
  trial_ends_at: string;
  created_at: string;
}

export interface Membership {
  company_id: string;
  role: Role;
  company: Company;
}

export interface MemberRow {
  user_id: string;
  role: Role;
  created_at: string;
  profile: Pick<Profile, 'email' | 'full_name'> | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export interface PlanRow {
  id: string;
  company_id: string;
  name: string;
  premises: DetailedPremises | null;
  routes: Route[] | null;
  production_logs: Record<string, DailyLog[]>;
  updated_at: string;
}

export interface ScenarioRow {
  id: string;
  name: string;
  premises: DetailedPremises;
  routes: Route[];
  created_at: string;
}

export interface CompanyOverview {
  id: string;
  name: string;
  cnpj: string | null;
  status: CompanyStatus;
  trial_ends_at: string;
  notes: string | null;
  created_at: string;
  member_count: number;
  admin_emails: string | null;
  last_activity: string | null;
}

/** Empresa liberada para uso: ativa, ou em teste dentro do prazo. Espelha company_is_usable() do banco. */
export function isCompanyUsable(c: Pick<Company, 'status' | 'trial_ends_at'>, now = new Date()): boolean {
  return c.status === 'active' || (c.status === 'trial' && new Date(c.trial_ends_at) > now);
}

/** Dias restantes de teste (0 se expirado). */
export function trialDaysLeft(c: Pick<Company, 'trial_ends_at'>, now = new Date()): number {
  const ms = new Date(c.trial_ends_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
