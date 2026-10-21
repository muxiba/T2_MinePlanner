import { useCallback, useEffect, useRef, useState } from 'react';
import { db, translateError } from '@/lib/db';
import type { PlanRow, ScenarioRow } from '@/lib/db-types';
import type { DailyLog, DetailedPremises, Route } from '@/types';
import { DEFAULT_PREMISES, INITIAL_ROUTES } from '@/constants';
import { DEFAULT_CATALOG } from '@/engine/fleet';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

type Logs = Record<string, DailyLog[]>;

const AUTOSAVE_DELAY_MS = 1200;

/** Mescla premissas salvas com os padrões atuais, para planos antigos ganharem campos novos. */
export function withDefaults(p: DetailedPremises | null): DetailedPremises {
  const out = { ...DEFAULT_PREMISES, ...(p ?? {}) };
  // volume da caçamba vazio: usa a classe do catálogo com a mesma capacidade (ex.: 8x4 40 t)
  if (!(out.truckVolumeM3 && out.truckVolumeM3 > 0)) {
    const t = DEFAULT_CATALOG.trucks.find((x) => x.id === out.truckClassId) ?? DEFAULT_CATALOG.trucks.find((x) => x.payloadT === out.truckCapacity);
    if (t && t.payloadT === out.truckCapacity) {
      out.truckVolumeM3 = t.volumeM3;
      out.truckClassId = t.id;
    }
  }
  const cls = DEFAULT_CATALOG.trucks.find((x) => x.id === out.truckClassId);
  if (cls && cls.payloadT !== out.truckCapacity) out.truckClassId = undefined;
  return out;
}

/**
 * Carrega (ou cria) o plano principal da empresa e salva automaticamente
 * as alterações no Supabase, com debounce.
 */
export function usePlan(companyId: string, canEdit: boolean) {
  const [planId, setPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('Plano principal');
  const [routes, setRoutes] = useState<Route[]>(INITIAL_ROUTES);
  const [premises, setPremises] = useState<DetailedPremises>(DEFAULT_PREMISES);
  const [productionLogs, setProductionLogs] = useState<Logs>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const lastSavedJson = useRef<string>('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyRow = useCallback((row: PlanRow) => {
    const r = row.routes?.length ? row.routes : INITIAL_ROUTES;
    const p = withDefaults(row.premises);
    const l = row.production_logs ?? {};
    setPlanId(row.id);
    setPlanName(row.name);
    setRoutes(r);
    setPremises(p);
    setProductionLogs(l);
    lastSavedJson.current = JSON.stringify({ routes: r, premises: p, production_logs: l });
    setLastSavedAt(new Date(row.updated_at));
  }, []);

  // Carregamento
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    (async () => {
      const { data, error } = await db
        .from('plans')
        .select('id, company_id, name, premises, routes, production_logs, updated_at')
        .eq('company_id', companyId)
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(translateError(error));
        return setStatus('error');
      }
      if (data) {
        applyRow(data as PlanRow);
        return setStatus('ready');
      }
      if (!canEdit) return setStatus('empty');
      const { data: created, error: createError } = await db
        .from('plans')
        .insert({ company_id: companyId, name: 'Plano principal', premises: DEFAULT_PREMISES, routes: INITIAL_ROUTES })
        .select('id, company_id, name, premises, routes, production_logs, updated_at')
        .single();
      if (cancelled) return;
      if (createError) {
        setLoadError(translateError(createError));
        return setStatus('error');
      }
      applyRow(created as PlanRow);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, canEdit, applyRow]);

  const save = useCallback(async () => {
    if (!planId || !canEdit) return;
    const payload = { routes, premises, production_logs: productionLogs };
    const json = JSON.stringify(payload);
    if (json === lastSavedJson.current) return setSaveState('saved');
    setSaveState('saving');
    const { error } = await db.from('plans').update(payload).eq('id', planId);
    if (error) {
      setSaveError(translateError(error));
      return setSaveState('error');
    }
    lastSavedJson.current = json;
    setSaveError(null);
    setLastSavedAt(new Date());
    setSaveState('saved');
  }, [planId, canEdit, routes, premises, productionLogs]);

  // Autosave com debounce
  useEffect(() => {
    if (status !== 'ready' || !canEdit) return;
    const json = JSON.stringify({ routes, premises, production_logs: productionLogs });
    if (json === lastSavedJson.current) return;
    setSaveState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [routes, premises, productionLogs, status, canEdit, save]);

  // Avisa antes de fechar a aba com alterações não salvas
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (saveState === 'pending' || saveState === 'saving' || saveState === 'error') e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [saveState]);

  return {
    planId,
    planName,
    status,
    loadError,
    routes,
    setRoutes,
    premises,
    setPremises,
    productionLogs,
    setProductionLogs,
    saveState,
    saveError,
    lastSavedAt,
    saveNow: save,
  };
}

/* -------------------------------------------------------------------------- */
/* Dados antigos do navegador (versão sem login)                              */
/* -------------------------------------------------------------------------- */

const LEGACY_KEYS = ['mineplanner_routes', 'mineplanner_premises', 'mineplanner_logs'] as const;
const LEGACY_DONE_KEY = 't2mp.legacyImported';

export interface LegacyData {
  routes?: Route[];
  premises?: DetailedPremises;
  logs?: Logs;
}

export function readLegacyData(): LegacyData | null {
  try {
    if (localStorage.getItem(LEGACY_DONE_KEY)) return null;
    const [r, p, l] = LEGACY_KEYS.map((k) => localStorage.getItem(k));
    if (!r && !p && !l) return null;
    return {
      routes: r ? JSON.parse(r) : undefined,
      premises: p ? JSON.parse(p) : undefined,
      logs: l ? JSON.parse(l) : undefined,
    };
  } catch {
    return null;
  }
}

/** Marca como tratado; os dados originais ficam no navegador como cópia de segurança. */
export function dismissLegacyData() {
  try {
    localStorage.setItem(LEGACY_DONE_KEY, new Date().toISOString());
  } catch {
    /* ignora */
  }
}

/* -------------------------------------------------------------------------- */
/* Cenários                                                                    */
/* -------------------------------------------------------------------------- */

export function useScenarios(companyId: string, planId: string | null) {
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!planId) return;
    const { data, error } = await db
      .from('scenarios')
      .select('id, name, premises, routes, created_at')
      .eq('plan_id', planId)
      .order('created_at', { ascending: false });
    if (error) setError(translateError(error));
    else setScenarios((data ?? []) as ScenarioRow[]);
  }, [planId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string, routes: Route[], premises: DetailedPremises) => {
      const { error } = await db
        .from('scenarios')
        .insert({ company_id: companyId, plan_id: planId, name, routes, premises });
      if (error) {
        setError(translateError(error));
        return false;
      }
      setError(null);
      await reload();
      return true;
    },
    [companyId, planId, reload],
  );

  const remove = useCallback(
    async (id: string) => {
      const { error } = await db.from('scenarios').delete().eq('id', id);
      if (error) setError(translateError(error));
      else setScenarios((s) => s.filter((x) => x.id !== id));
    },
    [],
  );

  return { scenarios, error, create, remove };
}
