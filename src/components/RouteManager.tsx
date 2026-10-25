import React, { useMemo } from 'react';
import { processPct } from '@/engine/process';
import { Activity, AlertTriangle, Check, Download, Edit2, MapPin, Plus, PlusCircle, Scale, Shuffle, Trash2, Truck, Wand2 } from 'lucide-react';
import type { DetailedPremises, Route, RouteKind } from '../types';
import { FLOW_ORDER, catalogOf, loaderFromCatalog, analyzeFleet, checkFlows, flowTargets, guessRouteKind, newFlowRoute, requiredFlows, fitExtraAllocations, fmtTrucks, optimizeFleet, syncAutoFleet, trucksWithoutRoute, routeKind, routeRates, sumCalendarHours, KIND_LABELS, type RouteAnalysis } from '@/engine/fleet';
import ExtraFleetManager from './ExtraFleetManager';

/**
 * 2. Dimensionamento de frota.
 * Fonte única: frota, capacidade do caminhão, DF e UF vêm das Premissas Fundamentais.
 * Todos os números vêm do mesmo motor do topo da tela e do Resumo (engine/fleet).
 */

interface RouteManagerProps {
  routes: Route[];
  setRoutes: React.Dispatch<React.SetStateAction<Route[]>>;
  results?: unknown;
  premises: DetailedPremises;
  setPremises: React.Dispatch<React.SetStateAction<DetailedPremises>>;
}

const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pc = (n: number) => `${Math.round(n * 100)}%`;

const inputCls = 'w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-3 py-2 text-sm font-mono';

const RouteManager: React.FC<RouteManagerProps> = ({ routes, setRoutes, premises, setPremises }) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [memo, setMemo] = React.useState<string | null>(null);
  const analysis = useMemo(() => analyzeFleet(routes, premises), [routes, premises]);
  const optFolga = useMemo(() => optimizeFleet(routes, premises, 'folga'), [routes, premises]);
  const optZero = useMemo(() => optimizeFleet(routes, premises, 'zero'), [routes, premises]);
  const f = analysis.fleet;
  const over = f.allocated + f.extraEquivalent > f.premise + 1e-6;
  const [adjustMsg, setAdjustMsg] = React.useState<string | null>(null);

  /** Aplica um modo de frota (inteiro acima / exata) às rotas indicadas e já ajusta os números. */
  const applyMode = (ids: string[] | 'all', mode: 'inteiro' | 'exato') => {
    const next = routes.map((r) => (r.active && (ids === 'all' || ids.includes(r.id)) ? { ...r, fleetMode: mode } : r));
    const synced = syncAutoFleet(next, premises) ?? next;
    setRoutes(synced);
    const fitted = fitExtraAllocations(synced, premises);
    if (fitted) setPremises((prev) => ({ ...prev, extraAllocations: fitted }));
    const a2 = analyzeFleet(synced, { ...premises, extraAllocations: fitted ?? premises.extraAllocations });
    const moves = synced
      .filter((r) => r.active)
      .map((r) => ({ r, from: routes.find((x) => x.id === r.id)?.truckCount ?? 0 }))
      .filter(({ r, from }) => Math.abs(from - r.truckCount) > 1e-9)
      .map(({ r, from }) => `${r.name}: ${fmtTrucks(from)} → ${fmtTrucks(r.truckCount)}`);
    const free = trucksWithoutRoute(synced, premises);
    const short = a2.routes.reduce((s, x) => s + Math.max(0, (mode === 'inteiro' ? x.trucksNeeded : x.trucksNeededExact) - x.trucksAllocated), 0);
    setAdjustMsg(
      `${moves.length ? moves.join(' · ') : 'Nada mudou: as rotas já estavam assim'}. ` +
        `${free} caminhão(ões) ficam na frota extra. Chega à planta: ${t0(a2.romDeliverableDryT)} t.` +
        (short > 0.01 ? ` A frota não basta: faltam ${fmtTrucks(short)} caminhão(ões) para todas as rotas baterem a meta.` : ''),
    );
  };

  const handleUpdateRoute = (id: string, updates: Partial<Route>) => {
    setAdjustMsg(null);
    setRoutes(routes.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };
  const handleDeleteRoute = (id: string) => {
    const r = routes.find((x) => x.id === id);
    const next = routes.filter((x) => x.id !== id);
    setRoutes(next);
    // apagou a última rota de um fluxo das premissas: não recriar automaticamente
    if (r) {
      const k = routeKind(r);
      if (requiredFlows(premises).includes(k) && !next.some((x) => routeKind(x) === k)) {
        setPremises((prev) => ({ ...prev, dismissedFlows: [...new Set([...(prev.dismissedFlows ?? []), k])] }));
      }
    }
  };
  const addFlowRoute = (kind: RouteKind) => {
    const nr = newFlowRoute(kind, premises);
    setRoutes([...routes, nr]);
    setPremises((prev) => ({ ...prev, dismissedFlows: (prev.dismissedFlows ?? []).filter((k) => k !== kind) }));
    setEditingId(nr.id);
  };
  const flows = useMemo(() => checkFlows(routes, premises), [routes, premises]);
  const sameKindCount = (k: RouteKind) => routes.filter((r) => r.active && routeKind(r) === k).length;

  const handleAddRoute = () => {
    const name = prompt('Nome da nova frente/rota:', `Frente ${routes.length + 1}`);
    if (name === null) return;
    const newRoute: Route = {
      id: Math.random().toString(36).slice(2, 11),
      name: name || `Nova rota ${routes.length + 1}`,
      active: true,
      truckCount: 0,
      truckCapacity: premises.truckCapacity,
      distance: 1000,
      cycleTime: 20,
      mechanicalAvailability: premises.dfMina,
      operationalEfficiency: 100,
      processType: premises.processType,
    };
    setRoutes([newRoute, ...routes]);
    setEditingId(newRoute.id);
  };

  const handleMassChange = (route: Route, value: number) => {
    const kind = routeKind(route);
    {
      const limit = flows.find((c) => c.kind === kind)?.targetDryT ?? flowTargets(premises)[kind];
      const others = routes.filter((r) => r.id !== route.id && r.active && routeKind(r) === kind).reduce((a, r) => a + (r.targetMass || 0), 0);
      if (others + value > limit) {
        const v = Math.max(0, limit - others);
        alert(`A soma das rotas de ${KIND_LABELS[kind]} não pode passar da massa do fluxo, ${Math.round(limit).toLocaleString('pt-BR')} t. Valor ajustado para o saldo: ${Math.round(v).toLocaleString('pt-BR')} t.`);
        value = v;
      }
    }
    handleUpdateRoute(route.id, { targetMass: value || undefined });
  };

  const exportToCSV = () => {
    const head = ['Rota', 'Tipo', 'Ativa', 'Meta seca (t)', 'Meta úmida (t)', 'Carga útil (t)', 'DMT (m)', 'Ciclo (min)', 'DF (%)', 'UF (%)', 'Horas efetivas (h)', 't/h por caminhão', 't/mês por caminhão', 'Necessários (exato)', 'Necessários', 'Nas rotas', 'Capacidade (t/mês)', '% da meta'];
    const dec = (n: number, d = 2) => n.toFixed(d).replace('.', ',');
    const rows = routes.map((r) => {
      const a = analysis.routes.find((x) => x.id === r.id);
      if (!a) return [r.name, KIND_LABELS[routeKind(r)], 'Não'];
      return [r.name, KIND_LABELS[a.kind], 'Sim', dec(a.targetDryT, 0), dec(a.targetWetT, 0), dec(a.payloadT, 1), String(r.distance), dec(a.cycle.totalMin), dec(a.hours.df * 100, 1), dec(a.hours.uf * 100, 1), dec(a.hours.effective, 1), dec(a.truckRateTph), dec(a.truckMonthT, 0), dec(a.trucksNeededExact), String(a.trucksNeeded), String(a.trucksAllocated), dec(a.capacityWetT, 0), dec(a.ratio * 100, 1)];
    });
    const csv = '﻿' + [head, ...rows].map((r) => r.join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dimensionamento_frota_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const visibleRoutes = routes.filter((r) => {
    const k = routeKind(r);
    if (premises.processType === 'seco' && k === 'tailings') return false;
    if (!premises.hasWasteRock && k === 'waste') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-black/80">Dimensionamento de frota</h3>
          <p className="text-sm text-black/50">Frota, capacidade do caminhão, DF e UF vêm das Premissas Fundamentais. Aqui você distribui os caminhões entre as rotas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportToCSV} className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-4 py-2.5 text-sm font-bold text-black/60 hover:bg-black/[0.02]">
            <Download size={16} /> Exportar Excel
          </button>
          <button onClick={handleAddRoute} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600">
            <Plus size={16} /> Adicionar frente/rota
          </button>
        </div>
      </div>

      {/* ------------------------------ frota ------------------------------ */}
      <section className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Frota (premissas)" value={String(f.premise)} />
          <Stat label="Nas rotas" value={fmtTrucks(f.allocated)} tone={over ? 'bad' : undefined} />
          <Stat label="Sem rota (frota extra)" value={fmtTrucks(f.spare)} sub={Math.abs(f.spare - Math.round(f.spare)) > 0.01 ? `${Math.floor(f.spare + 1e-9)} caminhão(ões) inteiro(s) livre(s)` : undefined} tone={f.spare > 0.01 && !analysis.meetsTarget ? 'warn' : undefined} />
          <Stat label="Necessários" value={`${f.needed}`} sub={`${n2(f.neededExact)} sem arredondar`} />
          <Stat
            label="Chega à planta"
            value={`${t0(analysis.romDeliverableDryT)} t`}
            sub={`${pc(analysis.romTargetDryT ? analysis.romDeliverableDryT / analysis.romTargetDryT : 1)} da meta de ${t0(analysis.romTargetDryT)} t · possível com esta frota: ${t0(analysis.romPossibleDryT)} t`}
            tone={analysis.meetsTarget ? 'ok' : 'bad'}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={() => applyMode('all', 'inteiro')} className="inline-flex items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
            <Scale size={15} /> Ajustar todas à meta (inteiro acima)
          </button>
          <button onClick={() => applyMode('all', 'exato')} className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
            Frota exata em todas
          </button>
          <span className="text-xs text-black/50">
            Inteiro acima: cada rota recebe o número redondo que bate a meta (3,60 → 4). Exata: a frota quebrada necessária (3,60), produção igual à meta. O que sobra da frota de {f.premise} vai para a frota extra. O ajuste acompanha as premissas (fila, DMT, DF…).
          </span>
        </div>
        {adjustMsg && <p className="mt-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{adjustMsg}</p>}

        {over && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            As rotas usam {fmtTrucks(f.allocated)} caminhões{f.extraEquivalent > 0 ? ` (+${n1(f.extraEquivalent)} em alocações por horas)` : ''}, mais que a frota de {f.premise} das premissas. Corrija a frota nas premissas ou redistribua.
          </p>
        )}

        {!analysis.meetsTarget && (
          <div className="mt-4 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
            <p className="text-sm font-semibold text-emerald-900">Otimização da frota</p>
            {optFolga.moves.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setRoutes(optFolga.routes)} className="inline-flex items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
                  <Wand2 size={15} /> Alocar a folga onde falta
                </button>
                <span className="text-sm text-black/70">
                  {optFolga.moves.map((m) => `${m.name}: ${m.from} → ${m.to}`).join(' · ')} → chega à planta {t0(optFolga.afterDeliverableDryT)} t
                  {optFolga.meetsTarget ? ', atende a meta' : ''}
                  {optFolga.spareLeft > 0 ? `; ${optFolga.spareLeft} caminhão(ões) ficam de reserva` : ''}.
                </span>
              </div>
            ) : (
              <p className="text-sm text-black/70">Não há caminhão sem rota para alocar.</p>
            )}
            {optZero.afterDeliverableDryT > optFolga.afterDeliverableDryT + 1 && (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => setRoutes(optZero.routes)} className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
                  <Shuffle size={15} /> Redistribuir toda a frota
                </button>
                <span className="text-sm text-black/70">
                  Remanejando também os caminhões já alocados: chega à planta {t0(optZero.afterDeliverableDryT)} t{optZero.meetsTarget ? ', atende a meta' : ''}.
                </span>
              </div>
            )}
            {!optFolga.meetsTarget && !optZero.meetsTarget && optZero.missingForTarget > 0 && (
              <p className="text-sm text-black/70">
                Mesmo com toda a frota bem distribuída faltam <b>{optZero.missingForTarget} caminhão(ões)</b> para todas as rotas atingirem a meta (ou ganhos de produtividade: veja o Resumo).
              </p>
            )}
            <p className="text-xs text-black/50">
              Regra: cada caminhão vai para a rota com a menor capacidade em relação à sua meta (ROM primeiro), desde que ele aumente a capacidade. Rotas em que a carga é o gargalo não recebem caminhão.
            </p>
          </div>
        )}
      </section>

      <ExtraFleetManager routes={routes} premises={premises} setPremises={setPremises} analysis={analysis} />

      {/* ------------------------ equipamentos de carga ------------------------ */}
      <section className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <div className="mb-3">
          <h4 className="font-bold text-black/80">Equipamentos de carga necessários</h4>
          <p className="text-xs text-black/50">
            Por local de carregamento (escolha o equipamento em 1. Premissas → Locais e movimentações) ou por rota com equipamento próprio. Necessários = horas de carga no mês (caminhões carregados × tempo de carga) ÷ horas efetivas de um equipamento (calendário × DF do equipamento × UF).
          </p>
        </div>
        {analysis.loaderNeeds.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/45">
                  <th className="py-1.5 pr-2 font-medium">Local / rota</th>
                  <th className="py-1.5 pr-2 font-medium">Equipamento</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Caçambadas por caminhão</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Carga (min)</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Caminhões / mês</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Horas de carga / mês</th>
                  <th className="py-1.5 pr-2 text-right font-medium">h efetivas por equip.</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Necessários</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Disponíveis</th>
                  <th className="py-1.5 text-right font-medium">Ocupação</th>
                </tr>
              </thead>
              <tbody>
                {analysis.loaderNeeds.map((l) => {
                  const short = l.available !== null && l.available < l.needed;
                  return (
                    <tr key={`${l.source}-${l.where}`} className="border-b border-black/5">
                      <td className="py-1.5 pr-2 font-medium">{l.where}<span className="block text-[11px] font-normal text-black/45">{l.source === 'local' ? `local · ${l.routeIds.length} movimentação(ões)` : 'equipamento próprio da rota'}</span></td>
                      <td className="py-1.5 pr-2">{l.loaderName}</td>
                      <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${l.passes > 6.5 || l.passes < 2.5 ? 'text-amber-700' : ''}`}>{n1(l.passes)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{n1(l.loadMin)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(l.trucksLoaded)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(l.busyH)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(l.effHPerUnit)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono font-bold tabular-nums">{l.needed} <span className="font-normal text-black/40">({n2(l.neededExact)})</span></td>
                      <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${short ? 'font-bold text-red-600' : ''}`}>{l.available ?? '—'}</td>
                      <td className={`py-1.5 text-right font-mono tabular-nums ${l.utilization > 0.85 ? 'text-amber-700' : ''}`}>{pc(l.utilization)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-black/45">
              Ideal de 3 a 6 caçambadas por caminhão (em âmbar fora disso). Ocupação acima de ~85% forma fila de caminhões na carga: a simulação mede essa fila. Disponíveis em vermelho: faltam equipamentos.
            </p>
          </div>
        ) : (
          <p className="text-sm text-black/50">Nenhum equipamento de carga informado. Escolha o equipamento de cada local em 1. Premissas → Locais e movimentações (coluna “Carregamento dos caminhões”); sem ele, vale o tempo de carga das premissas.</p>
        )}
      </section>

      {/* ------------------------------ fluxos ------------------------------ */}
      <section className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <div className="mb-3">
          <h4 className="font-bold text-black/80">Fluxos de massa</h4>
          <p className="text-xs text-black/50">
            As massas vêm do fluxo principal das premissas: ROM; produto = ROM × RM global; rejeito filtrado = ROM × rejeito total (só no processo úmido); estéril = meta de estéril.
            Várias rotas do mesmo fluxo (ex.: dois pontos de basculamento com distâncias diferentes) dividem a massa do fluxo pelo peso de cada uma ou pela massa digitada, e a soma fecha no fluxo.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/45">
                <th className="py-1.5 pr-2 font-medium">Fluxo</th>
                <th className="py-1.5 pr-2 text-right font-medium">Massa do fluxo (t seca)</th>
                <th className="py-1.5 pr-2 text-right font-medium">Nas rotas (t seca)</th>
                <th className="py-1.5 pr-2 text-right font-medium">Rotas</th>
                <th className="py-1.5 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {flows.map((c) => (
                <tr key={c.kind} className="border-b border-black/5">
                  <td className="py-1.5 pr-2 font-medium">{KIND_LABELS[c.kind]}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(c.targetDryT)}</td>
                  <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(c.assignedDryT)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{c.routes}</td>
                  <td className="py-1.5 text-xs">
                    {c.status === 'ok' && <span className="text-emerald-700">fecha com o fluxo</span>}
                    {c.status === 'sem_rota' && (
                      <span className="text-red-700">
                        sem rota: {t0(c.targetDryT)} t sem transporte.{' '}
                        <button type="button" className="font-semibold text-emerald-700 hover:underline" onClick={() => addFlowRoute(c.kind)}>Criar rota</button>
                      </span>
                    )}
                    {c.status === 'abaixo' && <span className="text-amber-700">faltam {t0(c.targetDryT - c.assignedDryT)} t: as massas digitadas somam menos que o fluxo; deixe uma rota sem massa para receber o saldo</span>}
                    {c.status === 'acima' && <span className="text-red-700">passa {t0(c.assignedDryT - c.targetDryT)} t do fluxo: reduza as massas digitadas</span>}
                    {c.status === 'sem_meta' && <span className="text-black/50">o fluxo não existe nas premissas (massa 0)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-black/55">
          Adicionar rota de:
          {FLOW_ORDER.filter((k) => flowTargets(premises)[k] > 0).map((k) => (
            <button key={k} type="button" onClick={() => addFlowRoute(k)} className="rounded-lg border border-black/10 bg-white px-2.5 py-1 font-semibold text-black/70 hover:bg-black/[0.03]">
              + {KIND_LABELS[k]}
            </button>
          ))}
          <span className="text-black/40">Cada fluxo das premissas ganha uma rota automaticamente; se você apagar, ela não volta (crie de novo aqui).</span>
        </div>
      </section>

      {/* ------------------------------ rotas ------------------------------ */}
      {visibleRoutes.map((route) => {
        const a = analysis.routes.find((x) => x.id === route.id);
        const kind = routeKind(route);
        const area = kind === 'product' || kind === 'tailings' ? 'planta' : 'mina';
        const rates = routeRates(route, premises, area);
        const editing = editingId === route.id;
        return (
          <div key={route.id} className={`rounded-3xl border bg-white shadow-sm ${editing ? 'border-emerald-500 ring-4 ring-emerald-500/5' : 'border-black/5'}`}>
            <div className="p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <div className={`rounded-2xl p-3 ${route.active ? 'bg-emerald-50 text-emerald-500' : 'bg-black/5 text-black/20'}`}>
                    <Truck size={24} />
                  </div>
                  {editing ? (
                    <div className="flex flex-col gap-2">
                      <input type="text" value={route.name} onChange={(e) => handleUpdateRoute(route.id, { name: e.target.value })} className="rounded-xl border border-black/5 bg-[#F8F9FA] px-4 py-2 text-lg font-bold" />
                      <label className="flex flex-col gap-1 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-[10px] font-black tracking-widest text-emerald-700 uppercase">
                        <span className="flex items-center gap-2"><PlusCircle size={12} /> Massa mensal planejada (t seca)</span>
                        <input
                          type="number"
                          value={route.targetMass || ''}
                          onChange={(e) => handleMassChange(route, parseFloat(e.target.value) || 0)}
                          className="w-full rounded-lg border border-emerald-200 bg-white px-3 py-2 font-mono text-sm font-bold text-emerald-900 normal-case"
                          placeholder="vazio = calculada pelas premissas"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1 text-[10px] font-black tracking-widest text-black/45 uppercase">
                          Fluxo
                          <select
                            value={kind}
                            onChange={(e) => handleUpdateRoute(route.id, { kind: e.target.value as RouteKind, targetMass: undefined })}
                            className="rounded-lg border border-black/10 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-black/80"
                          >
                            {FLOW_ORDER.map((k) => (
                              <option key={k} value={k}>{KIND_LABELS[k]}{!route.kind && guessRouteKind(route.name) === k ? ' (pelo nome)' : ''}</option>
                            ))}
                          </select>
                        </label>
                        <label className="col-span-2 flex flex-col gap-1 text-[10px] font-black tracking-widest text-black/45 uppercase">
                          Equipamento de carga
                          <span className="flex gap-2">
                            <select
                              value={route.loader ? catalogOf(premises).loaders.find((l) => l.name === route.loader!.name)?.id ?? 'custom' : ''}
                              onChange={(e) => {
                                const l = catalogOf(premises).loaders.find((x) => x.id === e.target.value);
                                handleUpdateRoute(route.id, { loader: l ? loaderFromCatalog(l, premises, route.loader?.count ?? 1) : undefined });
                              }}
                              className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-2 py-2 text-sm font-semibold normal-case tracking-normal text-black/80"
                            >
                              <option value="">Não informado (usa o tempo de carga das premissas)</option>
                              {catalogOf(premises).loaders.map((l) => (
                                <option key={l.id} value={l.id}>{l.manufacturer ? `${l.manufacturer} – ` : ''}{l.name}</option>
                              ))}
                              {route.loader && !catalogOf(premises).loaders.some((l) => l.name === route.loader!.name) && <option value="custom">{route.loader.name}</option>}
                            </select>
                            {route.loader && (
                              <input type="number" min={1} step={1} value={route.loader.count} title="Quantidade de equipamentos" aria-label="Quantidade de equipamentos de carga"
                                onChange={(e) => handleUpdateRoute(route.id, { loader: { ...route.loader!, count: Math.max(1, Math.round(Number(e.target.value) || 1)) } })}
                                className="w-16 rounded-lg border border-black/10 bg-white px-2 py-2 font-mono text-sm" />
                            )}
                          </span>
                        </label>
                        {sameKindCount(kind) > 1 && !route.targetMass && (
                          <label className="flex flex-col gap-1 text-[10px] font-black tracking-widest text-black/45 uppercase" title="Divide o saldo do fluxo entre as rotas sem massa digitada: 1 e 1 = metade para cada; 3 e 1 = 75% e 25%.">
                            Peso na divisão
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={route.share ?? 1}
                              onChange={(e) => handleUpdateRoute(route.id, { share: Math.max(0, Number(e.target.value) || 0) })}
                              className="rounded-lg border border-black/10 bg-white px-2 py-2 font-mono text-sm normal-case"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <h4 className="text-lg font-bold text-black/80">{route.name}</h4>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase ${route.active ? 'bg-emerald-100 text-emerald-700' : 'bg-black/5 text-black/40'}`}>{route.active ? 'Ativa' : 'Inativa'}</span>
                        <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-black/55 uppercase">{KIND_LABELS[kind]}</span>
                        {a && <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-widest text-emerald-600 uppercase">Meta: {t0(a.targetDryT)} t seca</span>}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!route.active && (
                    <button onClick={() => handleUpdateRoute(route.id, { active: true })} className="inline-flex items-center gap-1.5 rounded-xl bg-black/5 px-3 py-2 text-xs font-semibold text-black/60 hover:bg-emerald-50 hover:text-emerald-700" title="Ativar rota">
                      <Activity size={14} /> Ativar rota
                    </button>
                  )}
                  {route.active && <FleetToggle mode={route.fleetMode} onChange={(m) => applyMode([route.id], m)} />}
                  <button onClick={() => setEditingId(editing ? null : route.id)} className={`rounded-xl p-2.5 ${editing ? 'bg-emerald-500 text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'}`} title="Editar">
                    {editing ? <Check size={18} /> : <Edit2 size={18} />}
                  </button>
                  <button onClick={() => handleDeleteRoute(route.id)} className="rounded-xl bg-red-50 p-2.5 text-red-400 hover:bg-red-100 hover:text-red-600" title="Excluir">
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
                <Field label="Caminhões na rota" icon={<Truck size={12} />}>
                  {editing ? (
                    <input type="number" min={0} step={1} value={route.truckCount} onChange={(e) => handleUpdateRoute(route.id, { truckCount: Math.max(0, Math.round(Number(e.target.value) || 0)), isManualOverride: true, fleetMode: 'manual' })} className={inputCls} />
                  ) : (
                    <p className="font-mono text-lg font-bold">
                      {fmtTrucks(route.truckCount)}
                      <span className="ml-2 align-middle text-[10px] font-semibold tracking-wide text-black/40 uppercase">
                        {route.fleetMode === 'inteiro' ? 'ajustada ↑' : route.fleetMode === 'exato' ? 'exata' : 'manual'}
                      </span>
                    </p>
                  )}
                </Field>
                <Field label="DMT (m)" icon={<MapPin size={12} />}>
                  {editing ? (
                    <input type="number" value={route.distance} onChange={(e) => handleUpdateRoute(route.id, { distance: parseFloat(e.target.value) || 0 })} className={inputCls} />
                  ) : (
                    <p className="font-mono text-lg font-bold">{t0(route.distance)}</p>
                  )}
                </Field>
                <Field label="Carga útil (t)">
                  {editing && rates.own ? (
                    <input type="number" value={route.truckCapacity} onChange={(e) => handleUpdateRoute(route.id, { truckCapacity: parseFloat(e.target.value) || 0 })} className={inputCls} />
                  ) : (
                    <p className="font-mono text-lg font-bold">{n1(a?.payloadT ?? rates.capacityT)}</p>
                  )}
                </Field>
                <Field label="DF (%)">
                  {editing && rates.own ? (
                    <input type="number" value={route.mechanicalAvailability} onChange={(e) => handleUpdateRoute(route.id, { mechanicalAvailability: parseFloat(e.target.value) || 0 })} className={inputCls} />
                  ) : (
                    <p className="font-mono text-lg font-bold">{n1(rates.df)}</p>
                  )}
                </Field>
                <Field label="UF (%)">
                  {editing && rates.own ? (
                    <input type="number" value={route.utilization ?? rates.uf} onChange={(e) => handleUpdateRoute(route.id, { utilization: parseFloat(e.target.value) || 0 })} className={inputCls} />
                  ) : (
                    <p className="font-mono text-lg font-bold">{n1(rates.uf)}</p>
                  )}
                </Field>
                <Field label="Ciclo (min)">
                  <p className="font-mono text-lg font-bold">{a ? n1(a.cycle.totalMin) : '—'}</p>
                </Field>
              </div>
              {editing && (
                <label className="mt-3 flex items-center gap-2 text-xs text-black/60">
                  <input
                    type="checkbox"
                    checked={rates.own}
                    onChange={(e) =>
                      handleUpdateRoute(route.id, e.target.checked ? { ownRates: true, mechanicalAvailability: rates.df, utilization: rates.uf, truckCapacity: rates.capacityT } : { ownRates: false })
                    }
                  />
                  Esta rota usa caminhão, DF ou UF diferentes das premissas
                </label>
              )}
              {editing && (
                <label className="mt-2 flex items-center gap-2 text-xs text-black/60">
                  <input type="checkbox" checked={route.active} onChange={(e) => handleUpdateRoute(route.id, { active: e.target.checked })} />
                  Rota ativa (desmarque para tirar a rota do dimensionamento; os caminhões dela voltam para a frota extra)
                </label>
              )}
              {!editing && (
                <p className="mt-2 text-[11px] text-black/40">
                  {rates.own ? 'Valores próprios desta rota.' : `Carga útil, DF e UF das premissas (${area === 'mina' ? 'mina' : 'planta'}).`}
                </p>
              )}

              {a && <RouteResult a={a} open={memo === route.id} onToggle={() => setMemo(memo === route.id ? null : route.id)} premises={premises} />}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Liga/desliga o ajuste da frota da rota: ligado = inteiro acima; desligado = frota exata (quebrada). */
const FleetToggle: React.FC<{ mode?: Route['fleetMode']; onChange: (m: 'inteiro' | 'exato') => void }> = ({ mode, onChange }) => {
  const on = mode === 'inteiro';
  const label = on ? 'Inteiro acima' : mode === 'exato' ? 'Frota exata' : 'Manual';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(on ? 'exato' : 'inteiro')}
      title={on ? 'Ligado: frota arredondada para cima. Clique para usar a frota exata (quebrada).' : 'Clique para ajustar a frota à meta, arredondada para cima.'}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${on ? 'bg-emerald-50 text-emerald-700' : mode === 'exato' ? 'bg-amber-50 text-amber-700' : 'bg-black/5 text-black/50'}`}
    >
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-black/20'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: 'ok' | 'bad' | 'warn' }> = ({ label, value, sub, tone }) => (
  <div className="rounded-2xl bg-[#F8F9FA] p-4">
    <p className="mb-1 text-[10px] font-bold tracking-widest text-black/40 uppercase">{label}</p>
    <p className={`font-mono text-xl font-bold ${tone === 'ok' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-black/80'}`}>{value}</p>
    {sub && <p className="mt-0.5 text-[11px] text-black/45">{sub}</p>}
  </div>
);

const Field: React.FC<{ label: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ label, icon, children }) => (
  <div className="space-y-1.5">
    <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-black/40 uppercase">
      {icon}
      {label}
    </p>
    {children}
  </div>
);

/** Resultado da rota e memória de cálculo passo a passo. */
const RouteResult: React.FC<{ a: RouteAnalysis; open: boolean; onToggle: () => void; premises: DetailedPremises }> = ({ a, open, onToggle, premises }) => {
  const ok = a.ratio >= 0.999;
  const c = a.cycle;
  const area = a.kind === 'product' || a.kind === 'tailings' ? 'planta' : 'mina';
  const cal = sumCalendarHours(premises, area);
  const u = premises.umidadeNatural;
  const p = premises.perdaMaterial;
  const lines: [string, string, string][] = [
    ['Meta seca', `${t0(a.targetDryT)} t`, a.kind === 'rom' ? 'Consumo da planta (ou massa da frente)' : a.kind === 'product' ? `ROM × RM (${n1(processPct(premises).rm)}%)` : a.kind === 'tailings' ? `ROM × rejeito (${n1(processPct(premises).rej)}%)` : 'Meta de estéril'],
    [
      'Meta úmida (transportada)',
      `${t0(a.targetWetT)} t`,
      premises.moistureMode === 'base_umida' ? `seca ÷ (1 − ${n1(u)}%) × (1 + ${n1(p)}%)` : `seca × (1 + ${n1(u)}% umidade + ${n1(p)}% perda)`,
    ],
    ['Carga útil', `${n1(a.payloadT)} t`, a.payloadLimitedBy === 'volume' ? 'limitada pelo volume da caçamba × densidade' : 'capacidade do caminhão'],
    [
      'Ciclo',
      `${n2(c.totalMin)} min`,
      c.mode === 'informed'
        ? 'informado (cronometrado)'
        : `carga ${n1(c.loadMin)} + ida ${n1(c.travelLoadedMin)} + descarga ${n1(c.dumpMin)} + volta ${n1(c.travelEmptyMin)} + pesagens ${n1(c.weighMin)}${c.queueMin ? ` + fila ${n1(c.queueMin)}` : ''}${c.interferenceMin ? ` + interferências ${n1(c.interferenceMin)}` : ''}`,
    ],
    ['Viagens por hora efetiva', n2(60 / c.totalMin), '60 ÷ ciclo'],
    ['Produção por caminhão', `${n1(a.truckRateTph)} t/h`, 'viagens/h × carga útil'],
    ['Horas efetivas no mês', `${n1(a.hours.effective)} h`, `${t0(cal)} h de calendário (${area}) × DF ${n1(a.hours.df * 100)}% × UF ${n1(a.hours.uf * 100)}%`],
    ['Por caminhão no mês', `${t0(a.truckMonthT)} t`, 't/h × horas efetivas'],
    ['Caminhões necessários', `${n2(a.trucksNeededExact)} → ${a.trucksNeeded}`, 'meta úmida ÷ t/mês por caminhão, arredondado para cima'],
    [
      'Capacidade com a alocação',
      `${t0(a.capacityWetT)} t`,
      `${fmtTrucks(a.trucksAllocated)} caminhões × ${t0(a.truckMonthT)} t${a.extraCapacityWetT > 0 ? ` + ${t0(a.extraCapacityWetT)} t da frota extra` : ''}${a.limitedBy === 'carga' ? ' (limitada pela carga)' : ''}`,
    ],
  ];
  return (
    <div className="mt-5 border-t border-black/5 pt-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
        <p className="text-sm">
          <span className="text-black/50">Precisa de </span>
          <b className="font-mono">{a.trucksNeeded}</b>
          <span className="text-black/40"> ({n2(a.trucksNeededExact)})</span>
          <span className="text-black/50"> · tem </span>
          <b className="font-mono">{fmtTrucks(a.trucksAllocated)}</b>
        </p>
        {a.mix && (
          <p className="text-sm">
            <span className="text-black/50">Frota mista </span>
            {a.mix.map((m, i) => (
              <span key={m.classId}>
                {i > 0 && <span className="text-black/30"> + </span>}
                <b className="font-mono">{m.count}</b> <span className="text-black/60">{m.name}</span>
                <span className="text-black/40"> ({n1(m.payloadT)} t, ciclo {n1(m.cycleMin)} min, {t0(m.capacityWetT)} t/mês)</span>
              </span>
            ))}
          </p>
        )}
        {a.loading && (
          <p className="text-sm">
            <span className="text-black/50">Caçambadas </span>
            <b className="font-mono">{a.loading.passes}</b>
            <span className="text-black/40"> ({n1(a.loading.loadMin)} min de carga · {a.loading.name}{a.loading.source === 'local' ? ', do local' : ''})</span>
          </p>
        )}
        <p className="text-sm">
          <span className="text-black/50">Capacidade </span>
          <b className="font-mono">{t0(a.capacityWetT)} t</b>
          <span className="text-black/50"> de {t0(a.targetWetT)} t úmidas · </span>
          <b className={ok ? 'text-emerald-600' : 'text-red-600'}>{pc(a.ratio)} da meta</b>
        </p>
        <button type="button" onClick={onToggle} className="ml-auto text-sm font-medium text-emerald-700 hover:underline">
          {open ? 'Ocultar memória de cálculo' : 'Memória de cálculo'}
        </button>
      </div>
      {open && (
        <table className="mt-4 w-full text-sm">
          <tbody>
            {lines.map(([k, v, how]) => (
              <tr key={k} className="border-t border-black/5">
                <td className="py-1.5 pr-3 text-black/60">{k}</td>
                <td className="py-1.5 pr-3 text-right font-mono font-semibold whitespace-nowrap">{v}</td>
                <td className="py-1.5 text-xs text-black/50">{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default RouteManager;
