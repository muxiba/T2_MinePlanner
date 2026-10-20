import React, { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowLeftRight, Download, FileUp, Mountain, Pause, Play, Plus, Route as RouteIcon, Trash2 } from 'lucide-react';
import type { DetailedPremises } from '@/types';
import type { AggregateStats, Circuit, Receiving, Scenario, SimModel, SimRoute, TruckConfig } from '@/sim/types';
import { routeLength, routeProfile, readRouteDxf } from '@/sim/dxf';
import { defaultCircuit, defaultReceiving, emptyModel } from '@/sim/defaults';
import { limitsOf, payloadFor, travelTimes, type RunResult, type SweepPoint } from '@/sim/des';
import { DOT_KINDS, makeAnimator } from '@/sim/animation';
import type { Contours } from '@/sim/terrain';
import { combineDem, periodDem, type Dem } from '@/sim/dem';
import View3D from './View3D';
import { runInWorker } from '@/sim/client';
import { loadLocal, removeLocal, saveLocal } from '@/sim/storage';
import MapCanvas, { DOT_COLORS, LOADER_COLORS, type MapOverlays, type TerrainLayer } from './MapCanvas';
import AnimTables from './AnimTables';
import PlanView from './PlanView';
import FinanceView from './FinanceView';
import DecisionView from './DecisionView';
import { periodModelWithFleet, type PeriodResult } from '@/sim/plan';
import { REVENUE_REF_PER_T, SICRO_REF, sicroTruckCosts, withReferenceCosts } from '@/sim/references';
import { FLOW_LABELS, PERIOD_KINDS, flowDryTonnes, flowShares, periodMonths, periodText, wetFactor, PREMISES_CONFIG_ID, circuitPeriod, circuitTargets, flowWetTonnes, hoursBreakdown, linkOn, premisesLoaderTph, receivingLoaders, withPremises, type Flow, type PeriodKind } from '@/sim/link';
import { CycleBars, SweepChart } from './charts';
import { Btn, Card, Num, Progress, brl, inputCls, n1, pc, t0 } from './ui';

/**
 * Agrupa os circuitos pelo ponto final da rota (até 15 m = mesmo destino), preservando
 * nomes de destino editados pelo usuário.
 */
function regroupDestinations(m: SimModel): SimModel {
  const ends: { x: number; y: number; name: string }[] = [];
  const auto = /^Destino \d+$/;
  const circuits = m.circuits.map((c) => {
    if (!auto.test(c.destination)) return c;
    const r = m.routes.find((x) => x.id === c.routeId);
    if (!r) return c;
    const e = r.points[r.points.length - 1];
    let hit = ends.find((p) => Math.hypot(p.x - e.x, p.y - e.y) < 15);
    if (!hit) {
      hit = { x: e.x, y: e.y, name: `Destino ${ends.length + 1}` };
      ends.push(hit);
    }
    return { ...c, destination: hit.name };
  });
  const receiving = [...m.receiving];
  for (const c of circuits) if (!receiving.some((r) => r.destination === c.destination)) receiving.push(defaultReceiving(c.destination));
  return { ...m, circuits, receiving };
}

/* -------------------------------------------------------------------------- */
/* Tela                                                                        */
/* -------------------------------------------------------------------------- */

type Tab = 'modelo' | 'plano' | 'config' | 'financeiro' | 'resultados' | 'decisao' | 'animacao';
type MatrixCell = { configId: string; scenarioId: string; stats: AggregateStats };

interface Props {
  premises: DetailedPremises;
  setPremises: (p: DetailedPremises) => void;
  canEdit: boolean;
  storageKey: string;
}

const SimulationView: React.FC<Props> = ({ premises, setPremises, canEdit, storageKey }) => {
  const stored: SimModel = premises.simulation ?? emptyModel();
  // modelo efetivo: DF, UF, horas, velocidades, tempos e caminhão vêm das Premissas Fundamentais
  const model: SimModel = useMemo(() => {
    let m = withReferenceCosts(withPremises(stored, premises));
    // receita e custos fixos de referência aplicados uma vez nos planos que já tinham financeiro
    if (m.finance && !m.finance.refApplied) {
      m = { ...m, finance: { ...m.finance, refApplied: true, revenuePerT: m.finance.revenuePerT || REVENUE_REF_PER_T, revenueMaterial: m.finance.revenueMaterial || 'Produto', overheadPerYear: m.finance.overheadPerYear || 964_000 } };
    }
    return m;
  }, [stored, premises]);
  const setModel = (m: SimModel) => setPremises({ ...premises, simulation: m });
  const linked = linkOn(model);
  const LOCK = 'Vem das Premissas Fundamentais. Para editar aqui, desligue “Usar as Premissas Fundamentais” na aba Circuito.';
  const lockIf = (on: boolean) => (linked && on ? LOCK : undefined);
  const calc = useMemo(() => circuitTargets(model, premises), [model, premises]);
  const per = circuitPeriod(model, premises);
  const [tab, setTab] = useState<Tab>('modelo');

  // terreno (só neste navegador)
  const [terrain, setTerrain] = useState<TerrainLayer | null>(null);
  const [contours, setContours] = useState<Contours | null>(null);
  const [terrainBusy, setTerrainBusy] = useState<{ f: number; stage?: string } | null>(null);
  const [terrainInfo, setTerrainInfo] = useState<string | null>(null);
  const [dem, setDem] = useState<{ grid: Dem | null; contours: Dem | null }>({ grid: null, contours: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadLocal<{ terrain: TerrainLayer | null; contours: Contours | null; info: string | null; dem?: { grid: Dem | null; contours: Dem | null } }>(`${storageKey}:terrain`).then((v) => {
      if (!v) return;
      setTerrain(v.terrain);
      setContours(v.contours);
      setTerrainInfo(v.info);
      if (v.dem) setDem(v.dem);
    });
  }, [storageKey]);

  const importTerrain = async (file: File, mode: 'faces' | 'contours') => {
    setError(null);
    setTerrainBusy({ f: 0 });
    try {
      const res = await runInWorker<any>({ kind: 'terrain', file, mode }, (f, stage) => setTerrainBusy({ f, stage }));
      let t = terrain;
      let c = contours;
      let d = dem;
      let info: string;
      if (res.kind === 'grid') {
        t = { meta: res.meta, shade: res.shade };
        d = { ...d, grid: res.dem };
        info = `${file.name}: ${t0(res.faces)} triângulos → grade de ${res.meta.nx}×${res.meta.ny} células de ${n1(res.meta.cell)} m, cotas ${n1(res.meta.zmin)} a ${n1(res.meta.zmax)} m`;
        setTerrain(t);
      } else {
        c = res.contours as Contours;
        d = { ...d, contours: res.dem };
        info = `${file.name}: ${t0(c.lines.length)} curvas, cotas ${n1(c.zmin)} a ${n1(c.zmax)} m`;
        setContours(c);
      }
      setTerrainInfo(info);
      setDem(d);
      void saveLocal(`${storageKey}:terrain`, { terrain: t, contours: c, info, dem: d });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTerrainBusy(null);
    }
  };

  const importRoutes = async (files: FileList) => {
    setError(null);
    const routes = [...model.routes];
    const circuits = [...model.circuits];
    const receiving = [...model.receiving];
    for (const f of Array.from(files)) {
      const text = await f.text();
      const r = readRouteDxf(text, f.name);
      if (!r) {
        setError(`${f.name}: nenhuma polilinha encontrada.`);
        continue;
      }
      const name = f.name.replace(/\.dxf$/i, '').replace(/^[0-9a-f]{8}-/i, '');
      const route: SimRoute = { id: `r${Date.now().toString(36)}${routes.length}`, name, points: r.points };
      routes.push(route);
      // destino: rotas que terminam no mesmo ponto (até 15 m) compartilham descarga
      const end = route.points[route.points.length - 1];
      const same = circuits.find((c) => {
        const rr = routes.find((x) => x.id === c.routeId);
        const e = rr?.points[rr.points.length - 1];
        return e && Math.hypot(e.x - end.x, e.y - end.y) < 15;
      });
      const destination = same?.destination ?? `Destino ${new Set(circuits.map((c) => c.destination)).size + 1}`;
      circuits.push({ ...defaultCircuit(route, circuits.length), destination });
      if (!receiving.some((x) => x.destination === destination)) receiving.push(defaultReceiving(destination));
    }
    setModel(regroupDestinations({ ...model, routes, circuits, receiving }));
  };

  const flipRoute = (id: string) => {
    const routes = model.routes.map((r) => (r.id === id ? { ...r, points: [...r.points].reverse() } : r));
    setModel(regroupDestinations({ ...model, routes }));
  };
  const removeRoute = (id: string) =>
    setModel({ ...model, routes: model.routes.filter((r) => r.id !== id), circuits: model.circuits.filter((c) => c.routeId !== id) });
  const setCircuit = (id: string, patch: Partial<Circuit>) =>
    setModel({ ...model, circuits: model.circuits.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const setReceiving = (dest: string, patch: Partial<Receiving>) => {
    const exists = model.receiving.some((r) => r.destination === dest);
    const list = exists ? model.receiving : [...model.receiving, defaultReceiving(dest)];
    setModel({ ...model, receiving: list.map((r) => (r.destination === dest ? { ...r, ...patch } : r)) });
  };
  const setConfig = (id: string, patch: Partial<TruckConfig>) =>
    setModel({ ...model, configs: model.configs.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const setScenario = (id: string, patch: Partial<Scenario>) =>
    setModel({ ...model, scenarios: model.scenarios.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const destinations = [...new Set(model.circuits.map((c) => c.destination))];
  const receivingView = destinations.map((d) => model.receiving.find((r) => r.destination === d) ?? defaultReceiving(d));

  /* ----------------------------- resultados ------------------------------ */
  const [matrix, setMatrix] = useState<MatrixCell[] | null>(null);
  const [matrixBusy, setMatrixBusy] = useState<number | null>(null);
  const [sel, setSel] = useState<{ configId: string; scenarioId: string }>({ configId: model.configs[0]?.id ?? 'A', scenarioId: model.scenarios[0]?.id ?? 's1' });
  const [sweep, setSweep] = useState<{ points: SweepPoint[]; minFleet: number | null; saturation: number; scope: 'sistema' | 'circuito' } | null>(null);
  const [sweepBusy, setSweepBusy] = useState<number | null>(null);
  const [sweepCircuit, setSweepCircuit] = useState<string>('');

  const ready = model.routes.length > 0 && model.circuits.length > 0;

  const runMatrix = async () => {
    setError(null);
    setMatrixBusy(0);
    try {
      const res = await runInWorker<MatrixCell[]>(
        { kind: 'matrix', model, configIds: model.configs.map((c) => c.id), scenarioIds: model.scenarios.map((s) => s.id) },
        (f) => setMatrixBusy(f),
      );
      setMatrix(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMatrixBusy(null);
    }
  };

  const runSweep = async () => {
    setError(null);
    setSweepBusy(0);
    try {
      const res = await runInWorker<{ points: SweepPoint[]; minFleet: number | null; saturation: number; scope: 'sistema' | 'circuito' }>(
        { kind: 'sweep', model, configId: sel.configId, scenarioId: sel.scenarioId, circuitId: sweepCircuit || model.circuits[0].id, maxTrucks: 30 },
        (f) => setSweepBusy(f),
      );
      setSweep(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSweepBusy(null);
    }
  };

  const exportCsv = () => {
    if (!matrix) return;
    const head = ['Configuração', 'Cenário', 't/dia (média)', 't/dia (mín. IC95)', 't/dia (máx. IC95)', '% da meta', 'Ciclo (min)', 'Fila carga (min)', 'Fila descarga (min)', 'Ocupação carga', 'Ocupação descarga', 'Ocupação carregadeira', 'Falta na fábrica (h)', 'R$/t'];
    const dec = (n: number, d = 1) => n.toFixed(d).replace('.', ',');
    const rows = matrix.map((c) => {
      const s = c.stats;
      return [
        model.configs.find((x) => x.id === c.configId)?.name ?? c.configId,
        model.scenarios.find((x) => x.id === c.scenarioId)?.name ?? c.scenarioId,
        dec(s.tpd.mean, 0),
        dec(s.tpd.lo, 0),
        dec(s.tpd.hi, 0),
        model.targetTpd > 0 ? dec((s.tpd.mean / model.targetTpd) * 100, 0) : '',
        dec(s.cycleMin.mean),
        dec(s.queueLoadMin.mean),
        dec(s.queueDumpMin.mean),
        dec(s.loaderUtil.mean * 100, 0),
        dec(s.dumpUtil.mean * 100, 0),
        dec(s.stackerUtil.mean * 100, 0),
        dec(s.plantStockoutH.mean),
        dec(s.costPerT.mean, 2),
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    });
    const csv = '﻿' + [head, ...rows].map((r) => r.join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulacao_cenarios_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ------------------------------- animação ------------------------------ */
  const [periodResults, setPeriodResultsState] = useState<PeriodResult[] | null>(null);
  const setPeriodResults = (r: PeriodResult[] | null) => {
    setPeriodResultsState(r);
    void (r ? saveLocal(`${storageKey}:periods`, r) : removeLocal(`${storageKey}:periods`));
  };
  useEffect(() => {
    void loadLocal<PeriodResult[]>(`${storageKey}:periods`).then((v) => v && setPeriodResultsState(v));
  }, [storageKey]);
  const [animPeriod, setAnimPeriod] = useState(0); // 0 = circuito da aba Circuito
  const [animRoutes, setAnimRoutes] = useState<SimRoute[] | null>(null);
  const [animOverlays, setAnimOverlays] = useState<MapOverlays | undefined>(undefined);
  const [anim, setAnim] = useState<RunResult | null>(null);
  const [view3d, setView3d] = useState(false);
  const baseDem = useMemo(() => combineDem(dem.grid, dem.contours), [dem]);
  const animDem = useMemo(() => (baseDem && animPeriod > 0 ? periodDem(baseDem, model.plan, animPeriod) : baseDem), [baseDem, animPeriod, model.plan]);
  const [animBusy, setAnimBusy] = useState(false);
  const [animT, setAnimT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(120);
  const animator = useMemo(() => (anim ? makeAnimator(anim.trace, anim.geometry, anim.loaderTrace) : null), [anim]);
  const [animInfo, setAnimInfo] = useState<{ name: string; material: string }[]>([]);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!playing || !animator) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setAnimT((t) => {
        const nt = t + (dt * speed) / 60; // speed = segundos simulados por segundo real
        if (nt >= animator.end) {
          setPlaying(false);
          return animator.end;
        }
        return nt;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, animator, speed]);

  const runAnim = async () => {
    setError(null);
    setAnimBusy(true);
    setPlaying(false);
    try {
      let m = model;
      let ov: MapOverlays | undefined;
      if (animPeriod > 0 && model.plan) {
        const pr = periodResults?.find((r) => r.period === animPeriod && r.configId === sel.configId) ?? null;
        m = periodModelWithFleet(model, model.plan, animPeriod, pr).model;
        m = { ...m, scenarios: m.scenarios.map((s) => ({ ...s, hoursPerDay: model.plan!.hoursPerDay || s.hoursPerDay })) };
        if (!m.circuits.length) throw new Error('Este período não tem movimentações.');
        ov = {
          polygons: [
            ...model.plan.fronts.filter((f) => f.period === animPeriod).map((f) => ({ ring: f.ring, fill: '#2a78d622', stroke: '#2a78d6', label: f.front })),
            ...model.plan.solids.filter((x) => x.period === animPeriod).map((x) => ({ ring: x.hull, fill: '#eb683422', stroke: '#eb6834', label: x.name, dashed: true })),
          ],
        };
      }
      const res = await runInWorker<RunResult>({ kind: 'trace', model: m, configId: sel.configId, scenarioId: sel.scenarioId, hours: 24 });
      setAnimRoutes(animPeriod > 0 ? m.routes : null);
      // material de cada circuito animado (para a tabela de produção)
      setAnimInfo(
        res.geometry.map((g) => {
          const c = m.circuits.find((x) => x.id === g.circuitId);
          if (animPeriod > 0 && model.plan) {
            const mv = model.plan.movements.find((x) => `pm-${x.id}` === g.circuitId);
            return { name: c?.name ?? g.circuitId, material: mv?.material ?? 'Material' };
          }
          const flow = c ? calc.find((x) => x.circuitId === c.id)?.flow : undefined;
          return { name: c?.name ?? g.circuitId, material: flow ? FLOW_LABELS[flow] : 'Material' };
        }),
      );
      setAnimOverlays(ov);
      setAnim(res);
      setAnimT(model.warmupH * 60);
      setPlaying(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAnimBusy(false);
    }
  };

  const frame = animator ? animator.frame(animT) : null;
  const clock = `${String(Math.floor(animT / 60) % 24).padStart(2, '0')}:${String(Math.floor(animT % 60)).padStart(2, '0')}`;

  /* -------------------------------- render ------------------------------- */
  const tabs: { id: Tab; label: string }[] = [
    { id: 'modelo', label: 'Circuito' },
    { id: 'plano', label: 'Plano de lavra' },
    { id: 'config', label: 'Configurações e cenários' },
    { id: 'financeiro', label: 'Financeiro' },
    { id: 'resultados', label: 'Resultados do circuito' },
    { id: 'decisao', label: 'Resultados e decisão' },
    { id: 'animacao', label: 'Animação' },
  ];

  const selector = (
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-black/55">
        Configuração
        <select className={clsx(inputCls, 'mt-1 w-56')} value={sel.configId} onChange={(e) => setSel({ ...sel, configId: e.target.value })}>
          {model.configs.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-black/55">
        Cenário
        <select className={clsx(inputCls, 'mt-1 w-56')} value={sel.scenarioId} onChange={(e) => setSel({ ...sel, scenarioId: e.target.value })}>
          {model.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl bg-black/[0.04] p-1" role="tablist" aria-label="Simulação">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx('rounded-lg px-4 py-2 text-sm transition-colors', tab === t.id ? 'bg-white font-semibold shadow-sm' : 'text-black/55 hover:text-black')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}

      {/* ============================== CIRCUITO ============================== */}
      {tab === 'modelo' && (
        <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
          <MapCanvas terrain={terrain} contours={contours} routes={model.routes} />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Rotas" description="Polilinhas 3D do eixo das vias (DXF). Cada rota vira um circuito de transporte.">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
                <RouteIcon size={16} /> Importar rotas (DXF)
                <input type="file" accept=".dxf" multiple className="sr-only" onChange={(e) => e.target.files && void importRoutes(e.target.files)} />
              </label>
              <ul className="mt-4 divide-y divide-black/5">
                {model.routes.map((r) => {
                  const prof = routeProfile(r.points, 20);
                  const up = prof.reduce((a, s) => a + Math.max(0, (s.grade / 100) * s.h), 0);
                  const down = prof.reduce((a, s) => a + Math.max(0, (-s.grade / 100) * s.h), 0);
                  const maxUp = Math.max(0, ...prof.map((s) => s.grade));
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-black/50 tabular-nums">
                          {t0(routeLength(r.points))} m · sobe {n1(up)} m, desce {n1(down)} m · rampa máx. carregado {n1(maxUp)}% · cota {n1(r.points[0].z)} → {n1(r.points[r.points.length - 1].z)} m
                        </p>
                      </div>
                      <button type="button" onClick={() => flipRoute(r.id)} className="rounded-lg p-2 text-black/50 hover:bg-black/5" title="Inverter sentido (carga ↔ descarga)" aria-label={`Inverter sentido de ${r.name}`}>
                        <ArrowLeftRight size={16} />
                      </button>
                      <button type="button" onClick={() => removeRoute(r.id)} className="rounded-lg p-2 text-black/40 hover:bg-red-50 hover:text-red-600" aria-label={`Remover ${r.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {model.routes.length > 0 && <p className="mt-2 text-xs text-black/45">O primeiro ponto é a carga (ponto escuro no mapa). Use ⇄ se a rota estiver invertida.</p>}
            </Card>

            <Card title="Topografia (opcional)" description="Fica guardada só neste navegador. Arquivos grandes são lidos aqui mesmo, sem envio.">
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
                  <Mountain size={16} /> Superfície 3DFACE
                  <input type="file" accept=".dxf" className="sr-only" onChange={(e) => e.target.files?.[0] && void importTerrain(e.target.files[0], 'faces')} />
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
                  <FileUp size={16} /> Curvas de nível
                  <input type="file" accept=".dxf" className="sr-only" onChange={(e) => e.target.files?.[0] && void importTerrain(e.target.files[0], 'contours')} />
                </label>
                {(terrain || contours) && (
                  <button
                    type="button"
                    className="text-sm text-black/50 underline"
                    onClick={() => {
                      setTerrain(null);
                      setContours(null);
                      setTerrainInfo(null);
                      setDem({ grid: null, contours: null });
                      void removeLocal(`${storageKey}:terrain`);
                    }}
                  >
                    Remover
                  </button>
                )}
              </div>
              {terrainBusy && <div className="mt-3"><Progress value={terrainBusy.f} label={terrainBusy.stage} /></div>}
              {terrainInfo && <p className="mt-3 text-xs text-black/55">{terrainInfo}</p>}
            </Card>
          </div>

          {/* ---------------------- período e premissas ---------------------- */}
          <Card
            title="Período simulado e premissas"
            description="Informe a duração (quantidade e unidade). Com “Usar as Premissas Fundamentais” ligado, o consumo mensal da planta é multiplicado ou dividido pelo período e o resto vem das premissas: DF, UF, horas por dia, velocidades, tempos de carga, basculamento e pesagem, fila e caminhão."
            actions={
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={linked} onChange={(e) => setModel({ ...model, link: { speedMode: model.link?.speedMode ?? 'rampa', enabled: e.target.checked } })} />
                Usar as Premissas Fundamentais
              </label>
            }
          >
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div className="grid grid-cols-2 gap-3">
                <Num
                  label="Quantidade"
                  step={1}
                  value={per.kind === 'dias' ? model.period?.days ?? per.qty : per.qty}
                  onChange={(v) => {
                    const q = Math.max(1, Math.round(v));
                    setModel({ ...model, period: { ...model.period, kind: per.kind, qty: q, days: per.kind === 'dias' ? q : undefined, romT: undefined } });
                  }}
                />
                <div>
                  <label className="mb-1 block text-xs text-black/55">Unidade</label>
                  <select
                    className={inputCls}
                    value={per.kind}
                    onChange={(e) => {
                      const kind = e.target.value as PeriodKind;
                      setModel({ ...model, period: { kind, qty: per.qty, days: kind === 'dias' ? Math.max(1, per.qty) : undefined, romT: undefined } });
                    }}
                  >
                    {PERIOD_KINDS.map((k) => (
                      <option key={k.id} value={k.id}>{k.label}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <Num
                    label={`Meta de ROM em ${periodText(per.kind, per.qty, model.period?.days)}`}
                    suffix="t seca"
                    step={1000}
                    value={Math.round(per.romT)}
                    onChange={(v) => setModel({ ...model, period: { ...model.period, kind: per.kind, qty: per.qty, romT: Math.max(0, v) } })}
                  />
                  <p className="mt-1 text-[11px] text-black/45">
                    {per.suggested
                      ? `Pelas premissas: ${t0(premises.targetMonthlyROM)} t/mês × ${n1(periodMonths(per.kind, model.period?.days, per.qty))} meses = ${t0(per.romT)} t.`
                      : 'Meta informada. '}
                    {!per.suggested && (
                      <button type="button" className="text-emerald-700 hover:underline" onClick={() => setModel({ ...model, period: { kind: per.kind, qty: per.qty, days: model.period?.days } })}>usar a das premissas</button>
                    )}
                  </p>
                </div>
                {linked && (
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs text-black/55">Velocidade nas rotas</label>
                    <select className={inputCls} value={model.link?.speedMode ?? 'rampa'} onChange={(e) => setModel({ ...model, link: { enabled: true, speedMode: e.target.value as 'rampa' | 'constante' } })}>
                      <option value="rampa">Pela rampa de cada trecho, calibrada nas velocidades das premissas</option>
                      <option value="constante">Velocidade média das premissas em todo o trajeto (igual ao Dimensionamento)</option>
                    </select>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {(() => {
                  const d = flowDryTonnes(premises, per.romT);
                  const k = wetFactor(premises);
                  const sh = flowShares(premises);
                  const sc = model.scenarios[0];
                  const h = hoursBreakdown(per.calendarDays, per.workDays, sc?.hoursPerDay ?? 24, sc?.truckDf ?? 0, sc?.efficiency ?? 0);
                  const rows: [string, number, string][] = [['ROM (alimenta a planta)', d.rom, 'meta do período']];
                  if (premises.processType !== 'seco') {
                    rows.push(['Produto', d.produto, `ROM × RM global ${n1(sh.rm * 100)}%`]);
                    rows.push(['Rejeito filtrado', d.rejeito, `ROM × rejeito total ${n1(sh.rej * 100)}%`]);
                  } else rows.push(['Produto (processo a seco)', d.produto, 'ROM × 100%, sem rejeito']);
                  if (d.esteril > 0) rows.push(['Estéril', d.esteril, `ROM × REM ${n1(sh.rem)} (premissas)`]);
                  return (
                    <>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-black/10 text-left text-xs text-black/45">
                            <th className="py-1 font-medium">Fluxo no período</th>
                            <th className="py-1 text-right font-medium">t seca</th>
                            <th className="py-1 text-right font-medium">t úmida transportada</th>
                            <th className="py-1 pl-3 font-medium">Como</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(([name, dry, how]) => (
                            <tr key={name} className="border-b border-black/5">
                              <td className="py-1">{name}</td>
                              <td className="py-1 text-right font-medium tabular-nums">{t0(dry)}</td>
                              <td className="py-1 text-right tabular-nums">{t0(dry * k)}</td>
                              <td className="py-1 pl-3 text-xs text-black/50">{how}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[11px] text-black/50">
                        Úmida = seca × {k.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ({n1(premises.umidadeNatural)}% de umidade + {n1(premises.perdaMaterial)}% de perda, das premissas): é o que o caminhão carrega, por isso é maior que a meta seca.
                        {' '}{n1(per.calendarDays)} dias corridos, {n1(per.workDays)} trabalhados · {t0(h.productive)} h produtivas por caminhão de {t0(h.calendar)} h.
                      </p>
                    </>
                  );
                })()}
                {linked && (
                  <p className="rounded-lg bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
                    Das premissas: DF {n1(premises.dfMina)}% · UF {n1(premises.ufMina)}% · {n1(premises.contractedHoursMina)} h/dia · carregado {n1(premises.velocidadeCheio)} km/h · vazio {n1(premises.velocidadeVazio)} km/h · carga {n1(premises.loadingTime)} min · basculamento {n1(premises.dumpingTime)} min · pesagem {n1((premises.weighingTimeLoaded || 0) + (premises.weighingTimeEmpty || 0))} min · fila {n1(premises.queueMin ?? 0)} min · caminhão {n1(premises.truckCapacity)} t{premises.truckVolumeM3 ? ` / ${n1(premises.truckVolumeM3)} m³` : ''} · processo {premises.processType === 'seco' ? 'a seco' : 'a úmido'}{premises.hasWasteRock ? ', com estéril' : ', sem estéril'}.
                  </p>
                )}
              </div>
            </div>
          </Card>

          {model.circuits.length > 0 && (
            <Card title="Circuitos" description="Carga, balança e descarga de cada rota. Circuitos com o mesmo destino dividem a descarga e o pulmão. A meta de cada circuito sai do fluxo e da meta de ROM do período; digite outra meta (t seca) para mudar só aquele circuito.">
              <div className="mb-5 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-left text-xs text-black/45">
                      <th className="py-1.5 pr-2 font-medium">Circuito</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Meta (t seca)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Transportado (t úmida)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Necessária (t/h)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Carga (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Ida (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Basc. (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Volta (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Pesagem (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Fila (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Ciclo (min)</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Por caminhão (t/h)</th>
                      <th className="py-1.5 text-right font-medium">Caminhões (un.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calc.map((x, i) => {
                      const c = model.circuits[i];
                      return (
                        <tr key={x.circuitId} className="border-b border-black/5">
                          <td className="py-1.5 pr-2">
                            <span className="font-medium">{c.name}</span>
                            <span className="block text-[11px] text-black/45">
                              {FLOW_LABELS[x.flow]}
                              {x.flow !== 'outro' && x.sharePct < 0.999 ? ` · ${Math.round(x.sharePct * 100)}% do fluxo` : ''}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            <input
                              type="number"
                              step={1000}
                              className={clsx(inputCls, 'w-28 text-right', !x.overridden && x.flow !== 'outro' && 'text-black/55')}
                              value={Math.round(x.tonnesDry)}
                              aria-label={`Meta de ${c.name} (t seca)`}
                              onChange={(e) => {
                                const v = Math.max(0, Number(e.target.value) || 0);
                                setCircuit(c.id, x.flow === 'outro' ? { tonnesManual: v } : { tonnesDryOverride: v });
                              }}
                            />
                            {x.overridden && (
                              <button type="button" className="block w-full text-right text-[11px] text-emerald-700 hover:underline" onClick={() => setCircuit(c.id, { tonnesDryOverride: undefined })}>
                                usar a do fluxo
                              </button>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{t0(x.tonnes)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.needTph)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.loadMin)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.loadedMin)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.dumpMin)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.emptyMin)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.weighMin)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.queueMin)}</td>
                          <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{n1(x.cycleMin)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{n1(x.perTruckTph)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            <b>{x.trucks}</b> <span className="text-black/45">({x.trucksExact.toLocaleString('pt-BR', { maximumFractionDigits: 2 })})</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {(() => {
                      const romDry = calc.filter((x) => x.flow === 'rom').reduce((a, x) => a + x.tonnesDry, 0);
                      const ok = Math.abs(romDry - per.romT) < 1;
                      return (
                        <tr className="text-xs">
                          <td className="py-1.5 pr-2 font-semibold">Total ROM</td>
                          <td className={clsx('py-1.5 pr-2 text-right font-semibold tabular-nums', ok ? 'text-emerald-700' : 'text-amber-700')}>{t0(romDry)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{t0(romDry * wetFactor(premises))}</td>
                          <td colSpan={10} className="py-1.5 pl-2 text-black/50">
                            {ok ? 'A soma dos circuitos de ROM é igual à meta de ROM do período.' : `A soma dos circuitos de ROM (${t0(romDry)} t) difere da meta do período (${t0(per.romT)} t): confira as metas digitadas.`}
                          </td>
                        </tr>
                      );
                    })()}
                  </tfoot>
                </table>
                <p className="mt-1.5 text-[11px] text-black/45">
                  Necessária = t úmida ÷ horas produtivas (dias trabalhados × horas/dia × DF × UF). Ciclo = carga + ida + basculamento + volta + pesagem + fila. Por caminhão = carga útil × 60 ÷ ciclo. Caminhões = necessária ÷ por caminhão, arredondado para cima. A simulação depois mede as filas e esperas reais com esses caminhões.
                </p>
              </div>
              <div className="space-y-5">
                {model.circuits.map((c, i) => {
                  const x = calc[i];
                  const flow: Flow = c.flow ?? x?.flow ?? 'rom';
                  const sameFlow = model.circuits.filter((o) => (o.flow ?? calc[model.circuits.indexOf(o)]?.flow) === flow).length;
                  return (
                    <div key={c.id} className="rounded-xl border border-black/[0.06] p-4">
                      <p className="mb-3 font-medium">{c.name}</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                        <div>
                          <label className="mb-1 block text-xs text-black/55">Fluxo</label>
                          <select className={inputCls} value={flow} onChange={(e) => setCircuit(c.id, { flow: e.target.value as Flow })}>
                            {(Object.keys(FLOW_LABELS) as Flow[]).map((k) => (
                              <option key={k} value={k}>{FLOW_LABELS[k]}</option>
                            ))}
                          </select>
                        </div>
                        {flow === 'outro' && <Num label="t seca no período" step={1000} value={c.tonnesManual ?? 0} onChange={(v) => setCircuit(c.id, { tonnesManual: Math.max(0, v) })} />}
                        {sameFlow > 1 && flow !== 'outro' && (
                          <Num
                            label="Peso na divisão do fluxo"
                            step={0.5}
                            value={c.share ?? 1}
                            onChange={(v) => setCircuit(c.id, { share: Math.max(0, v), tonnesDryOverride: undefined })}
                            help={`Vários circuitos levam o mesmo fluxo: a meta do fluxo é repartida pelos pesos (1 e 1 = metade para cada; 3 e 1 = 75% e 25%). Este fica com ${Math.round((x?.sharePct ?? 0) * 100)}%.`}
                          />
                        )}
                        <div>
                          <Num label="Caminhões" value={c.trucks} onChange={(v) => setCircuit(c.id, { trucks: Math.max(0, Math.round(v)), autoTrucks: false })} />
                          <p className="mt-0.5 text-[11px] text-black/45">
                            {c.autoTrucks === false ? (
                              <button type="button" className="text-emerald-700 hover:underline" onClick={() => setCircuit(c.id, { autoTrucks: true })}>usar o calculado ({x?.trucks ?? '—'})</button>
                            ) : (
                              'calculado pela meta'
                            )}
                          </p>
                        </div>
                        <Num label="Postos de carga" value={c.loaders} onChange={(v) => setCircuit(c.id, { loaders: Math.max(1, Math.round(v)) })} />
                        <Num label="Taxa horária da carga" suffix="t/h" value={Math.round(c.loaderTph)} onChange={(v) => setCircuit(c.id, { loaderTph: v })} step={10} locked={linked ? `Capacidade do caminhão (${premises.truckCapacity} t) ÷ tempo de carga (${premises.loadingTime} min) × 60 = ${t0(premisesLoaderTph(premises))} t/h` : undefined} />
                        <Num label="Posicionamento" suffix="min" step={0.1} value={c.loadSpotMin} onChange={(v) => setCircuit(c.id, { loadSpotMin: v })} locked={linked ? 'Incluído no tempo de carga das premissas' : undefined} />
                        <Num label="DF da carga" suffix="%" value={c.loaderDf} onChange={(v) => setCircuit(c.id, { loaderDf: v })} locked={lockIf(true)} />
                        <Num label="Densidade solta" suffix="t/m³" step={0.05} value={c.density} onChange={(v) => setCircuit(c.id, { density: v })} locked={lockIf(true)} />
                        {linked ? (
                          <Num label="Pesagem (balança)" suffix="min" value={c.weighing ? c.weighMin : 0} onChange={() => {}} locked={LOCK} />
                        ) : (
                          <>
                            <div>
                              <label className="mb-1 block text-xs text-black/55">Balança</label>
                              <select className={inputCls} value={c.weighing ? 'sim' : 'nao'} onChange={(e) => setCircuit(c.id, { weighing: e.target.value === 'sim' })}>
                                <option value="sim">Sim</option>
                                <option value="nao">Não</option>
                              </select>
                            </div>
                            {c.weighing && <Num label="Pesagem" suffix="min" step={0.1} value={c.weighMin} onChange={(v) => setCircuit(c.id, { weighMin: v })} />}
                          </>
                        )}
                        <Num label="Pontos de descarga" value={c.dumpStations} onChange={(v) => setCircuit(c.id, { dumpStations: Math.max(1, Math.round(v)) })} />
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-black/55">Destino</label>
                          <input className={inputCls} value={c.destination} onChange={(e) => setCircuit(c.id, { destination: e.target.value })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {destinations.length > 0 && (
            <Card title="Recebimento" description="Pulmão (moega ou pilha) retomado pela carregadeira. Pulmão 0 = descarga direta, limitada pela carregadeira. A taxa vem da classe da carregadeira (caçamba × enchimento 90% × densidade × ciclos por hora). Consumo da fábrica opcional.">
              <div className="space-y-4">
                {receivingView.map((r) => (
                    <div key={r.destination}>
                      <p className="mb-2 text-sm font-medium">{r.destination}</p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <Num label="Pulmão" suffix="t" value={r.bufferT} onChange={(v) => setReceiving(r.destination, { bufferT: v })} step={10} />
                        <div>
                          <label className="mb-1 block text-xs text-black/55">Carregadeira</label>
                          <select className={inputCls} value={r.loaderId ?? 'pa-35'} onChange={(e) => setReceiving(r.destination, { loaderId: e.target.value, manualTph: false })}>
                            {receivingLoaders(premises).map((l) => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <Num label="Carregadeira" suffix="t/h" value={r.stackerTph} onChange={(v) => setReceiving(r.destination, { stackerTph: v, manualTph: true })} step={10} locked={linked && !r.manualTph ? 'Calculada pela classe da carregadeira' : undefined} />
                          {linked && (
                            <button type="button" className="mt-0.5 text-[11px] text-emerald-700 hover:underline" onClick={() => setReceiving(r.destination, { manualTph: !r.manualTph })}>
                              {r.manualTph ? 'usar a calculada' : 'informar outra taxa'}
                            </button>
                          )}
                        </div>
                        <Num label="DF carregadeira" suffix="%" value={r.stackerDf} onChange={(v) => setReceiving(r.destination, { stackerDf: v })} locked={linked && !r.manualTph ? 'DF da planta, nas Premissas Fundamentais' : undefined} />
                        <Num label="Consumo da fábrica" suffix="t/h" value={r.plantTph} onChange={(v) => setReceiving(r.destination, { plantTph: v })} step={10} />
                        <Num label="Estoque inicial" suffix="t" value={r.plantStockInitialT} onChange={(v) => setReceiving(r.destination, { plantStockInitialT: v })} step={100} />
                        <Num label="Estoque máximo" suffix="t" value={r.plantStockMaxT} onChange={(v) => setReceiving(r.destination, { plantStockMaxT: v })} step={100} />
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          )}

          <Card title="Parâmetros gerais">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Num label="Meta de transporte" suffix="t/dia" value={model.targetTpd} onChange={(v) => setModel({ ...model, targetTpd: v })} step={100} locked={linked ? 'Soma das metas dos circuitos no período ÷ dias trabalhados' : undefined} />
              <Num label="Limite carregado" suffix="km/h" value={limitsOf(model).loaded} onChange={(v) => setModel({ ...model, speedLimitLoadedKmh: v })} help="Velocidade máxima permitida na via com o caminhão cheio, mesmo em descida ou no plano." />
              <Num label="Limite vazio" suffix="km/h" value={limitsOf(model).empty} onChange={(v) => setModel({ ...model, speedLimitEmptyKmh: v })} help="Velocidade máxima permitida na volta, vazio." />
              <Num label="Resistência ao rolamento" suffix="%" step={0.5} value={model.rollingResistance} onChange={(v) => setModel({ ...model, rollingResistance: v })} help="Somada à rampa para achar a velocidade (via de terra ≈ 2–4%; asfalto ≈ 1–2%)." />
              <Num label="Reparo médio do caminhão" suffix="h" step={0.5} value={model.truckMttrH} onChange={(v) => setModel({ ...model, truckMttrH: v })} help="Duração média de cada quebra. Com a DF, define quantas quebras acontecem." />
              <Num label="Repetições por cenário" value={model.replications} onChange={(v) => setModel({ ...model, replications: Math.max(1, Math.min(30, Math.round(v))) })} help="Quantas vezes cada cenário é simulado com sorteios diferentes (quebras, filas, tempos). Mais repetições = média mais confiável e intervalo de 95% mais estreito." />
              <Num label="Aquecimento descartado" suffix="h" step={0.5} value={model.warmupH} onChange={(v) => setModel({ ...model, warmupH: v })} help="Horas iniciais fora das estatísticas: no começo todos os caminhões saem juntos da carga, o que não representa a operação normal." />
            </div>
          </Card>
        </fieldset>
      )}

      {/* ============================ PLANO DE LAVRA ========================== */}
      {tab === 'plano' && (
        <PlanView
          dem={baseDem}
          model={model}
          setModel={setModel}
          canEdit={canEdit}
          terrain={terrain}
          contours={contours}
          results={periodResults}
          setResults={setPeriodResults}
          onError={setError}
          premises={premises}
        />
      )}

      {tab === 'financeiro' && <FinanceView model={model} setModel={setModel} canEdit={canEdit} />}
      {tab === 'decisao' && <DecisionView model={model} results={periodResults} setResults={setPeriodResults} onError={setError} />}

      {/* ===================== CONFIGURAÇÕES E CENÁRIOS ====================== */}
      {tab === 'config' && (
        <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
          <Card
            title="Configurações de transporte"
            description="Os caminhões ou implementos comparados. Tempos de ciclo de cada rota calculados pela tabela de velocidade × rampa."
            actions={
              <Btn
                tone="light"
                onClick={() => {
                  const base = model.configs[model.configs.length - 1];
                  const id = String.fromCharCode(65 + model.configs.length);
                  setModel({ ...model, configs: [...model.configs, { ...structuredClone(base), id, name: `${id} – Nova configuração` }] });
                }}
              >
                <Plus size={15} /> Adicionar
              </Btn>
            }
          >
            <div className="space-y-5">
              {model.configs.map((c) => (
                <div key={c.id} className="rounded-xl border border-black/[0.06] p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <input className={clsx(inputCls, 'max-w-md font-medium')} value={c.name} onChange={(e) => setConfig(c.id, { name: e.target.value })} aria-label="Nome da configuração" disabled={linked && c.id === PREMISES_CONFIG_ID} />
                    {linked && c.id === PREMISES_CONFIG_ID && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">das Premissas Fundamentais · velocidade {model.link?.speedMode === 'constante' ? 'média constante' : 'por rampa, calibrada nas premissas'}</span>}
                    {model.configs.length > 1 && !(linked && c.id === PREMISES_CONFIG_ID) && (
                      <button type="button" className="rounded-lg p-2 text-black/40 hover:bg-red-50 hover:text-red-600" onClick={() => setModel({ ...model, configs: model.configs.filter((x) => x.id !== c.id) })} aria-label={`Remover ${c.name}`}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <Num label="Carga útil" suffix="t" step={0.5} value={c.payloadT} onChange={(v) => setConfig(c.id, { payloadT: v })} locked={lockIf(c.id === PREMISES_CONFIG_ID)} />
                    <Num label="Volume" suffix="m³" step={0.5} value={c.volumeM3 ?? 0} onChange={(v) => setConfig(c.id, { volumeM3: v || undefined })} locked={lockIf(c.id === PREMISES_CONFIG_ID)} />
                    <Num label="Manobra" suffix="min" step={0.1} value={c.maneuverMin} onChange={(v) => setConfig(c.id, { maneuverMin: v })} locked={lockIf(c.id === PREMISES_CONFIG_ID)} />
                    <Num label="Basculamento" suffix="min" step={0.1} value={c.dumpMin} onChange={(v) => setConfig(c.id, { dumpMin: v })} locked={lockIf(c.id === PREMISES_CONFIG_ID)} />
                    <Num label="Custo fixo" suffix="R$/h" step={5} value={c.costFixedPerH} onChange={(v) => setConfig(c.id, { costFixedPerH: v })} />
                    <Num label="Custo operacional" suffix="R$/h" step={5} value={c.costVarPerH} onChange={(v) => setConfig(c.id, { costVarPerH: v })} />
                  </div>
                  {(() => {
                    const ref = sicroTruckCosts(model.scenarios[0]?.hoursPerDay ?? 24);
                    const isRef = Math.abs(c.costFixedPerH - ref.costFixedPerH) < 0.01 && Math.abs(c.costVarPerH - ref.costVarPerH) < 0.01;
                    return (
                      <p className="mt-2 text-[11px] text-black/50">
                        Referência {SICRO_REF.label}: {SICRO_REF.truck.code} {SICRO_REF.truck.description}, produtivo R$ {n1(SICRO_REF.truck.productive)}/h e improdutivo ≈ R$ {n1(SICRO_REF.truck.unproductive)}/h → custo fixo R$ {n1(ref.costFixedPerH)}/h de calendário e operacional R$ {n1(ref.costVarPerH)}/h trabalhada. É a classe mais próxima publicada; ajuste para o caminhão de vocês.{' '}
                        {isRef ? (
                          <span className="font-medium text-emerald-700">Usando a referência.</span>
                        ) : (
                          <button type="button" className="font-medium text-emerald-700 hover:underline" onClick={() => setConfig(c.id, ref)}>Voltar à referência</button>
                        )}
                      </p>
                    );
                  })()}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-emerald-700">Velocidade por rampa e tempos por rota</summary>
                    <div className="mt-3 grid gap-4 lg:grid-cols-2">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-black/45">
                              <th className="py-1 font-medium">Rampa efetiva até (%)</th>
                              <th className="py-1 font-medium">Carregado (km/h)</th>
                              <th className="py-1 font-medium">Vazio (km/h)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.speed.loaded.map((row, i) => (
                              <tr key={i}>
                                <td className="py-0.5 pr-2">
                                  <input type="number" className={inputCls} value={row.maxGrade} aria-label="Rampa máxima da faixa"
                                    onChange={(e) => {
                                      const v = Number(e.target.value);
                                      setConfig(c.id, { speed: { loaded: c.speed.loaded.map((r, j) => (j === i ? { ...r, maxGrade: v } : r)), empty: c.speed.empty.map((r, j) => (j === i ? { ...r, maxGrade: v } : r)) } });
                                    }} />
                                </td>
                                <td className="py-0.5 pr-2">
                                  <input type="number" className={inputCls} value={row.kmh} aria-label="Velocidade carregado"
                                    onChange={(e) => setConfig(c.id, { speed: { ...c.speed, loaded: c.speed.loaded.map((r, j) => (j === i ? { ...r, kmh: Number(e.target.value) } : r)) } })} />
                                </td>
                                <td className="py-0.5">
                                  <input type="number" className={inputCls} value={c.speed.empty[i]?.kmh ?? 0} aria-label="Velocidade vazio"
                                    onChange={(e) => setConfig(c.id, { speed: { ...c.speed, empty: c.speed.empty.map((r, j) => (j === i ? { ...r, kmh: Number(e.target.value) } : r)) } })} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-1 text-[11px] text-black/40">Rampa efetiva = rampa + resistência ao rolamento. Negativa = descida. Valores típicos; ajuste com a curva do fabricante ou medições.</p>
                      </div>
                      <div>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-black/45">
                              <th className="py-1 font-medium">Rota</th>
                              <th className="py-1 text-right font-medium">Carga útil</th>
                              <th className="py-1 text-right font-medium">Ida</th>
                              <th className="py-1 text-right font-medium">Volta</th>
                            </tr>
                          </thead>
                          <tbody>
                            {model.circuits.map((ci) => {
                              const r = model.routes.find((x) => x.id === ci.routeId);
                              if (!r) return null;
                              const tt = travelTimes(r.points, c.speed, limitsOf(model, c), model.rollingResistance);
                              return (
                                <tr key={ci.id} className="border-t border-black/5">
                                  <td className="py-1.5">{ci.name}</td>
                                  <td className="py-1.5 text-right tabular-nums">{n1(payloadFor(c, ci))} t</td>
                                  <td className="py-1.5 text-right tabular-nums">{n1(tt.loaded)} min</td>
                                  <td className="py-1.5 text-right tabular-nums">{n1(tt.empty)} min</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Cenários" description="Condições operacionais aplicadas igualmente a todas as configurações.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-black/45">
                    <th className="py-1 pr-2 font-medium">Cenário</th>
                    <th className="py-1 pr-2 font-medium">Horas/dia</th>
                    <th className="py-1 pr-2 font-medium">Dias simulados</th>
                    <th className="py-1 pr-2 font-medium">DF caminhões (%)</th>
                    <th className="py-1 pr-2 font-medium">UF / eficiência (%)</th>
                    <th className="py-1 pr-2 font-medium">Fator de viagem</th>
                    <th className="py-1 pr-2 font-medium">Fator recebimento</th>
                    <th className="py-1 font-medium">Variabilidade (CV)</th>
                  </tr>
                </thead>
                <tbody>
                  {model.scenarios.map((s, si) => (
                    <tr key={s.id}>
                      <td className="py-1 pr-2">
                        <input className={inputCls} value={s.name} onChange={(e) => setScenario(s.id, { name: e.target.value })} aria-label="Nome do cenário" />
                      </td>
                      {(['hoursPerDay', 'days', 'truckDf', 'efficiency', 'travelFactor', 'receivingFactor', 'cv'] as const).map((k) => {
                        const locked = linked && (k === 'hoursPerDay' || (si === 0 && (k === 'truckDf' || k === 'efficiency')));
                        return (
                          <td key={k} className="py-1 pr-2">
                            {locked ? (
                              <p className="rounded-lg border border-dashed border-black/10 bg-black/[0.03] px-2 py-1.5 text-sm tabular-nums" title={LOCK}>{n1(s[k])}</p>
                            ) : (
                              <input type="number" step={k === 'travelFactor' || k === 'receivingFactor' || k === 'cv' ? 0.05 : 1} className={inputCls} value={s[k]} aria-label={k}
                                onChange={(e) => setScenario(s.id, { [k]: Number(e.target.value) } as Partial<Scenario>)} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </fieldset>
      )}

      {/* ============================== RESULTADOS ============================ */}
      {tab === 'resultados' && (
        <div className="space-y-6">
          {!ready ? (
            <p className="rounded-xl border border-black/[0.07] bg-white p-5 text-sm text-black/55">Importe ao menos uma rota na aba Circuito para simular.</p>
          ) : (
            <>
              <Card
                title="Matriz de configurações × cenários"
                description={`${model.replications} repetições por célula, ${model.scenarios[0]?.days ?? 7} dias simulados cada. Valores em t/dia (média e intervalo de 95%).`}
                actions={
                  <div className="flex items-center gap-2">
                    {matrix && (
                      <Btn tone="light" onClick={exportCsv}>
                        <Download size={15} /> Exportar (Excel)
                      </Btn>
                    )}
                    <Btn onClick={() => void runMatrix()} busy={matrixBusy !== null}>
                      <Play size={15} /> {matrix ? 'Simular de novo' : 'Simular'}
                    </Btn>
                  </div>
                }
              >
                {matrixBusy !== null && <Progress value={matrixBusy} label="Simulando…" />}
                {matrix && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b border-black/[0.06] text-left text-xs text-black/45">
                          <th className="py-2 pr-3 font-medium">Configuração</th>
                          {model.scenarios.map((s) => (
                            <th key={s.id} className="py-2 pr-3 text-right font-medium">{s.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {model.configs.map((c) => (
                          <tr key={c.id} className="border-b border-black/[0.04] last:border-0">
                            <td className="py-2.5 pr-3 font-medium">{c.name}</td>
                            {model.scenarios.map((s) => {
                              const cell = matrix.find((m) => m.configId === c.id && m.scenarioId === s.id);
                              if (!cell) return <td key={s.id} />;
                              const st = cell.stats;
                              const ok = model.targetTpd <= 0 || st.tpd.mean >= model.targetTpd;
                              const active = sel.configId === c.id && sel.scenarioId === s.id;
                              return (
                                <td key={s.id} className="py-1.5 pr-3 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setSel({ configId: c.id, scenarioId: s.id })}
                                    className={clsx('w-full rounded-lg px-2 py-1.5 text-right', active ? 'bg-[#151619] text-white' : 'hover:bg-black/[0.03]')}
                                  >
                                    <span className={clsx('block font-semibold tabular-nums', !active && (ok ? 'text-[#1A1A1A]' : 'text-red-700'))}>{t0(st.tpd.mean)}</span>
                                    <span className={clsx('block text-[11px] tabular-nums', active ? 'text-white/70' : 'text-black/45')}>
                                      {t0(st.tpd.lo)}–{t0(st.tpd.hi)}
                                      {model.targetTpd > 0 && ` · ${Math.round((st.tpd.mean / model.targetTpd) * 100)}% da meta`}
                                      {st.costPerT.mean > 0 && ` · ${brl(st.costPerT.mean)}/t`}
                                    </span>
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-xs text-black/45">Clique em uma célula para ver o detalhe. Em vermelho: abaixo da meta de {t0(model.targetTpd)} t/dia.</p>
                  </div>
                )}
              </Card>

              {matrix && (
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title={`Ciclo por configuração · ${model.scenarios.find((s) => s.id === sel.scenarioId)?.name ?? ''}`} description="Tempo médio de cada etapa por viagem.">
                    <CycleBars
                      rows={model.configs.map((c) => ({
                        label: c.name,
                        cycle: matrix.find((m) => m.configId === c.id && m.scenarioId === sel.scenarioId)?.stats.cycle ?? {},
                      }))}
                    />
                  </Card>
                  {(() => {
                    const cell = matrix.find((m) => m.configId === sel.configId && m.scenarioId === sel.scenarioId);
                    if (!cell) return null;
                    const s = cell.stats;
                    const rows: [string, string][] = [
                      ['Produção', `${t0(s.tpd.mean)} t/dia · ${n1(s.tph.mean)} t/h`],
                      ['Ciclo médio', `${n1(s.cycleMin.mean)} min`],
                      ['Fila na carga', `${n1(s.queueLoadMin.mean)} min por viagem`],
                      ['Fila na descarga', `${n1(s.queueDumpMin.mean)} min por viagem`],
                      ['Ocupação da carga', pc(s.loaderUtil.mean)],
                      ['Ocupação da descarga', pc(s.dumpUtil.mean)],
                      ['Ocupação da carregadeira', s.stackerUtil.mean > 0 ? pc(s.stackerUtil.mean) : '—'],
                      ['Pulmão (máximo)', s.bufferMaxT > 0 ? `${t0(s.bufferMaxT)} t` : '—'],
                      ['Falta de material na fábrica', s.plantStockoutH.mean > 0 ? `${n1(s.plantStockoutH.mean)} h no período` : 'Nenhuma'],
                      ['Custo do transporte', s.costPerT.mean > 0 ? `${brl(s.costPerT.mean)}/t` : 'Informe os custos na configuração'],
                    ];
                    const util = [
                      ['carga', s.loaderUtil.mean],
                      ['descarga', s.dumpUtil.mean],
                      ['carregadeira', s.stackerUtil.mean],
                    ] as const;
                    const bottleneck = [...util].sort((a, b) => b[1] - a[1])[0];
                    return (
                      <Card title={`${model.configs.find((c) => c.id === sel.configId)?.name} · ${model.scenarios.find((x) => x.id === sel.scenarioId)?.name}`}>
                        <dl className="divide-y divide-black/5 text-sm">
                          {rows.map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-4 py-1.5">
                              <dt className="text-black/55">{k}</dt>
                              <dd className="text-right font-medium tabular-nums">{v}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="mt-3 rounded-lg bg-black/[0.03] px-3 py-2 text-sm text-black/65">
                          {bottleneck[1] > 0.85
                            ? `Recurso mais carregado: ${bottleneck[0]} (${pc(bottleneck[1])} ocupado). Acima de 85% a fila cresce rápido: mais caminhões trazem pouco ganho.`
                            : s.queueLoadMin.mean + s.queueDumpMin.mean < 1
                              ? 'Carga e descarga com folga: a produção depende do número de caminhões.'
                              : `Fila total de ${n1(s.queueLoadMin.mean + s.queueDumpMin.mean)} min por viagem. Rode a busca de frota abaixo para achar o ponto ótimo.`}
                        </p>
                      </Card>
                    );
                  })()}
                </div>
              )}

              <Card
                title="Busca da frota mínima"
                description="Varia o nº de caminhões de um circuito (os demais fixos) e mostra onde a produção atinge a meta e onde satura."
                actions={
                  <div className="flex flex-wrap items-end gap-2">
                    {selector}
                    {model.circuits.length > 1 && (
                      <label className="text-xs text-black/55">
                        Circuito
                        <select className={clsx(inputCls, 'mt-1 w-48')} value={sweepCircuit || model.circuits[0].id} onChange={(e) => setSweepCircuit(e.target.value)}>
                          {model.circuits.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <Btn onClick={() => void runSweep()} busy={sweepBusy !== null}>
                      <Play size={15} /> Buscar
                    </Btn>
                  </div>
                }
              >
                {sweepBusy !== null && <Progress value={sweepBusy} label="Testando frotas…" />}
                {sweep && <SweepChart points={sweep.points} target={model.targetTpd} minFleet={sweep.minFleet} saturation={sweep.saturation} scope={sweep.scope} />}
                {!sweep && sweepBusy === null && <p className="text-sm text-black/50">Defina a meta em Circuito → Parâmetros gerais e clique em Buscar.</p>}
              </Card>
            </>
          )}
        </div>
      )}

      {/* =============================== ANIMAÇÃO ============================= */}
      {tab === 'animacao' && (
        <div className="space-y-4">
          <Card
            title="Animação do circuito"
            description="24 horas de operação simuladas, com filas na carga e na descarga."
            actions={
              <div className="flex flex-wrap items-end gap-2">
                {selector}
                {model.plan && model.plan.movements.length > 0 && (
                  <label className="text-xs text-black/55">
                    Operação
                    <select className={clsx(inputCls, 'mt-1 w-48')} value={animPeriod} onChange={(e) => setAnimPeriod(Number(e.target.value))}>
                      <option value={0}>Circuito (aba Circuito)</option>
                      {model.plan.periods.map((p, i) => (
                        <option key={i} value={i + 1}>Plano · {p.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <Btn onClick={() => void runAnim()} busy={animBusy} disabled={!ready && !(animPeriod > 0)}>
                  <Play size={15} /> Gerar
                </Btn>
              </div>
            }
          >
            <div className="mb-3 flex gap-1 rounded-lg bg-black/[0.04] p-1 text-sm" role="group" aria-label="Tipo de vista">
              {[false, true].map((v) => (
                <button key={String(v)} type="button" onClick={() => setView3d(v)} className={clsx('rounded-md px-3 py-1', view3d === v ? 'bg-white font-semibold shadow-sm' : 'text-black/55')}>
                  {v ? '3D' : '2D'}
                </button>
              ))}
            </div>
            {view3d ? (
              <View3D
                dem={animDem}
                routes={(animRoutes ?? model.routes).map((r) => ({ points: r.points }))}
                overlays={animOverlays}
                dots={frame?.dots}
                loaders={frame?.loaders}
                height={560}
              />
            ) : (
              <MapCanvas
              terrain={terrain}
              contours={contours}
              routes={animRoutes ?? model.routes}
              overlays={animOverlays}
              dots={frame?.dots}
              loaders={frame?.loaders}
              queues={frame?.queues}
              circuitRoutes={anim ? anim.geometry.map((g) => (animRoutes ? `r-${g.circuitId}` : model.circuits.find((c) => c.id === g.circuitId)?.routeId ?? '')) : undefined}
              height={520}
            />
            )}
            {animator && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap items-center gap-4">
                  <Btn tone="light" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
                    {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? 'Pausar' : 'Reproduzir'}
                  </Btn>
                  <span className="font-mono text-2xl font-semibold tabular-nums">{clock}</span>
                  <label className="flex items-center gap-2 text-sm text-black/60">
                    Velocidade
                    <select className={clsx(inputCls, 'w-28')} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                      {[30, 60, 120, 300, 600, 1200].map((v) => (
                        <option key={v} value={v}>{v}×</option>
                      ))}
                    </select>
                  </label>
                  <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/60">
                    {DOT_KINDS.map(({ id: k, label: l }) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: DOT_COLORS[k] }} />
                        {l} <span className="tabular-nums text-black/40">({frame?.dots.filter((d) => d.kind === k).length ?? 0})</span>
                      </span>
                    ))}
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#8c5a33]" /> Material na caçamba
                    </span>
                    {(['carregando', 'parado', 'manutencao'] as const).map((k) => (
                      <span key={k} className="flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 rounded-[3px] border-2 border-[#3f4146]" style={{ background: LOADER_COLORS[k] }} />
                        Escavadeira {k === 'carregando' ? 'carregando' : k === 'parado' ? 'sem caminhão' : 'em manutenção'}
                      </span>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={animator.end}
                  step={1}
                  value={animT}
                  onChange={(e) => {
                    setPlaying(false);
                    setAnimT(Number(e.target.value));
                  }}
                  className="w-full accent-emerald-600"
                  aria-label="Linha do tempo"
                />
                <AnimTables animator={animator} from={model.warmupH * 60} t={animT} info={animInfo} />
                <p className="text-xs text-black/45">
                  Equipamentos desenhados em escala (caminhão 10,5 × 2,6 m; escavadeira 9,5 × 3,3 m): aproxime com a roda do mouse. Com pouco zoom, ficam com um tamanho mínimo para continuar visíveis.{' '}
                  {animPeriod > 0 && (periodResults?.some((r) => r.period === animPeriod && r.configId === sel.configId) ? 'Frota dimensionada para o período. ' : 'Rode “Dimensionar” no Plano de lavra para usar a frota do período; por ora, 1 caminhão por movimentação. ')}
                  Produção nas 24 h desta rodada: {t0(anim!.stats.tonnes)} t em {anim!.stats.trips} viagens. A animação mostra uma repetição; os
                  resultados usam a média de {model.replications}.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
};

export default SimulationView;
