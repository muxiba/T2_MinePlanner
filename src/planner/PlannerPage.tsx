import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  LayoutDashboard,
  Truck,
  Settings,
  Calendar,
  Save,
  Download,
  ClipboardList,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  Play,
  Check,
  CloudOff,
  Loader2,
  Eye,
  History,
  ClipboardCheck,
  Waypoints,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/auth/AuthProvider';
import { AppShell } from '@/components/AppShell';
import { Alert, Button, FullScreenLoader } from '@/components/ui';
import type { Scenario } from '@/types';
import { calculateTotalProduction } from '@/utils/calculations';
import { analyzeFleet, ensureFlowRoutes, fitExtraAllocations, fmtTrucks, requiredFlows, syncAutoFleet } from '@/engine/fleet';
import SummaryView from '@/components/summary/SummaryView';
const TutorialView = React.lazy(() => import('@/components/TutorialView'));
const SimulationView = React.lazy(() => import('@/components/simulation/SimulationView'));
import { generatePortableHTML } from '@/utils/export';
import { dismissLegacyData, readLegacyData, usePlan, useScenarios, type SaveState } from './usePlan';

import Dashboard from '@/components/Dashboard';
import RouteManager from '@/components/RouteManager';
import PremisesForm from '@/components/PremisesForm';
import ProductionCalendar from '@/components/ProductionCalendar';
import ScenarioManager from '@/components/ScenarioManager';
import ProductionLogging from '@/components/ProductionLogging';
import ReplanningView from '@/components/ReplanningView';

const NAV_ITEMS = [
  { id: 'premises', label: '1. Premissas Fundamentais', icon: Settings },
  { id: 'routes', label: '2. Dimensionamento de Frota', icon: Truck },
  { id: 'resumo', label: '3. Resultado', icon: ClipboardCheck },
  { id: 'logging', label: 'Lançamento Produção', icon: ClipboardList },
  { id: 'replanning', label: 'Replanejamento', icon: RefreshCw },
  { id: 'calendar', label: 'Calendário', icon: Calendar },
  { id: 'scenarios', label: 'Cenários', icon: Save },
  { id: 'dashboard', label: 'Detalhes de cálculo', icon: LayoutDashboard },
  { id: 'simulacao', label: 'Simulação', icon: Waypoints },
  { id: 'tutorial', label: 'Tutorial', icon: Play },
] as const;

const WORKFLOW_STEPS = [
  { id: 'premises', label: '1. Premissas Fundamentais', icon: Settings },
  { id: 'routes', label: '2. Dimensionamento de Frota', icon: Truck },
  { id: 'resumo', label: '3. Resultado', icon: ClipboardCheck },
] as const;

const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');

const SaveIndicator: React.FC<{ state: SaveState; lastSavedAt: Date | null; error: string | null; onRetry: () => void }> = ({
  state,
  lastSavedAt,
  error,
  onRetry,
}) => {
  if (state === 'error')
    return (
      <button onClick={onRetry} className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:underline" title={error ?? ''}>
        <CloudOff size={14} /> Não salvo — tentar de novo
      </button>
    );
  if (state === 'pending' || state === 'saving')
    return (
      <span className="flex items-center gap-1.5 text-xs text-black/45" aria-live="polite">
        <Loader2 size={14} className="animate-spin" /> Salvando…
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs text-black/45" aria-live="polite">
      <Check size={14} className="text-emerald-600" />
      {lastSavedAt ? `Salvo às ${lastSavedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Salvo'}
    </span>
  );
};

const PlannerPage: React.FC = () => {
  const { current, canEdit } = useAuth();
  const companyId = current!.company_id;
  const plan = usePlan(companyId, canEdit);
  const { routes, setRoutes, premises, setPremises, productionLogs, setProductionLogs } = plan;
  const scenarioApi = useScenarios(companyId, plan.planId);

  const [params, setParams] = useSearchParams();
  const [workflowMode, setWorkflowMode] = useState(() => !params.get('aba'));
  const activeTab = params.get('aba') ?? 'premises';
  const setActiveTab = (id: string) =>
    setParams(
      (p) => {
        p.set('aba', id);
        return p;
      },
      { replace: true },
    );

  const [legacy, setLegacy] = useState(() => (canEdit ? readLegacyData() : null));
  const initialPremisesRef = useRef(premises);
  useEffect(() => {
    if (plan.status === 'ready') initialPremisesRef.current = premises;
    // Só no carregamento do plano
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.status, plan.planId]);

  const results = useMemo(
    () => calculateTotalProduction(routes, premises, productionLogs),
    [routes, premises, productionLogs],
  );

  // Rotas + frota extra nunca passam da frota das premissas: ao mudar rotas ou frota,
  // as alocações por horas são reajustadas para caberem nos caminhões sem rota.
  useEffect(() => {
    if (plan.status !== 'ready' || !canEdit) return;
    // cada fluxo das premissas (ROM, produto, rejeito, estéril) ganha sua rota; apagada, não volta
    const withFlows = ensureFlowRoutes(routes, premises);
    if (withFlows) return setRoutes(withFlows);
    // fluxo que deixou de existir (ex.: desmarcou “possui estéril”) volta a ser criado se reaparecer
    const req = requiredFlows(premises);
    if (premises.dismissedFlows?.some((k) => !req.includes(k))) {
      return setPremises((prev) => ({ ...prev, dismissedFlows: (prev.dismissedFlows ?? []).filter((k) => req.includes(k)) }));
    }
    // rotas em modo automático (inteiro acima / exato) acompanham as premissas
    const synced = syncAutoFleet(routes, premises);
    if (synced) return setRoutes(synced);
    const fitted = fitExtraAllocations(routes, premises);
    if (fitted) setPremises((prev) => ({ ...prev, extraAllocations: fitted }));
  }, [routes, premises, plan.status, canEdit, setPremises, setRoutes]);

  // Motor de dimensionamento v3 (Resumo, cabeçalho e status da barra lateral)
  const analysis = useMemo(() => analyzeFleet(routes, premises), [routes, premises]);

  const scenarios: Scenario[] = useMemo(
    () =>
      scenarioApi.scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        routes: s.routes,
        premises: s.premises,
        timestamp: Date.parse(s.created_at),
      })),
    [scenarioApi.scenarios],
  );

  if (plan.status === 'loading') return <FullScreenLoader label="Carregando plano…" />;

  const resetSimulation = () => {
    if (!window.confirm('Apagar todos os lançamentos de produção e voltar às premissas carregadas?')) return;
    setProductionLogs({});
    setPremises(initialPremisesRef.current);
  };

  const currentStepIndex = WORKFLOW_STEPS.findIndex((s) => s.id === activeTab);
  const nextStep = () => {
    if (currentStepIndex >= 0 && currentStepIndex < WORKFLOW_STEPS.length - 1) {
      setActiveTab(WORKFLOW_STEPS[currentStepIndex + 1].id);
    } else {
      setWorkflowMode(false);
      setActiveTab('resumo');
    }
  };
  const prevStep = () => {
    if (currentStepIndex > 0) setActiveTab(WORKFLOW_STEPS[currentStepIndex - 1].id);
  };

  const exportToCSV = () => {
    const headers = ['Rota', 'Tipo', 'Meta (t/mês úmida)', 'Ciclo (min)', 'Carga por viagem (t)', 'Caminhões alocados', 'Caminhões necessários', 'Capacidade (t/mês)', 'Atendimento (%)', 'Limitado por'];
    const dec = (n: number, d = 1) => n.toFixed(d).replace('.', ',');
    const rows = analysis.routes.map((r) => [
      `"${r.name.replace(/"/g, '""')}"`,
      r.kind,
      dec(r.targetWetT, 0),
      dec(r.cycle.totalMin),
      dec(r.payloadT),
      String(r.trucksAllocated),
      String(r.trucksNeeded),
      dec(r.capacityWetT, 0),
      dec(r.ratio * 100, 0),
      r.limitedBy,
    ]);
    // ; e BOM UTF-8 para abrir corretamente no Excel em português
    const csv = '﻿' + [headers, ...rows].map((r) => r.join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `planejamento_producao_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportToHTML = () => {
    try {
      generatePortableHTML(premises, routes, productionLogs, results);
    } catch (error) {
      console.error('Erro ao gerar exportação HTML:', error);
      window.alert('Ocorreu um erro ao gerar o arquivo. Tente novamente.');
    }
  };

  const importLegacy = () => {
    if (!legacy) return;
    if (legacy.routes?.length) setRoutes(legacy.routes);
    if (legacy.premises) setPremises({ ...premises, ...legacy.premises });
    if (legacy.logs) setProductionLogs(legacy.logs);
    dismissLegacyData();
    setLegacy(null);
  };

  const items = workflowMode ? WORKFLOW_STEPS : NAV_ITEMS;

  const nav = (
    <>
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => setActiveTab(item.id)}
          aria-current={activeTab === item.id ? 'page' : undefined}
          className={`relative flex w-full items-center gap-3 px-6 py-3 text-left transition-colors ${
            activeTab === item.id ? 'bg-emerald-400/5 font-bold text-emerald-400' : 'text-white/60 hover:bg-white/5 hover:text-white'
          }`}
        >
          {activeTab === item.id && <motion.div layoutId="activeTab" className="absolute left-0 h-full w-1 rounded-r-full bg-emerald-500" />}
          <item.icon size={18} className={activeTab === item.id ? 'text-emerald-400' : 'text-white/25'} />
          <span className="text-sm">{item.label}</span>
        </button>
      ))}
      <div className="px-6 py-4">
        <button
          onClick={() => {
            const next = !workflowMode;
            setWorkflowMode(next);
            if (next) setActiveTab('premises');
          }}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-colors ${
            workflowMode
              ? 'bg-white/5 text-white/45 hover:bg-white/10'
              : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
          }`}
        >
          {!workflowMode && <Play size={12} />}
          {workflowMode ? 'Sair do modo guia' : 'Ativar modo guia'}
        </button>
      </div>
    </>
  );

  const footer = (
    <>
      <div className="mb-4 flex items-center gap-3">
        <div className={`h-3 w-3 rounded-full ${analysis.meetsTarget ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <span className="text-xs font-medium text-white/70">
          {analysis.meetsTarget ? 'Atende a meta' : `Não atende: ${analysis.bottleneck?.label.toLowerCase() ?? 'verifique as rotas'}`}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={exportToCSV} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/10 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20">
          <Download size={14} /> CSV
        </button>
        <button onClick={exportToHTML} className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/20 py-2 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-500/30">
          <Download size={14} /> HTML
        </button>
      </div>
    </>
  );

  return (
    <AppShell nav={nav} footer={footer}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-4 border-b border-black/5 bg-white/85 px-8 py-4 backdrop-blur-md">
        <div>
          <h2 className="font-serif text-2xl font-bold tracking-tight text-[#1A1A1A] italic">
            {workflowMode ? 'Workflow de Simulação' : NAV_ITEMS.find((i) => i.id === activeTab)?.label}
          </h2>
          <div className="mt-0.5 flex items-center gap-4">
            <p className="text-xs text-black/40">
              {workflowMode && currentStepIndex >= 0
                ? `Passo ${currentStepIndex + 1} de ${WORKFLOW_STEPS.length}: ${WORKFLOW_STEPS[currentStepIndex].label}`
                : new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            {canEdit ? (
              <SaveIndicator state={plan.saveState} lastSavedAt={plan.lastSavedAt} error={plan.saveError} onRetry={() => void plan.saveNow()} />
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <Eye size={14} /> Somente leitura
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <Metric label="Meta de ROM (t/mês)" value={t0(analysis.romTargetDryT)} className="text-[#1A1A1A]" />
          <Metric
            label="Chega à planta (t/mês)"
            value={t0(analysis.romDeliverableDryT)}
            className={analysis.meetsTarget ? 'text-emerald-600' : 'text-red-600'}
          />
          <div className="h-8 w-px bg-black/10" />
          <Metric label="Caminhões: frota / nas rotas / precisam" value={`${analysis.fleet.premise} / ${fmtTrucks(analysis.fleet.allocated)} / ${analysis.fleet.needed}`} className="text-[#1A1A1A]" />
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 p-8">
        {plan.status === 'error' && <Alert tone="error">Não foi possível carregar o plano: {plan.loadError}</Alert>}
        {plan.status === 'empty' && (
          <Alert tone="info">Ainda não há plano nesta empresa. Peça a um administrador ou planejador para criar o primeiro.</Alert>
        )}

        {legacy && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4">
            <div className="flex items-start gap-3">
              <History className="mt-0.5 text-sky-700" size={20} />
              <div>
                <p className="text-sm font-semibold text-sky-950">Encontramos um planejamento salvo neste navegador</p>
                <p className="text-sm text-sky-900/80">
                  É da versão anterior do sistema, sem login. Importe para o plano da {current!.company.name} e ele passa a ficar salvo na nuvem.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => { dismissLegacyData(); setLegacy(null); }}>
                Ignorar
              </Button>
              <Button onClick={importLegacy}>Importar dados</Button>
            </div>
          </div>
        )}

        {workflowMode && currentStepIndex >= 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <ol className="flex items-center gap-4">
              {WORKFLOW_STEPS.map((step, idx) => (
                <li key={step.id} className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 ${activeTab === step.id ? 'text-emerald-600' : idx < currentStepIndex ? 'text-emerald-500' : 'text-black/25'}`}>
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                        activeTab === step.id ? 'border-emerald-600 bg-emerald-50' : idx < currentStepIndex ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-black/10'
                      }`}
                    >
                      {idx + 1}
                    </div>
                    <span className="text-xs font-semibold">{step.label.split('. ')[1]}</span>
                  </div>
                  {idx < WORKFLOW_STEPS.length - 1 && <div className="h-px w-8 bg-black/10" />}
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-3">
              {currentStepIndex > 0 && (
                <Button variant="ghost" onClick={prevStep}>
                  <ArrowLeft size={16} /> Voltar
                </Button>
              )}
              <Button onClick={nextStep}>
                {currentStepIndex === WORKFLOW_STEPS.length - 1 ? (
                  <>
                    <Play size={16} /> Finalizar e ver dashboard
                  </>
                ) : (
                  <>
                    Próximo <ArrowRight size={16} />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Leitores veem tudo, mas os campos ficam desabilitados */}
        {activeTab === 'tutorial' && (
          <React.Suspense fallback={<p>Carregando tutorial.</p>}>
            <TutorialView />
          </React.Suspense>
        )}
        <fieldset disabled={!canEdit} className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              {activeTab === 'resumo' && (
                <SummaryView
                  analysis={analysis}
                  routes={routes}
                  setRoutes={setRoutes}
                  premises={premises}
                  setPremises={setPremises}
                  canEdit={canEdit}
                />
              )}
              {activeTab === 'simulacao' && (
                <React.Suspense fallback={<p className="text-sm text-black/50">Carregando o simulador…</p>}>
                  <SimulationView premises={premises} setPremises={setPremises} routes={routes} setRoutes={setRoutes} canEdit={canEdit} storageKey={`plan:${plan.planId ?? companyId}`} />
                </React.Suspense>
              )}
              {activeTab === 'dashboard' && (
                <Dashboard
                  results={results}
                  premises={premises}
                  routes={routes}
                  analysis={analysis}
                  companyName={current?.company.name}
                  planName={plan.planName}
                  productionLogs={productionLogs}
                  setLogs={setProductionLogs}
                  onReset={resetSimulation}
                  onPremiseChange={setPremises}
                />
              )}
              {activeTab === 'routes' && <RouteManager routes={routes} setRoutes={setRoutes} results={results} premises={premises} setPremises={setPremises} />}
              {activeTab === 'premises' && <PremisesForm premises={premises} setPremises={setPremises} setRoutes={setRoutes} results={results} />}
              {activeTab === 'logging' && (
                <ProductionLogging routes={routes} logs={productionLogs} setLogs={setProductionLogs} results={results} premises={premises} onReset={resetSimulation} />
              )}
              {activeTab === 'replanning' && <ReplanningView results={results} premises={premises} />}
              {activeTab === 'calendar' && <ProductionCalendar results={results} premises={premises} logs={productionLogs} />}
              {activeTab === 'scenarios' && (
                <ScenarioManager
                  routes={routes}
                  premises={premises}
                  scenarios={scenarios}
                  onCreate={scenarioApi.create}
                  onDelete={scenarioApi.remove}
                  setRoutes={setRoutes}
                  setPremises={setPremises}
                  error={scenarioApi.error}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </fieldset>
      </div>
    </AppShell>
  );
};

const Metric: React.FC<{ label: string; value: string; className?: string }> = ({ label, value, className }) => (
  <div className="flex flex-col items-end">
    <span className="text-xs text-black/45">{label}</span>
    <span className={`text-xl font-semibold tabular-nums ${className ?? ''}`}>{value}</span>
  </div>
);

export default PlannerPage;
