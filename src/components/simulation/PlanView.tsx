import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Download, FileUp, Layers, MapPin, Play, Plus, Trash2, Upload } from 'lucide-react';
import type { SimModel } from '@/sim/types';
import {
  PLACE_KINDS,
  assignFronts,
  buildNetwork,
  buildPeriodModel,
  calendarWorkDays,
  disposalCheck,
  emptyPlan,
  movementsFromCsv,
  movementsToCsv,
  newMovement,
  placesFromRoutes,
  type FrontArea,
  type MinePlan,
  type Movement,
  type PeriodResult,
  type Place,
} from '@/sim/plan';
import type { ParsedFrontArea, ParsedSolid } from '@/sim/planParse';
import { periodFromName } from '@/sim/planParse';
import { runInWorker } from '@/sim/client';
import type { Contours } from '@/sim/terrain';
import MapCanvas, { type MapOverlays, type TerrainLayer } from './MapCanvas';
import { Btn, Card, Num, Progress, inputCls, n1, t0 } from './ui';

/** Cores das frentes (paleta categórica validada) e do rejeito. */
const FRONT_COLORS = ['#2a78d6', '#1baf7a', '#e87ba4', '#eda100', '#8a5cd6'];
const SOLID_COLOR = '#eb6834';
const CONFIG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

const mt = (t: number) => (t / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ha = (m2: number) => (m2 / 1e4).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface Props {
  model: SimModel;
  setModel: (m: SimModel) => void;
  canEdit: boolean;
  terrain: TerrainLayer | null;
  contours: Contours | null;
  results: PeriodResult[] | null;
  setResults: (r: PeriodResult[] | null) => void;
  onError: (msg: string | null) => void;
}

const PlanView: React.FC<Props> = ({ model, setModel, canEdit, terrain, contours, results, setResults, onError }) => {
  const plan: MinePlan = model.plan ?? emptyPlan();
  const setPlan = (p: MinePlan) => setModel({ ...model, plan: p });
  const [period, setPeriod] = useState(1);
  const [busy, setBusy] = useState<{ what: string; f: number; stage?: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const nPer = plan.periods.length;

  const frontNames = plan.places.filter((p) => p.kind === 'frente').map((p) => p.name);
  const colorOfFront = (name: string) => FRONT_COLORS[Math.max(0, frontNames.indexOf(name)) % FRONT_COLORS.length];
  const placeName = (id: string) => plan.places.find((p) => p.id === id)?.name ?? '—';

  /* ------------------------------ lugares ------------------------------ */
  const setPlace = (id: string, patch: Partial<Place>) => {
    const old = plan.places.find((p) => p.id === id);
    const places = plan.places.map((p) => (p.id === id ? { ...p, ...patch } : p));
    // renomear frente: as áreas acompanham
    const fronts = old && patch.name && old.kind === 'frente' ? plan.fronts.map((f) => (f.front === old.name ? { ...f, front: patch.name! } : f)) : plan.fronts;
    setPlan(reassign({ ...plan, places, fronts }));
  };
  const reassign = (p: MinePlan) => ({ ...p, fronts: assignFronts(p) });

  /* ------------------------------ importação ------------------------------ */
  const importFronts = async (files: FileList) => {
    onError(null);
    const fronts: FrontArea[] = [...plan.fronts];
    const msgs: string[] = [];
    let i = 0;
    for (const f of Array.from(files)) {
      const per = periodFromName(f.name);
      if (!per) {
        msgs.push(`${f.name}: não achei o número do período no nome (ex.: 05-Linha.dxf ou Ano5.dxf).`);
        continue;
      }
      setBusy({ what: 'frentes', f: i / files.length, stage: f.name });
      try {
        const areas = await runInWorker<ParsedFrontArea[]>({ kind: 'planFronts', file: f }, (x) => setBusy({ what: 'frentes', f: (i + x) / files.length, stage: f.name }));
        // substitui as áreas do mesmo período
        for (let k = fronts.length - 1; k >= 0; k--) if (fronts[k].period === per) fronts.splice(k, 1);
        if (!areas.length) msgs.push(`${f.name}: nenhum contorno de área encontrado (camada Boundary ou polilinha fechada acima de 0,3 ha).`);
        areas.forEach((a, j) => fronts.push({ id: `f${per}-${j}-${Date.now().toString(36)}`, period: per, front: frontNames[0] ?? '', ring: a.ring, areaM2: a.areaM2, z: a.z, zMin: a.zMin, zMax: a.zMax, lx: a.lx, ly: a.ly, file: f.name }));
      } catch (e) {
        msgs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      i++;
    }
    setBusy(null);
    setWarnings(msgs);
    const maxPer = Math.max(nPer, ...fronts.map((f) => f.period));
    setPlan(reassign({ ...withPeriods(plan, maxPer), fronts }));
  };

  const importSolids = async (files: FileList) => {
    onError(null);
    const solids = [...plan.solids];
    const msgs: string[] = [];
    let i = 0;
    for (const f of Array.from(files)) {
      const per = periodFromName(f.name);
      if (!per) {
        msgs.push(`${f.name}: não achei o número do período no nome (ex.: Ano5_Rejeito.dxf).`);
        continue;
      }
      if (/\.dwg$/i.test(f.name)) {
        msgs.push(`${f.name}: o navegador não lê DWG. No CAD, use "Salvar como" → DXF.`);
        continue;
      }
      setBusy({ what: 'sólidos', f: i / files.length, stage: f.name });
      try {
        const s = await runInWorker<ParsedSolid>({ kind: 'planSolid', file: f }, (x) => setBusy({ what: 'sólidos', f: (i + x) / files.length, stage: f.name }));
        for (let k = solids.length - 1; k >= 0; k--) if (solids[k].period === per) solids.splice(k, 1);
        solids.push({ id: `s${per}-${Date.now().toString(36)}`, period: per, name: `Rejeito ${plan.periods[per - 1]?.label ?? `período ${per}`}`, volumeM3: s.volumeM3, hull: s.hull, cx: s.cx, cy: s.cy, zMin: s.zMin, zMax: s.zMax, faces: s.faces, file: f.name });
      } catch (e) {
        msgs.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      i++;
    }
    setBusy(null);
    setWarnings(msgs);
    let next = { ...plan, solids: solids.sort((a, b) => a.period - b.period) };
    if (!next.places.some((p) => p.kind === 'rejeito')) {
      const s = solids[0];
      next = { ...next, places: [...next.places, { id: `p-rej-${Date.now().toString(36)}`, name: 'Rejeito nas cavas', kind: 'rejeito', x: s?.cx ?? 0, y: s?.cy ?? 0, z: s ? (s.zMin + s.zMax) / 2 : 0 }] };
    }
    setPlan(next);
  };

  /* ------------------------------ períodos ------------------------------ */
  function withPeriods(p: MinePlan, n: number): MinePlan {
    const wd = calendarWorkDays(p.calendar);
    const periods = Array.from({ length: n }, (_, i) => p.periods[i] ?? { label: `Ano ${i + 1}`, workDays: wd });
    const movements = p.movements.map((m) => ({ ...m, tonnes: Array.from({ length: n }, (_, i) => m.tonnes[i] ?? 0) }));
    return { ...p, periods, movements };
  }

  /* ------------------------------ movimentações ------------------------------ */
  const setMovement = (id: string, patch: Partial<Movement>) => setPlan(reassign({ ...plan, movements: plan.movements.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const addMovement = () => {
    const o = plan.places.find((p) => p.kind === 'frente') ?? plan.places[0];
    const d = plan.places.find((p) => p.kind === 'usina') ?? plan.places[1] ?? plan.places[0];
    if (!o || !d) return onError('Cadastre os lugares (pontos de carga e descarga) antes das movimentações.');
    setPlan({ ...plan, movements: [...plan.movements, newMovement(`m${Date.now().toString(36)}`, o.id, d.id, nPer)] });
  };

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([movementsToCsv(plan)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'movimentacoes_por_periodo.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  const importCsv = async (file: File) => {
    const text = await file.text();
    const r = movementsFromCsv(plan, text);
    setWarnings(r.warnings);
    setPlan(reassign(r.plan));
  };

  /* ------------------------------ mapa do período ------------------------------ */
  const net = useMemo(() => buildNetwork(model.routes), [model.routes]);
  const periodView = useMemo(() => {
    try {
      return buildPeriodModel(model, plan, period, net);
    } catch {
      return null;
    }
  }, [model, plan, period, net]);
  const overlays: MapOverlays = {
    polygons: [
      ...plan.fronts.filter((f) => f.period === period).map((f) => ({ ring: f.ring, fill: `${colorOfFront(f.front)}33`, stroke: colorOfFront(f.front), label: `${f.front} · ${ha(f.areaM2)} ha` })),
      ...plan.solids.filter((s) => s.period === period).map((s) => ({ ring: s.hull, fill: `${SOLID_COLOR}2e`, stroke: SOLID_COLOR, label: s.name, dashed: true })),
    ],
    paths: (periodView?.model.routes ?? []).map((r, i) => ({ points: r.points, color: CONFIG_COLORS[i % CONFIG_COLORS.length], label: r.name })),
  };

  /* ------------------------------ dimensionamento ------------------------------ */
  const [cfgIds, setCfgIds] = useState<string[]>(model.configs.slice(0, 2).map((c) => c.id));
  const [scenarioId, setScenarioId] = useState(model.scenarios[0]?.id ?? 's1');
  const runSizing = async () => {
    onError(null);
    setBusy({ what: 'frota', f: 0 });
    try {
      const res = await runInWorker<PeriodResult[]>({ kind: 'periods', model: { ...model, plan }, configIds: cfgIds, scenarioId }, (f, stage) => setBusy({ what: 'frota', f, stage }));
      setResults(res);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const exportResults = () => {
    if (!results) return;
    const head = ['Configuração', 'Período', 'Circuito', 'Material', 't no período', 'Meta t/dia', 'Simulado t/dia', 'Caminhões', 'Distância (m)', 'Desnível (m)', 'Carga em', 'Descarga em'];
    const dec = (n: number, d = 0) => n.toFixed(d).replace('.', ',');
    const rows = results.flatMap((r) =>
      r.circuits.map((c) => [model.configs.find((x) => x.id === r.configId)?.name ?? r.configId, r.label, c.name, c.material, dec(c.tonnes), dec(c.targetTpd), dec(c.achievedTpd), String(c.trucks), dec(c.lengthM), dec(c.dz, 1), c.originLabel, c.destLabel]),
    );
    const csv = '﻿' + [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frota_por_periodo.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const checks = disposalCheck(plan);
  const totals = plan.periods.map((_, i) => plan.movements.reduce((a, m) => a + (m.tonnes[i] ?? 0), 0));

  return (
    <div className="space-y-6">
      {!model.routes.length && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Importe primeiro as rotas na aba Circuito: elas formam a malha de vias por onde os caminhões andam em cada período.
        </p>
      )}

      {/* --------------------------- mapa --------------------------- */}
      <Card
        title="Plano no mapa"
        description="Áreas lavradas e disposição de rejeito do período, com o trajeto de cada movimentação pela malha de vias."
        actions={
          <label className="text-xs text-black/55">
            Período
            <select className={clsx(inputCls, 'mt-1 w-40')} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {plan.periods.map((p, i) => (
                <option key={i} value={i + 1}>{p.label}</option>
              ))}
            </select>
          </label>
        }
      >
        <input type="range" min={1} max={Math.max(1, nPer)} value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="mb-3 w-full accent-emerald-600" aria-label="Período no mapa" />
        <MapCanvas terrain={terrain} contours={contours} routes={model.routes} routesAsNetwork overlays={overlays} height={500} />
        {periodView && periodView.info.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-black/45">
                  <th className="py-1 pr-2 font-medium">Movimentação</th>
                  <th className="py-1 pr-2 text-right font-medium">t no período</th>
                  <th className="py-1 pr-2 text-right font-medium">Meta (t/dia)</th>
                  <th className="py-1 pr-2 text-right font-medium">Distância</th>
                  <th className="py-1 pr-2 text-right font-medium">Desnível</th>
                  <th className="py-1 font-medium">Carga / descarga</th>
                </tr>
              </thead>
              <tbody>
                {periodView.info.map((c, i) => (
                  <tr key={c.circuitId} className="border-t border-black/5">
                    <td className="py-1.5 pr-2">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: CONFIG_COLORS[i % CONFIG_COLORS.length] }} />
                      {c.name}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{t0(c.tonnes)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{t0(c.targetTpd)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{t0(c.lengthM)} m</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{c.dz > 0 ? '+' : ''}{n1(c.dz)} m</td>
                    <td className="py-1.5 text-xs text-black/55">
                      {c.originLabel}{c.originSource === 'fixo' && plan.places.find((p) => p.name === c.name.split(' → ')[0])?.kind === 'frente' ? ' (sem área no período: ponto fixo)' : ''} → {c.destLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-black/40">
              Distância = acesso interno (rampa até {plan.rampMaxGrade}%, em zigue-zague quando o desnível exige) + caminho mais curto pela malha + acesso no destino.
            </p>
          </div>
        )}
      </Card>

      {busy && <Progress value={busy.f} label={`${busy.what === 'frota' ? 'Dimensionando' : 'Lendo'} ${busy.stage ?? ''}`} />}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        {/* --------------------------- lugares --------------------------- */}
        <Card
          title="Lugares de carga e descarga"
          description="Frentes mudam de posição a cada período (área do DXF); a disposição de rejeito vai para o sólido do período. Os demais são fixos."
          actions={
            <Btn tone="light" onClick={() => setPlan(reassign({ ...plan, places: placesFromRoutes(model.routes, plan.places) }))} disabled={!model.routes.length}>
              <MapPin size={15} /> Gerar das pontas das rotas
            </Btn>
          }
        >
          {plan.places.length === 0 ? (
            <p className="text-sm text-black/50">Clique em “Gerar das pontas das rotas” e dê nome e tipo a cada ponto (ex.: BAV → Frente; ponto comum → Usina).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-black/45">
                    <th className="py-1 pr-2 font-medium">Nome</th>
                    <th className="py-1 pr-2 font-medium">Tipo</th>
                    <th className="py-1 pr-2 text-right font-medium">E (m)</th>
                    <th className="py-1 pr-2 text-right font-medium">N (m)</th>
                    <th className="py-1 pr-2 text-right font-medium">Cota (m)</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {plan.places.map((p) => (
                    <tr key={p.id} className="border-t border-black/5">
                      <td className="py-1 pr-2">
                        <input className={inputCls} value={p.name} onChange={(e) => setPlace(p.id, { name: e.target.value })} aria-label="Nome do lugar" />
                      </td>
                      <td className="py-1 pr-2">
                        <select className={inputCls} value={p.kind} onChange={(e) => setPlace(p.id, { kind: e.target.value as Place['kind'] })} aria-label="Tipo do lugar">
                          {PLACE_KINDS.map((k) => (
                            <option key={k.id} value={k.id}>{k.label}</option>
                          ))}
                        </select>
                      </td>
                      {(['x', 'y', 'z'] as const).map((k) => (
                        <td key={k} className="w-32 py-1 pr-2">
                          <input type="number" step={0.1} className={clsx(inputCls, 'text-right')} value={Number(p[k].toFixed(1))} onChange={(e) => setPlace(p.id, { [k]: Number(e.target.value) })} aria-label={k} />
                        </td>
                      ))}
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          className="rounded-lg p-2 text-black/40 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remover ${p.name}`}
                          onClick={() => setPlan(reassign({ ...plan, places: plan.places.filter((x) => x.id !== p.id), movements: plan.movements.filter((m) => m.origin !== p.id && m.destination !== p.id) }))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Btn
                tone="light"
                className="mt-2"
                onClick={() => setPlan({ ...plan, places: [...plan.places, { id: `p${Date.now().toString(36)}`, name: 'Novo lugar', kind: 'outro', x: plan.places[0]?.x ?? 0, y: plan.places[0]?.y ?? 0, z: plan.places[0]?.z ?? 0 }] })}
              >
                <Plus size={15} /> Adicionar lugar
              </Btn>
            </div>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* --------------------------- frentes --------------------------- */}
          <Card title="Frentes de lavra por período (DXF)" description="Um arquivo por período, com o número no nome (01-Linha.dxf, 02-Linha.dxf…). Lê a camada Boundary e a cota do Pit_Toe.">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
              <Layers size={16} /> Importar frentes
              <input type="file" accept=".dxf" multiple className="sr-only" onChange={(e) => e.target.files && void importFronts(e.target.files)} />
            </label>
            {plan.fronts.length > 0 && (
              <div className="mt-4 max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-left text-xs text-black/45">
                      <th className="py-1 pr-2 font-medium">Período</th>
                      <th className="py-1 pr-2 text-right font-medium">Área</th>
                      <th className="py-1 pr-2 text-right font-medium">Cota média</th>
                      <th className="py-1 font-medium">Frente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...plan.fronts].sort((a, b) => a.period - b.period || b.areaM2 - a.areaM2).map((f) => (
                      <tr key={f.id} className={clsx('border-t border-black/5', f.period === period && 'bg-emerald-50/60')}>
                        <td className="py-1 pr-2">
                          <button type="button" className="underline-offset-2 hover:underline" onClick={() => setPeriod(f.period)}>
                            {plan.periods[f.period - 1]?.label ?? f.period}
                          </button>
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{ha(f.areaM2)} ha</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{n1(f.z)} m</td>
                        <td className="py-1">
                          <select
                            className={inputCls}
                            value={f.front}
                            aria-label="Frente da área"
                            onChange={(e) => setPlan({ ...plan, fronts: plan.fronts.map((x) => (x.id === f.id ? { ...x, front: e.target.value, manual: true } : x)) })}
                          >
                            {!frontNames.includes(f.front) && <option value={f.front}>{f.front || '—'}</option>}
                            {frontNames.map((n) => (
                              <option key={n} value={n}>{n}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {plan.fronts.length > 0 && (
              <p className="mt-2 text-xs text-black/45">
                As áreas são distribuídas entre as frentes com movimentação no período (a que mais produz fica com a maior área, as demais pela proximidade). Trocar à mão fixa a escolha.
                {frontNames.length === 0 && ' Marque ao menos um lugar como Frente.'}
              </p>
            )}
          </Card>

          {/* --------------------------- rejeito --------------------------- */}
          <Card title="Disposição de rejeito por período (DXF)" description="Sólidos 3DFACE, um por período (Ano5_Rejeito.dxf…). Calcula volume, posição e cotas.">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
              <Upload size={16} /> Importar sólidos
              <input type="file" accept=".dxf,.dwg" multiple className="sr-only" onChange={(e) => e.target.files && void importSolids(e.target.files)} />
            </label>
            {plan.solids.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Num label="Densidade do rejeito disposto" suffix="t/m³" step={0.01} value={plan.disposalDensity} onChange={(v) => setPlan({ ...plan, disposalDensity: v })} />
                </div>
                <div className="mt-3 max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-left text-xs text-black/45">
                        <th className="py-1 pr-2 font-medium">Período</th>
                        <th className="py-1 pr-2 text-right font-medium">Sólido (mil m³)</th>
                        <th className="py-1 pr-2 text-right font-medium">Rejeito (mil m³)</th>
                        <th className="py-1 pr-2 text-right font-medium">Saldo</th>
                        <th className="py-1 text-right font-medium">Acumulado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.solids.map((s) => {
                        const c = checks.find((x) => x.period === s.period);
                        return (
                          <tr key={s.id} className={clsx('border-t border-black/5', s.period === period && 'bg-emerald-50/60')}>
                            <td className="py-1 pr-2">
                              <button type="button" className="hover:underline" onClick={() => setPeriod(s.period)}>
                                {plan.periods[s.period - 1]?.label ?? s.period}
                              </button>
                            </td>
                            <td className="py-1 pr-2 text-right tabular-nums">{t0(s.volumeM3 / 1e3)}</td>
                            <td className="py-1 pr-2 text-right tabular-nums">{c ? t0(c.requiredM3 / 1e3) : '—'}</td>
                            <td className={clsx('py-1 pr-2 text-right font-medium tabular-nums', c && c.balanceM3 < 0 && 'text-red-700')}>{c ? t0(c.balanceM3 / 1e3) : '—'}</td>
                            <td className={clsx('py-1 text-right tabular-nums', c && c.cumulativeM3 < 0 && 'text-red-700')}>{c ? t0(c.cumulativeM3 / 1e3) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {checks.some((c) => c.balanceM3 < 0) && (
                  <p className="mt-2 flex gap-2 text-xs text-red-800">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    Em vermelho: o sólido do período não comporta o rejeito daquele período (pela densidade informada). O excedente precisa de outro destino ou de antecipar o sólido seguinte.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>

        {/* --------------------------- calendário --------------------------- */}
        <Card title="Calendário e períodos" description="Dias trabalháveis por mês (padrão: calendário da apresentação, com 4 meses chuvosos). A meta diária de cada período = toneladas ÷ dias trabalháveis.">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-black/45">
                    <th className="py-1 pr-2 font-medium">Mês</th>
                    {plan.calendar.map((m, i) => (
                      <th key={i} className="py-1 pr-1 text-center font-medium">{i + 1}</th>
                    ))}
                    <th className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1 pr-2 text-xs text-black/55">Clima</td>
                    {plan.calendar.map((m, i) => (
                      <td key={i} className="py-1 pr-1">
                        <button
                          type="button"
                          className={clsx('w-full rounded-md px-1 py-1 text-[11px] font-medium', m.season === 'chuvoso' ? 'bg-sky-100 text-sky-900' : 'bg-amber-50 text-amber-900')}
                          onClick={() => setPlan({ ...plan, calendar: plan.calendar.map((x, j) => (j === i ? { ...x, season: x.season === 'chuvoso' ? 'seco' : 'chuvoso' } : x)) })}
                        >
                          {m.season === 'chuvoso' ? 'chuva' : 'seco'}
                        </button>
                      </td>
                    ))}
                    <td />
                  </tr>
                  <tr>
                    <td className="py-1 pr-2 text-xs text-black/55">Dias trabalháveis</td>
                    {plan.calendar.map((m, i) => (
                      <td key={i} className="py-1 pr-1">
                        <input
                          type="number"
                          className={clsx(inputCls, 'px-1 text-center')}
                          value={m.workDays}
                          aria-label={`Dias trabalháveis do mês ${i + 1}`}
                          onChange={(e) => {
                            const calendar = plan.calendar.map((x, j) => (j === i ? { ...x, workDays: Math.max(0, Math.min(x.days, Number(e.target.value))) } : x));
                            const wd = calendarWorkDays(calendar);
                            setPlan({ ...plan, calendar, periods: plan.periods.map((p) => ({ ...p, workDays: wd })) });
                          }}
                        />
                      </td>
                    ))}
                    <td className="py-1 text-right font-semibold tabular-nums">{calendarWorkDays(plan.calendar)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Num label="Períodos" value={nPer} onChange={(v) => setPlan(withPeriods(plan, Math.max(1, Math.min(60, Math.round(v)))))} />
              <Num label="Horas de operação/dia" value={plan.hoursPerDay} onChange={(v) => setPlan({ ...plan, hoursPerDay: Math.max(1, Math.min(24, v)) })} />
              <Num label="Fator de pico da meta" step={0.05} value={plan.peakFactor} onChange={(v) => setPlan({ ...plan, peakFactor: Math.max(0.5, v) })} />
              <Num label="Rampa máx. dos acessos" suffix="%" step={0.5} value={plan.rampMaxGrade} onChange={(v) => setPlan({ ...plan, rampMaxGrade: Math.max(2, v) })} />
              <Num label="Sinuosidade dos acessos" step={0.05} value={plan.accessTortuosity} onChange={(v) => setPlan({ ...plan, accessTortuosity: Math.max(1, v) })} />
            </div>
          </div>
          <p className="mt-2 text-xs text-black/45">
            Fator de pico 1 = média do período. Para dimensionar pelo mês chuvoso (menos dias, mesma geração de rejeito), use o fator correspondente (ex.: 1,5).
          </p>
        </Card>

        {/* --------------------------- movimentações --------------------------- */}
        <Card
          title="Movimentações por período"
          description="Toneladas de cada origem para cada destino em cada período. Valores em t (a planilha aceita colar do Excel)."
          actions={
            <div className="flex flex-wrap gap-2">
              <Btn tone="light" onClick={exportCsv} disabled={!plan.movements.length}>
                <Download size={15} /> Planilha
              </Btn>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
                <FileUp size={15} /> Importar planilha
                <input type="file" accept=".csv,.txt" className="sr-only" onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} />
              </label>
              <Btn tone="light" onClick={addMovement}>
                <Plus size={15} /> Movimentação
              </Btn>
            </div>
          }
        >
          {plan.movements.length === 0 ? (
            <p className="text-sm text-black/50">
              Nenhuma movimentação. Adicione uma a uma ou importe a planilha (colunas: Material; Origem; Destino; Densidade; um período por coluna, com os nomes dos lugares).
            </p>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 520 + nPer * 84 }}>
                  <thead>
                    <tr className="text-left text-xs text-black/45">
                      <th className="sticky left-0 z-10 bg-white py-1 pr-2 font-medium">Movimentação</th>
                      {plan.periods.map((p, i) => (
                        <th key={i} className="py-1 pr-1 text-right font-medium">{p.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.movements.map((m) => (
                      <tr key={m.id} className="border-t border-black/5">
                        <td className="sticky left-0 z-10 bg-white py-1 pr-2 text-xs">
                          <span className="font-medium">{placeName(m.origin)} → {placeName(m.destination)}</span>
                          <span className="block text-black/45">{m.material}</span>
                        </td>
                        {plan.periods.map((_, i) => (
                          <td key={i} className="py-1 pr-1">
                            <input
                              type="number"
                              step={1000}
                              className={clsx(inputCls, 'w-20 px-1 text-right')}
                              value={Math.round(m.tonnes[i] ?? 0)}
                              aria-label={`${placeName(m.origin)} → ${placeName(m.destination)}, ${plan.periods[i].label}`}
                              onChange={(e) => setMovement(m.id, { tonnes: m.tonnes.map((t, j) => (j === i ? Math.max(0, Number(e.target.value)) : t)) })}
                              onPaste={(e) => {
                                // colar uma linha do Excel a partir desta célula
                                const vals = e.clipboardData.getData('text').trim().split(/\t|;|\r?\n/).filter(Boolean);
                                if (vals.length < 2) return;
                                e.preventDefault();
                                const parsed = vals.map((v) => Number(v.replace(/\./g, '').replace(',', '.')) || 0);
                                setMovement(m.id, { tonnes: m.tonnes.map((t, j) => (j >= i && j - i < parsed.length ? parsed[j - i] : t)) });
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-black/10 text-xs font-semibold">
                      <td className="sticky left-0 bg-white py-1.5 pr-2">Total (Mt)</td>
                      {totals.map((t, i) => (
                        <td key={i} className="py-1.5 pr-2 text-right tabular-nums">{mt(t)}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <details>
                <summary className="cursor-pointer text-sm font-medium text-emerald-700">Origem, destino e equipamento de carga de cada movimentação</summary>
                <div className="mt-3 space-y-3">
                  {plan.movements.map((m) => (
                    <div key={m.id} className="rounded-xl border border-black/[0.06] p-3">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-black/55">Material</label>
                          <input className={inputCls} value={m.material} onChange={(e) => setMovement(m.id, { material: e.target.value })} />
                        </div>
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-black/55">Origem</label>
                          <select className={inputCls} value={m.origin} onChange={(e) => setMovement(m.id, { origin: e.target.value })}>
                            {plan.places.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="mb-1 block text-xs text-black/55">Destino</label>
                          <select className={inputCls} value={m.destination} onChange={(e) => setMovement(m.id, { destination: e.target.value })}>
                            {plan.places.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <Num label="Densidade solta" suffix="t/m³" step={0.05} value={m.density} onChange={(v) => setMovement(m.id, { density: v })} />
                        <div className="flex items-end justify-end">
                          <button type="button" className="rounded-lg p-2 text-black/40 hover:bg-red-50 hover:text-red-600" aria-label="Remover movimentação" onClick={() => setPlan({ ...plan, movements: plan.movements.filter((x) => x.id !== m.id) })}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <Num label="Equip. de carga" value={m.loaders} onChange={(v) => setMovement(m.id, { loaders: Math.max(1, Math.round(v)) })} />
                        <Num label="Caçamba" suffix="t/passe" step={0.5} value={m.bucketT} onChange={(v) => setMovement(m.id, { bucketT: v })} />
                        <Num label="Tempo do passe" suffix="min" step={0.05} value={m.passMin} onChange={(v) => setMovement(m.id, { passMin: v })} />
                        <Num label="Posicionamento" suffix="min" step={0.1} value={m.loadSpotMin} onChange={(v) => setMovement(m.id, { loadSpotMin: v })} />
                        <Num label="DF da carga" suffix="%" value={m.loaderDf} onChange={(v) => setMovement(m.id, { loaderDf: v })} />
                        <Num label="Pontos de descarga" value={m.dumpStations} onChange={(v) => setMovement(m.id, { dumpStations: Math.max(1, Math.round(v)) })} />
                        <div>
                          <label className="mb-1 block text-xs text-black/55">Balança</label>
                          <select className={inputCls} value={m.weighing ? 'sim' : 'nao'} onChange={(e) => setMovement(m.id, { weighing: e.target.value === 'sim' })}>
                            <option value="sim">Sim</option>
                            <option value="nao">Não</option>
                          </select>
                        </div>
                        {m.weighing && <Num label="Pesagem" suffix="min" step={0.1} value={m.weighMin} onChange={(v) => setMovement(m.id, { weighMin: v })} />}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </Card>
      </fieldset>

      {/* --------------------------- frota por período --------------------------- */}
      <Card
        title="Frota por período"
        description="Para cada período, a simulação acha o menor nº de caminhões de cada movimentação que cumpre a meta diária, com filas e quebras."
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <fieldset className="text-xs text-black/55">
              <legend className="mb-1">Configurações</legend>
              <div className="flex flex-wrap gap-2">
                {model.configs.map((c) => (
                  <label key={c.id} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2 py-1.5 text-sm text-black">
                    <input type="checkbox" checked={cfgIds.includes(c.id)} onChange={(e) => setCfgIds(e.target.checked ? [...cfgIds, c.id] : cfgIds.filter((x) => x !== c.id))} />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-xs text-black/55">
              Cenário
              <select className={clsx(inputCls, 'mt-1 w-48')} value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                {model.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <Btn onClick={() => void runSizing()} busy={busy?.what === 'frota'} disabled={!plan.movements.length || !cfgIds.length || !model.routes.length}>
              <Play size={15} /> Dimensionar
            </Btn>
          </div>
        }
      >
        {!results ? (
          <p className="text-sm text-black/50">Preencha lugares e movimentações e clique em Dimensionar. Horas por dia vêm do calendário acima; disponibilidade, eficiência e variabilidade, do cenário escolhido.</p>
        ) : (
          <FleetByPeriod results={results} model={model} plan={plan} onExport={exportResults} onPick={setPeriod} />
        )}
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Resultado: gráfico e tabela                                                */
/* -------------------------------------------------------------------------- */

const FleetByPeriod: React.FC<{ results: PeriodResult[]; model: SimModel; plan: MinePlan; onExport: () => void; onPick: (p: number) => void }> = ({ results, model, plan, onExport, onPick }) => {
  const cfgs = [...new Set(results.map((r) => r.configId))];
  const periods = [...new Set(results.map((r) => r.period))].sort((a, b) => a - b);
  const [hover, setHover] = useState<{ p: number; c: string } | null>(null);
  const [detail, setDetail] = useState<string>(cfgs[0]);
  const max = Math.max(1, ...results.map((r) => r.trucks));
  const W = 760;
  const H = 260;
  const m = { l: 36, r: 12, t: 16, b: 34 };
  const gw = (W - m.l - m.r) / Math.max(1, periods.length);
  const bw = Math.min(22, (gw - 6) / cfgs.length);
  const ymax = Math.ceil(max / 2) * 2 + 2;
  const y = (v: number) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const name = (id: string) => model.configs.find((c) => c.id === id)?.name ?? id;
  const hr = hover ? results.find((r) => r.period === hover.p && r.configId === hover.c) : null;
  const ticks = Array.from({ length: ymax / 2 + 1 }, (_, i) => i * 2);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 text-xs text-black/60">
        {cfgs.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONFIG_COLORS[i % CONFIG_COLORS.length] }} />
            {name(c)}: pico de {Math.max(...results.filter((r) => r.configId === c).map((r) => r.trucks))} caminhões · média de {n1(results.filter((r) => r.configId === c && r.trucks > 0).reduce((a, r, _, l) => a + r.trucksExact / l.length, 0))} sem arredondar
          </span>
        ))}
        <button type="button" onClick={onExport} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1 font-medium text-black hover:bg-black/[0.03]">
          <Download size={13} /> Exportar (Excel)
        </button>
      </div>
      <figure className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Caminhões necessários por período">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="#000" strokeOpacity={v ? 0.06 : 0.25} />
              <text x={m.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#6b6a65">{v}</text>
            </g>
          ))}
          {periods.map((p, pi) => {
            const x0 = m.l + pi * gw + (gw - bw * cfgs.length) / 2;
            return (
              <g key={p}>
                {cfgs.map((c, ci) => {
                  const r = results.find((x) => x.period === p && x.configId === c);
                  if (!r) return null;
                  const active = hover?.p === p && hover?.c === c;
                  return (
                    <g key={c} onMouseEnter={() => setHover({ p, c })} onMouseLeave={() => setHover(null)} onClick={() => onPick(p)} style={{ cursor: 'pointer' }}>
                      <rect x={x0 + ci * bw + 1} y={y(r.trucks)} width={bw - 2} height={Math.max(0, y(0) - y(r.trucks))} rx={3} fill={CONFIG_COLORS[ci % CONFIG_COLORS.length]} opacity={hover && !active ? 0.55 : 1} />
                      {!r.ok && <text x={x0 + ci * bw + bw / 2} y={y(r.trucks) - 4} textAnchor="middle" fontSize={11} fill="#b42318" fontWeight={700}>!</text>}
                    </g>
                  );
                })}
                <text x={m.l + pi * gw + gw / 2} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill="#6b6a65">
                  {plan.periods[p - 1]?.label.replace(/^Ano\s*/i, '') ?? p}
                </text>
              </g>
            );
          })}
          <text x={(W + m.l) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="#6b6a65">período</text>
        </svg>
        {hr && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-lg bg-[#151619] px-3 py-2 text-xs text-white shadow-lg">
            <p className="font-semibold">{hr.label} · {name(hr.configId)}</p>
            <p className="tabular-nums">{hr.trucks} caminhões ({n1(hr.trucksExact)} sem arredondar) · {t0(hr.hoursPerTruck)} h por caminhão</p>
            {hr.circuits.map((c) => (
              <p key={c.circuitId} className="tabular-nums text-white/75">{c.name}: {c.trucks} ({t0(c.lengthM)} m)</p>
            ))}
          </div>
        )}
        <figcaption className="mt-1 text-xs text-black/50">Caminhões necessários em cada período. “!” = alguma movimentação não atinge a meta nem com mais caminhões (gargalo na carga ou na descarga). Clique numa barra para ver o período no mapa.</figcaption>
      </figure>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Detalhe</span>
          {cfgs.map((c) => (
            <button key={c} type="button" onClick={() => setDetail(c)} className={clsx('rounded-lg px-2.5 py-1 text-sm', detail === c ? 'bg-[#151619] text-white' : 'border border-black/10 hover:bg-black/[0.03]')}>
              {name(c)}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-black/[0.06] text-left text-xs text-black/45">
                <th className="py-2 pr-2 font-medium">Período</th>
                <th className="py-2 pr-2 text-right font-medium">Caminhões</th>
                <th className="py-2 pr-2 text-right font-medium">Sem arredondar</th>
                <th className="py-2 pr-2 text-right font-medium">Equip. de carga</th>
                <th className="py-2 pr-2 text-right font-medium">h/caminhão</th>
                <th className="py-2 font-medium">Por movimentação (caminhões · distância · simulado/meta t/dia)</th>
              </tr>
            </thead>
            <tbody>
              {results.filter((r) => r.configId === detail).map((r) => (
                <tr key={r.period} className="border-b border-black/[0.04] align-top">
                  <td className="py-2 pr-2 font-medium">{r.label}</td>
                  <td className={clsx('py-2 pr-2 text-right font-semibold tabular-nums', !r.ok && 'text-red-700')}>{r.trucks}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-black/55">{n1(r.trucksExact)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.loaders}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{t0(r.hoursPerTruck)}</td>
                  <td className="py-2 text-xs">
                    {r.circuits.map((c) => (
                      <span key={c.circuitId} className={clsx('mr-3 inline-block', c.saturated && 'text-red-700')}>
                        {c.name}: <b>{c.trucks}</b> · {t0(c.lengthM)} m · {t0(c.achievedTpd)}/{t0(c.targetTpd)}
                        {c.saturated && ' (gargalo)'}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-black/45">
          Cada movimentação ativa recebe ao menos 1 caminhão, e não existe fração de caminhão: por isso o simulado fica acima da meta. “Sem arredondar” mostra a necessidade real e serve para comparar configurações (caminhões podem ser compartilhados entre movimentações pequenas). h/caminhão = horas trabalhadas por caminhão no período (base para vida útil e desgaste).
        </p>
      </div>
    </div>
  );
};

export default PlanView;
