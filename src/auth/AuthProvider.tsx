import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Membership, Profile, Role } from '@/lib/db-types';
import { isCompanyUsable } from '@/lib/db-types';

const CURRENT_COMPANY_KEY = 't2mp.currentCompany';

interface AuthContextValue {
  /** true enquanto a sessão inicial e os dados do usuário carregam */
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  memberships: Membership[];
  current: Membership | null;
  role: Role | null;
  canEdit: boolean;
  isOwner: boolean;
  switchCompany: (companyId: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredCompany(): string | null {
  try {
    return localStorage.getItem(CURRENT_COMPANY_KEY);
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(readStoredCompany);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setSessionReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const load = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setMemberships([]);
      setDataReady(true);
      return;
    }
    const [profileRes, membersRes] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, is_platform_owner').eq('id', userId).maybeSingle(),
      supabase
        .from('company_members')
        .select('company_id, role, company:companies(id, name, cnpj, status, trial_ends_at, created_at)')
        .eq('user_id', userId)
        .order('created_at'),
    ]);
    setProfile((profileRes.data as Profile | null) ?? null);
    setMemberships(((membersRes.data ?? []) as unknown as Membership[]).filter((m) => m.company));
    setDataReady(true);
  }, [userId]);

  useEffect(() => {
    setDataReady(false);
    void load();
  }, [load]);

  const current = useMemo(() => {
    if (memberships.length === 0) return null;
    return (
      memberships.find((m) => m.company_id === currentId) ??
      memberships.find((m) => isCompanyUsable(m.company)) ??
      memberships[0]
    );
  }, [memberships, currentId]);

  const switchCompany = useCallback((companyId: string) => {
    setCurrentId(companyId);
    try {
      localStorage.setItem(CURRENT_COMPANY_KEY, companyId);
    } catch {
      /* armazenamento indisponível: segue só em memória */
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const role = current?.role ?? null;
  const value: AuthContextValue = {
    loading: !sessionReady || (Boolean(userId) && !dataReady),
    session,
    profile,
    memberships,
    current,
    role,
    canEdit: (role === 'admin' || role === 'planner') && !!current && isCompanyUsable(current.company),
    isOwner: Boolean(profile?.is_platform_owner),
    switchCompany,
    refresh: load,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
