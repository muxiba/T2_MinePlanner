import React, { useMemo } from 'react';
import { Activity, AlertTriangle, Check, Download, Edit2, MapPin, Plus, PlusCircle, Scale, Shuffle, Trash2, Truck, Wand2 } from 'lucide-react';
import type { DetailedPremises, Route } from '../types';
import { adjustFleetToTarget, analyzeFleet, optimizeFleet, routeKind, routeRates, sumCalendarHours, KIND_LABELS, type RouteAnalysis } from '@/engine/fleet';
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
  const adjust = useMemo(() => adjustFleetToTarget(routes, premises), [routes, premises]);
  const f = analysis.fleet;
  const over = f.allocated + f.extraEquivalent > f.premise + 1e-6;
  const [adjustMsg, setAdjustMsg] = React.useState<string | null>(null);

  /** Ajusta toda a frota: cada rota com o inteiro que atende a meta; a sobra vai para a frota extra. */
  const applyAdjust = () => {
    setRoutes(adjust.routes);
    setPremises((prev) => ({ ...prev, extraAllocations: adjust.extraAllocations }));
    const parts = adjust.moves.length ? adjust.moves.map((m) => `${m.name}: ${m.from} → ${m.to}`).join(' · ') : 'as rotas já estavam ajustadas';
    setAdjustMsg(
      `${parts}. ${adjust.freeTrucks} caminhão(ões) ficam na frota extra.` +
        (adjust.shortfall > 0 ? ` Faltam ${adjust.shortfall} caminhão(ões) para todas as rotas baterem a meta.` : ''),
    );
  };

  const handleUpdateRoute = (id: string, updates: Partial<Route>) => {
    setAdjustMsg(null);
    setRoutes(routes.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };
  const handleDeleteRoute = (id: string) => setRoutes(routes.filter((r) => r.id !== id));

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
    if (kind === 'rom' || kind === 'waste') {
      const limit = kind === 'rom' ? premises.targetMonthlyROM : premises.targetMonthlyWasteRock;
      const others = routes.filter((r) => r.id !== route.id && r.active && routeKind(r) === kind).reduce((a, r) => a + (r.targetMass || 0), 0);
      if (others + value > limit) {
        const v = Math.max(0, limit - others);
        alert(`A soma das frentes não pode passar de ${limit.toLocaleString('pt-BR')} t. Valor ajustado para o saldo: ${v.toLocaleString('pt-BR')} t.`);
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
          <Stat label="Nas rotas" value={String(f.allocated)} tone={over ? 'bad' : undefined} />
          <Stat label="Sem rota (folga)" value={n1(f.spare)} tone={f.spare > 0.01 && !analysis.meetsTarget ? 'warn' : undefined} />
          <Stat label="Necessários" value={`${f.needed}`} sub={`${n2(f.neededExact)} sem arredondar`} />
          <Stat
            label="Chega à planta"
            value={`${t0(analysis.romDeliverableDryT)} t`}
            sub={`${pc(analysis.romTargetDryT ? analysis.romDeliverableDryT / analysis.romTargetDryT : 1)} da meta de ${t0(analysis.romTargetDryT)} t`}
            tone={analysis.meetsTarget ? 'ok' : 'bad'}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={applyAdjust} className="inline-flex items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
            <Scale size={15} /> Ajustar frota à meta
          </button>
          <span className="text-xs text-black/50">
            Cada rota recebe o número inteiro de caminhões que atende a sua meta (arredondado para cima); o que sobrar da frota de {f.premise} vai para a frota extra.
          </span>
        </div>
        {adjustMsg && <p className="mt-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{adjustMsg}</p>}

        {over && (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            As rotas usam {f.allocated} caminhões{f.extraEquivalent > 0 ? ` (+${n1(f.extraEquivalent)} em alocações por horas)` : ''}, mais que a frota de {f.premise} das premissas. Corrija a frota nas premissas ou redistribua.
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
                  <button onClick={() => handleUpdateRoute(route.id, { active: !route.active })} className={`rounded-xl p-2.5 ${route.active ? 'bg-emerald-50 text-emerald-500' : 'bg-black/5 text-black/40'}`} title={route.active ? 'Desativar' : 'Ativar'}>
                    <Activity size={18} />
                  </button>
                  <button onClick={applyAdjust} className="rounded-xl bg-black/5 p-2.5 text-black/50 hover:bg-emerald-50 hover:text-emerald-600" title="Ajustar toda a frota à meta (inteiro acima em cada rota, sobra para a frota extra)">
                    <Scale size={18} />
                  </button>
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
                    <input type="number" min={0} step={1} value={route.truckCount} onChange={(e) => handleUpdateRoute(route.id, { truckCount: Math.max(0, Math.round(Number(e.target.value) || 0)), isManualOverride: true })} className={inputCls} />
                  ) : (
                    <p className="font-mono text-lg font-bold">{route.truckCount}</p>
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
    ['Meta seca', `${t0(a.targetDryT)} t`, a.kind === 'rom' ? 'Consumo da planta (ou massa da frente)' : a.kind === 'product' ? `ROM × RM global (${n1(premises.rmGlobal)}%)` : a.kind === 'tailings' ? `ROM × rejeito (${n1(premises.rejeitoTotal)}%)` : 'Meta de estéril'],
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
        : `carga ${n1(c.loadMin)} + ida ${n1(c.travelLoadedMin)} + descarga ${n1(c.dumpMin)} + volta ${n1(c.travelEmptyMin)} + pesagens ${n1(c.weighMin)}${c.queueMin ? ` + fila ${n1(c.queueMin)}` : ''}`,
    ],
    ['Viagens por hora efetiva', n2(60 / c.totalMin), '60 ÷ ciclo'],
    ['Produção por caminhão', `${n1(a.truckRateTph)} t/h`, 'viagens/h × carga útil'],
    ['Horas efetivas no mês', `${n1(a.hours.effective)} h`, `${t0(cal)} h de calendário (${area}) × DF ${n1(a.hours.df * 100)}% × UF ${n1(a.hours.uf * 100)}%`],
    ['Por caminhão no mês', `${t0(a.truckMonthT)} t`, 't/h × horas efetivas'],
    ['Caminhões necessários', `${n2(a.trucksNeededExact)} → ${a.trucksNeeded}`, 'meta úmida ÷ t/mês por caminhão, arredondado para cima'],
    [
      'Capacidade com a alocação',
      `${t0(a.capacityWetT)} t`,
      `${a.trucksAllocated} caminhões × ${t0(a.truckMonthT)} t${a.extraCapacityWetT > 0 ? ` + ${t0(a.extraCapacityWetT)} t da frota extra` : ''}${a.limitedBy === 'carga' ? ' (limitada pela carga)' : ''}`,
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
          <b className="font-mono">{a.trucksAllocated}</b>
        </p>
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
