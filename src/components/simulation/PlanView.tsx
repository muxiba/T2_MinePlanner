import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Download, FileUp, Layers, MapPin, Play, Plus, Trash2, Upload } from 'lucide-react';
import type { SimModel } from '@/sim/types';
import type { DetailedPremises } from '@/types';
import { PERIOD_KINDS, MONTH_NAMES, flatCalendar, flowWetTonnes, generateMovements, hoursBreakdown, linkOn, rainyCalendar, suggestedRomT, syncPeriods, type PeriodKind } from '@/sim/link';
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
import type { LayerInfo, ParsedFrontArea, ParsedSolid } from '@/sim/planParse';
import { periodFromName } from '@/sim/planParse';
import { runInWorker } from '@/sim/client';
import type { Contours } from '@/sim/terrain';
import MapCanvas, { type MapOverlays, type TerrainLayer } from './MapCanvas';
import View3D from './View3D';
import { periodDem, type Dem } from '@/sim/dem';
import { Btn, Card, Num, Progress, inputCls, n1, t0 } from './ui';

/** Cores das frentes (paleta categórica validada) e do rejeito. */
const FRONT_COLORS = ['#2a78d6', '#1baf7a', '#e87ba4', '#eda100', '#8a5cd6'];
const SOLID_COLOR = '#eb6834';
const CONFIG_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

const NONE = '__nenhuma__';

interface ImportSetup {
  kind: 'fronts' | 'solids';
  files: File[];
  layers: (LayerInfo & { files: number })[];
  /** arquivo = um arquivo por período; camada = um arquivo com uma camada por período */
  mode: 'arquivo' | 'camada';
  fileRows: { file: File; period: number }[];
  layerRows: { layer: string; period: number }[];
  areaLayer: string;
  floorLayer: string;
  solidLayer: string;
}

const mt = (t: number) => (t / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ha = (m2: number) => (m2 / 1e4).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

interface Props {
  dem?: Dem | null;
  model: SimModel;
  setModel: (m: SimModel) => void;
  canEdit: boolean;
  terrain: TerrainLayer | null;
  contours: Contours | null;
  results: PeriodResult[] | null;
  setResults: (r: PeriodResult[] | null) => void;
  onError: (msg: string | null) => void;
  premises?: DetailedPremises;
}

const PlanView: React.FC<Props> = ({ dem, model, setModel, canEdit, terrain, contours, results, setResults, onError, premises }) => {
  const plan: MinePlan = model.plan ?? emptyPlan();
  // dias trabalhados de cada período acompanham o tipo do período e o calendário
  const setPlan = (p: MinePlan) => setModel({ ...model, plan: syncPeriods(p) });
  const linked = !!premises && linkOn(model);
  /** troca o calendário: períodos sem tipo seguem o ano do calendário; os demais, o próprio tipo */
  const applyCalendar = (calendar: MinePlan['calendar']) => {
    const wd = calendarWorkDays(calendar);
    setPlan({ ...plan, calendar, periods: plan.periods.map((p) => (p.kind ? p : { ...p, workDays: wd })) });
  };
  const setPeriodRow = (i: number, patch: Partial<MinePlan['periods'][number]>) => setPlan({ ...plan, periods: plan.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const [period, setPeriod] = useState(1);
  const [show3d, setShow3d] = useState(false);
  const dem3d = useMemo(() => (show3d && dem ? periodDem(dem, model.plan, period) : null), [show3d, dem, model.plan, period]);
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
  const [setup, setSetup] = useState<ImportSetup | null>(null);

  /** Primeiro passo: lê as camadas dos arquivos e abre a conferência (períodos e camadas). */
  const startImport = async (kind: 'fronts' | 'solids', list: FileList) => {
    onError(null);
    const files = Array.from(list);
    const dwg = files.filter((f) => /\.dwg$/i.test(f.name));
    const dxf = files.filter((f) => !/\.dwg$/i.test(f.name));
    setWarnings(dwg.map((f) => `${f.name}: o navegador não lê DWG. No CAD, use "Salvar como" → DXF.`));
    if (!dxf.length) return;
    const merged = new Map<string, LayerInfo & { files: number }>();
    for (let i = 0; i < dxf.length; i++) {
      setBusy({ what: 'camadas', f: i / dxf.length, stage: dxf[i].name });
      try {
        const ls = await runInWorker<LayerInfo[]>({ kind: 'dxfLayers', file: dxf[i] }, (x) => setBusy({ what: 'camadas', f: (i + x) / dxf.length, stage: dxf[i].name }));
        for (const l of ls) {
          const m = merged.get(l.layer);
          if (m) {
            m.polylines += l.polylines; m.closed += l.closed; m.points += l.points; m.faces += l.faces; m.files++;
          } else merged.set(l.layer, { ...l, files: 1 });
        }
      } catch (e) {
        setWarnings((w) => [...w, `${dxf[i].name}: ${e instanceof Error ? e.message : String(e)}`]);
      }
    }
    setBusy(null);
    const layers = [...merged.values()].filter((l) => (kind === 'solids' ? l.faces > 0 : l.polylines + l.points > 0));
    if (!layers.length) {
      setWarnings((w) => [...w, kind === 'solids' ? 'Nenhuma face 3DFACE encontrada nos arquivos.' : 'Nenhuma polilinha ou ponto encontrado nos arquivos.']);
      return;
    }
    const numbered = layers.filter((l) => periodFromName(l.layer) !== null);
    const mode: ImportSetup['mode'] = dxf.length === 1 && numbered.length >= 2 ? 'camada' : 'arquivo';
    setSetup({
      kind,
      files: dxf,
      layers,
      mode,
      fileRows: dxf.map((f, i) => ({ file: f, period: periodFromName(f.name) ?? i + 1 })),
      layerRows: layers.map((l) => ({ layer: l.layer, period: periodFromName(l.layer) ?? 0 })),
      areaLayer: '',
      floorLayer: '',
      solidLayer: '',
    });
  };

  /** Segundo passo: importa com as escolhas do usuário. */
  const runImport = async (st: ImportSetup) => {
    setSetup(null);
    const jobs: { file: File; period: number; layer?: string; label: string }[] =
      st.mode === 'arquivo'
        ? st.fileRows.filter((r) => r.period > 0).map((r) => ({ file: r.file, period: r.period, label: r.file.name }))
        : st.layerRows.filter((r) => r.period > 0).map((r) => ({ file: st.files[0], period: r.period, layer: r.layer, label: r.layer }));
    const msgs: string[] = [];
    const floorLayers = st.floorLayer === '' ? undefined : st.floorLayer === NONE ? [] : [st.floorLayer];
    if (st.kind === 'fronts') {
      const fronts: FrontArea[] = [...plan.fronts];
      const replaced = new Set<number>();
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        setBusy({ what: 'frentes', f: i / jobs.length, stage: j.label });
        try {
          const areaLayers = j.layer ? [j.layer] : st.areaLayer ? [st.areaLayer] : undefined;
          const areas = await runInWorker<ParsedFrontArea[]>({ kind: 'planFronts', file: j.file, opts: { areaLayers, floorLayers } }, (x) => setBusy({ what: 'frentes', f: (i + x) / jobs.length, stage: j.label }));
          if (!replaced.has(j.period)) {
            for (let k = fronts.length - 1; k >= 0; k--) if (fronts[k].period === j.period) fronts.splice(k, 1);
            replaced.add(j.period);
          }
          if (!areas.length) msgs.push(`${j.label}: nada encontrado. Escolha a camada do contorno (ou dos pontos de carga).`);
          areas.forEach((a, n) => fronts.push({ id: `f${j.period}-${n}-${i}-${Date.now().toString(36)}`, period: j.period, front: frontNames[0] ?? '', ring: a.ring, areaM2: a.areaM2, z: a.z, zMin: a.zMin, zMax: a.zMax, lx: a.lx, ly: a.ly, file: j.label }));
        } catch (e) {
          msgs.push(`${j.label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setBusy(null);
      setWarnings(msgs);
      const maxPer = Math.max(nPer, ...fronts.map((f) => f.period));
      setPlan(reassign({ ...withPeriods(plan, maxPer), fronts }));
    } else {
      const solids = [...plan.solids];
      const replaced = new Set<number>();
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        setBusy({ what: 'sólidos', f: i / jobs.length, stage: j.label });
        try {
          const layers = j.layer ? [j.layer] : st.solidLayer ? [st.solidLayer] : undefined;
          const sd = await runInWorker<ParsedSolid>({ kind: 'planSolid', file: j.file, layers }, (x) => setBusy({ what: 'sólidos', f: (i + x) / jobs.length, stage: j.label }));
          if (!replaced.has(j.period)) {
            for (let k = solids.length - 1; k >= 0; k--) if (solids[k].period === j.period) solids.splice(k, 1);
            replaced.add(j.period);
          }
          solids.push({ id: `s${j.period}-${i}-${Date.now().toString(36)}`, period: j.period, name: `Sólido ${plan.periods[j.period - 1]?.label ?? `período ${j.period}`}`, volumeM3: sd.volumeM3, hull: sd.hull, cx: sd.cx, cy: sd.cy, zMin: sd.zMin, zMax: sd.zMax, faces: sd.faces, top: sd.top ?? undefined, file: j.label });
        } catch (e) {
          msgs.push(`${j.label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setBusy(null);
      setWarnings(msgs);
      const maxPer = Math.max(nPer, ...solids.map((x) => x.period));
      let next = { ...withPeriods(plan, maxPer), solids: solids.sort((a, b) => a.period - b.period) };
      if (!next.places.some((p) => p.kind === 'rejeito') && solids.length) {
        const s0 = solids[0];
        next = { ...next, places: [...next.places, { id: `p-rej-${Date.now().toString(36)}`, name: 'Disposição (sólidos)', kind: 'rejeito', x: s0.cx, y: s0.cy, z: (s0.zMin + s0.zMax) / 2 }] };
      }
      setPlan(next);
    }
  };

  /* ------------------------------ períodos ------------------------------ */
  function withPeriods(p: MinePlan, n: number): MinePlan {
    const wd = calendarWorkDays(p.calendar);
    const last = p.periods[p.periods.length - 1];
    const kind: PeriodKind = last?.kind ?? 'ano';
    const name = kind === 'mes' ? 'Mês' : kind === 'quinquenio' ? 'Quinquênio' : kind === 'dias' ? 'Período' : 'Ano';
    const periods = Array.from({ length: n }, (_, i) => p.periods[i] ?? { label: `${name} ${i + 1}`, workDays: wd, kind, days: last?.days });
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
  const [scenIds, setScenIds] = useState<string[]>([model.scenarios[0]?.id ?? 's1']);
  const [aging, setAging] = useState(true);
  const runSizing = async () => {
    onError(null);
    setBusy({ what: 'frota', f: 0 });
    try {
      const res = await runInWorker<PeriodResult[]>({ kind: 'periods', model: { ...model, plan }, configIds: cfgIds, scenarioIds: scenIds, aging }, (f, stage) => setBusy({ what: 'frota', f, stage }));
      setResults(res);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const exportResults = () => {
    if (!results) return;
    const head = ['Configuração', 'Cenário', 'Período', 'Circuito', 'Material', 't no período', 'Meta t/dia', 'Simulado t/dia', 'Caminhões', 'Distância (m)', 'Desnível (m)', 'Carga em', 'Descarga em'];
    const dec = (n: number, d = 0) => n.toFixed(d).replace('.', ',');
    const rows = results.flatMap((r) =>
      r.circuits.map((c) => [model.configs.find((x) => x.id === r.configId)?.name ?? r.configId, model.scenarios.find((x) => x.id === r.scenarioId)?.name ?? '', r.label, c.name, c.material, dec(c.tonnes), dec(c.targetTpd), dec(c.achievedTpd), String(c.trucks), dec(c.lengthM), dec(c.dz, 1), c.originLabel, c.destLabel]),
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
        <div className="mb-3 flex gap-1 rounded-lg bg-black/[0.04] p-1 text-sm" role="group" aria-label="Tipo de vista">
          {[false, true].map((v) => (
            <button key={String(v)} type="button" onClick={() => setShow3d(v)} className={clsx('rounded-md px-3 py-1', show3d === v ? 'bg-white font-semibold shadow-sm' : 'text-black/55')}>
              {v ? '3D (topografia do período)' : '2D'}
            </button>
          ))}
        </div>
        {show3d ? (
          <View3D dem={dem3d} routes={model.routes.map((r) => ({ points: r.points, color: '#8a8984' }))} overlays={overlays} height={520} />
        ) : (
          <MapCanvas terrain={terrain} contours={contours} routes={model.routes} routesAsNetwork overlays={overlays} height={500} />
        )}
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

      {setup && <ImportPanel setup={setup} setSetup={setSetup} periods={plan.periods.map((p) => p.label)} onRun={(st) => void runImport(st)} />}
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
          <Card title="Frentes de lavra por período (DXF)" description="Um arquivo por período ou um arquivo com uma camada por período. Contornos de área ou simples pontos de carga; você confere período e camadas antes de importar.">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
              <Layers size={16} /> Importar frentes
              <input type="file" accept=".dxf" multiple className="sr-only" onChange={(e) => { if (e.target.files) void startImport('fronts', e.target.files); e.target.value = ''; }} />
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
          <Card title="Destinos com sólido por período (DXF)" description="Rejeito, estéril, PDE, pilha… Sólidos 3DFACE por período (um arquivo ou uma camada por período). Calcula volume, posição e cotas.">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black">
              <Upload size={16} /> Importar sólidos
              <input type="file" accept=".dxf,.dwg" multiple className="sr-only" onChange={(e) => { if (e.target.files) void startImport('solids', e.target.files); e.target.value = ''; }} />
            </label>
            {plan.solids.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Num label="Densidade no destino" suffix="t/m³" step={0.01} value={plan.disposalDensity} onChange={(v) => setPlan({ ...plan, disposalDensity: v })} />
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
        <Card title="Calendário e períodos" description="Dias trabalháveis por mês (clique em seco/chuva para marcar a estação). A meta diária de cada período = toneladas ÷ dias trabalháveis.">
          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-black/45">
                    <th className="py-1 pr-2 font-medium">Mês</th>
                    {plan.calendar.map((m, i) => (
                      <th key={i} className="py-1 pr-1 text-center font-medium" title={m.month}>{(MONTH_NAMES[i] ?? m.month).slice(0, 3)}</th>
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
                          className={clsx(inputCls, 'min-w-[46px] px-1 text-center')}
                          value={m.workDays}
                          aria-label={`Dias trabalháveis do mês ${i + 1}`}
                          onChange={(e) => {
                            applyCalendar(plan.calendar.map((x, j) => (j === i ? { ...x, workDays: Math.max(0, Math.min(x.days, Number(e.target.value))) } : x)));
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
              {linked ? (
                <div>
                  <label className="mb-1 block text-xs text-black/55">Horas de operação/dia</label>
                  <p className="rounded-lg bg-black/[0.04] px-3 py-2 text-sm tabular-nums" title="Horas contratadas da mina, nas Premissas Fundamentais">{n1(premises!.contractedHoursMina)} h <span className="text-xs text-black/45">das premissas</span></p>
                </div>
              ) : (
                <Num label="Horas de operação/dia" value={plan.hoursPerDay} onChange={(v) => setPlan({ ...plan, hoursPerDay: Math.max(1, Math.min(24, v)) })} />
              )}
              <Num label="Fator de pico da meta" step={0.05} value={plan.peakFactor} onChange={(v) => setPlan({ ...plan, peakFactor: Math.max(0.5, v) })} />
              <Num label="Rampa máx. dos acessos" suffix="%" step={0.5} value={plan.rampMaxGrade} onChange={(v) => setPlan({ ...plan, rampMaxGrade: Math.max(2, v) })} />
              <Num label="Sinuosidade dos acessos" step={0.05} value={plan.accessTortuosity} onChange={(v) => setPlan({ ...plan, accessTortuosity: Math.max(1, v) })} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn tone="light" onClick={() => applyCalendar(flatCalendar())}>Sem estação chuvosa (26 dias/mês)</Btn>
            <Btn tone="light" onClick={() => applyCalendar(rainyCalendar())}>Com estação chuvosa (jan–mar e out–dez com 20 dias)</Btn>
          </div>
          <p className="mt-2 text-xs text-black/45">
            Os dias trabalhados de cada mês são editáveis; ao mudar o calendário, todos os períodos e a simulação são recalculados. Fator de pico 1 = média do período (use, por exemplo, 1,3 para dimensionar pelo mês chuvoso).
          </p>
          <PeriodsTable plan={plan} premises={premises} linked={linked} setPeriodRow={setPeriodRow} setAll={(kind) => setPlan({ ...plan, periods: plan.periods.map((p, i) => ({ ...p, kind, label: kindName(kind) + ' ' + (i + 1) })) })} />
        </Card>

        {/* --------------------------- movimentações --------------------------- */}
        <Card
          title="Movimentações por período"
          description="Toneladas úmidas de cada origem para cada destino em cada período. “Calcular pelas premissas” preenche pela meta de ROM de cada período; depois edite aqui, cole do Excel ou exporte o CSV, trabalhe e importe de volta."
          actions={
            <div className="flex flex-wrap gap-2">
              {premises && (
                <Btn
                  onClick={() => {
                    const r = generateMovements(plan, premises, () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
                    setWarnings(r.warnings);
                    if (r.plan !== plan) setPlan(reassign(r.plan));
                  }}
                  title="ROM das frentes para a usina, produto para o terminal e rejeito filtrado para a disposição, pela meta de ROM de cada período e pelas premissas"
                >
                  <Play size={15} /> Calcular pelas premissas
                </Btn>
              )}
              <Btn tone="light" onClick={exportCsv} disabled={!plan.movements.length}>
                <Download size={15} /> Exportar modelo CSV
              </Btn>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-semibold hover:bg-black/[0.03]">
                <FileUp size={15} /> Importar CSV
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
            <fieldset className="text-xs text-black/55">
              <legend className="mb-1">Cenários</legend>
              <div className="flex flex-wrap gap-2">
                {model.scenarios.map((sc) => (
                  <label key={sc.id} className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2 py-1.5 text-sm text-black">
                    <input type="checkbox" checked={scenIds.includes(sc.id)} onChange={(e) => setScenIds(e.target.checked ? [...scenIds, sc.id] : scenIds.filter((x) => x !== sc.id))} />
                    {sc.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-1.5 text-sm" title="A disponibilidade cai com a idade da frota (aba Financeiro)">
              <input type="checkbox" checked={aging} onChange={(e) => setAging(e.target.checked)} /> Desgaste da frota
            </label>
            <Btn onClick={() => void runSizing()} busy={busy?.what === 'frota'} disabled={!plan.movements.length || !cfgIds.length || !scenIds.length || !model.routes.length}>
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
/* Conferência da importação: períodos e camadas                              */
/* -------------------------------------------------------------------------- */

const ImportPanel: React.FC<{ setup: ImportSetup; setSetup: (s: ImportSetup | null) => void; periods: string[]; onRun: (s: ImportSetup) => void }> = ({ setup: st, setSetup, periods, onRun }) => {
  const set = (patch: Partial<ImportSetup>) => setSetup({ ...st, ...patch });
  const fronts = st.kind === 'fronts';
  const layerLabel = (l: ImportSetup['layers'][number]) =>
    `${l.layer} (${fronts ? `${l.polylines} linhas${l.closed ? `, ${l.closed} fechadas` : ''}${l.points ? `, ${l.points} pontos` : ''}` : `${l.faces} faces`})`;
  const rows = st.mode === 'arquivo' ? st.fileRows.length : st.layerRows.filter((r) => r.period > 0).length;
  return (
    <section className="rounded-2xl border-2 border-emerald-600/40 bg-white p-5" aria-label="Conferir importação">
      <header className="mb-4">
        <h3 className="font-semibold">{fronts ? 'Importar frentes' : 'Importar sólidos'}: confira antes</h3>
        <p className="mt-0.5 text-sm text-black/50">
          Diga como os períodos estão organizados e quais camadas usar. Os nomes podem ser quaisquer: o número do período é sugerido a partir do nome, e você corrige se precisar.
        </p>
      </header>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <fieldset>
            <legend className="mb-1 text-xs text-black/55">Organização</legend>
            <div className="flex flex-wrap gap-2">
              <label className={clsx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', st.mode === 'arquivo' ? 'border-emerald-600 bg-emerald-50' : 'border-black/10')}>
                <input type="radio" checked={st.mode === 'arquivo'} onChange={() => set({ mode: 'arquivo' })} /> Um arquivo por período
              </label>
              <label className={clsx('flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', st.mode === 'camada' ? 'border-emerald-600 bg-emerald-50' : 'border-black/10', st.files.length > 1 && 'opacity-50')}>
                <input type="radio" disabled={st.files.length > 1} checked={st.mode === 'camada'} onChange={() => set({ mode: 'camada' })} /> Um arquivo, uma camada por período
              </label>
            </div>
          </fieldset>
          {st.mode === 'arquivo' && (
            <>
              <label className="block text-xs text-black/55">
                {fronts ? 'Camada do contorno da área (ou dos pontos de carga)' : 'Camada do sólido'}
                <select className={clsx(inputCls, 'mt-1')} value={fronts ? st.areaLayer : st.solidLayer} onChange={(e) => set(fronts ? { areaLayer: e.target.value } : { solidLayer: e.target.value })}>
                  <option value="">Automático{fronts ? ' (Boundary/Limite/Contorno ou polilinhas fechadas)' : ' (todas as faces)'}</option>
                  {st.layers.map((l) => (
                    <option key={l.layer} value={l.layer}>{layerLabel(l)}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {fronts && (
            <label className="block text-xs text-black/55">
              Camada com a cota do piso (opcional)
              <select className={clsx(inputCls, 'mt-1')} value={st.floorLayer} onChange={(e) => set({ floorLayer: e.target.value })}>
                <option value="">Automático (camadas com “toe”, “pé” ou “piso”)</option>
                <option value={NONE}>Nenhuma: usar a cota do próprio contorno/ponto</option>
                {st.layers.filter((l) => l.polylines + l.points > 0).map((l) => (
                  <option key={l.layer} value={l.layer}>{layerLabel(l)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto rounded-xl border border-black/[0.06]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-black/45">
                <th className="px-3 py-1.5 font-medium">{st.mode === 'arquivo' ? 'Arquivo' : 'Camada'}</th>
                <th className="w-40 px-3 py-1.5 font-medium">Período</th>
              </tr>
            </thead>
            <tbody>
              {st.mode === 'arquivo'
                ? st.fileRows.map((r, i) => (
                    <tr key={i} className="border-t border-black/5">
                      <td className="px-3 py-1 text-xs">{r.file.name}</td>
                      <td className="px-3 py-1">
                        <PeriodSelect value={r.period} periods={periods} onChange={(v) => set({ fileRows: st.fileRows.map((x, j) => (j === i ? { ...x, period: v } : x)) })} />
                      </td>
                    </tr>
                  ))
                : st.layerRows.map((r, i) => (
                    <tr key={r.layer} className="border-t border-black/5">
                      <td className="px-3 py-1 text-xs">{layerLabel(st.layers.find((l) => l.layer === r.layer)!)}</td>
                      <td className="px-3 py-1">
                        <PeriodSelect value={r.period} periods={periods} allowNone onChange={(v) => set({ layerRows: st.layerRows.map((x, j) => (j === i ? { ...x, period: v } : x)) })} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Btn onClick={() => onRun(st)} disabled={!rows}>
          Importar {rows} {st.mode === 'arquivo' ? (rows === 1 ? 'arquivo' : 'arquivos') : rows === 1 ? 'camada' : 'camadas'}
        </Btn>
        <Btn tone="light" onClick={() => setSetup(null)}>Cancelar</Btn>
        <span className="text-xs text-black/45">Períodos além dos existentes são criados automaticamente. Importar de novo um período substitui o anterior.</span>
      </div>
    </section>
  );
};

const PeriodSelect: React.FC<{ value: number; periods: string[]; onChange: (v: number) => void; allowNone?: boolean }> = ({ value, periods, onChange, allowNone }) => {
  const n = Math.max(periods.length, value, 1) + 5;
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Período">
      {allowNone && <option value={0}>Não importar</option>}
      {Array.from({ length: n }, (_, i) => (
        <option key={i} value={i + 1}>{periods[i] ?? `Período ${i + 1}`}</option>
      ))}
    </select>
  );
};

/* -------------------------------------------------------------------------- */
/* Resultado: gráfico e tabela                                                */
/* -------------------------------------------------------------------------- */

const FleetByPeriod: React.FC<{ results: PeriodResult[]; model: SimModel; plan: MinePlan; onExport: () => void; onPick: (p: number) => void }> = ({ results, model, plan, onExport, onPick }) => {
  const keyOf = (r: PeriodResult) => `${r.configId}|${r.scenarioId ?? ''}`;
  const cfgs = [...new Set(results.map(keyOf))];
  const multiScen = new Set(results.map((r) => r.scenarioId)).size > 1;
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
  const name = (k: string) => {
    const [cid, sid] = k.split('|');
    const c = model.configs.find((x) => x.id === cid)?.name ?? cid;
    return multiScen ? `${c} · ${model.scenarios.find((x) => x.id === sid)?.name ?? sid}` : c;
  };
  const hr = hover ? results.find((r) => r.period === hover.p && keyOf(r) === hover.c) : null;
  const ticks = Array.from({ length: ymax / 2 + 1 }, (_, i) => i * 2);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4 text-xs text-black/60">
        {cfgs.map((c, i) => (
          <span key={c} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CONFIG_COLORS[i % CONFIG_COLORS.length] }} />
            {name(c)}: pico de {Math.max(...results.filter((r) => keyOf(r) === c).map((r) => r.trucks))} caminhões · média de {n1(results.filter((r) => keyOf(r) === c && r.trucks > 0).reduce((a, r, _, l) => a + r.trucksExact / l.length, 0))} sem arredondar
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
                  const r = results.find((x) => x.period === p && keyOf(x) === c);
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
            <p className="font-semibold">{hr.label} · {name(keyOf(hr))}</p>
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
                <th className="py-2 pr-2 text-right font-medium">DF · idade média</th>
                <th className="py-2 font-medium">Por movimentação (caminhões · distância · simulado/meta t/dia)</th>
              </tr>
            </thead>
            <tbody>
              {results.filter((r) => keyOf(r) === detail).map((r) => (
                <tr key={r.period} className="border-b border-black/[0.04] align-top">
                  <td className="py-2 pr-2 font-medium">{r.label}</td>
                  <td className={clsx('py-2 pr-2 text-right font-semibold tabular-nums', !r.ok && 'text-red-700')}>{r.trucks}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-black/55">{n1(r.trucksExact)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.loaders}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{t0(r.hoursPerTruck)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-black/55">{r.truckDf !== undefined ? `${n1(r.truckDf)}% · ${t0(r.avgAgeH ?? 0)} h` : '—'}</td>
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

/* -------------------------------------------------------------------------- */
/* Períodos: duração, meta de ROM e horas                                     */
/* -------------------------------------------------------------------------- */

const kindName = (k: PeriodKind) => (k === 'mes' ? 'Mês' : k === 'quinquenio' ? 'Quinquênio' : k === 'dias' ? 'Período' : 'Ano');

const HOUR_PARTS: { key: 'productive' | 'stops' | 'maintenance' | 'offShift' | 'notWorked'; label: string; color: string }[] = [
  { key: 'productive', label: 'Produtivas', color: '#059669' },
  { key: 'stops', label: 'Paradas operacionais (UF)', color: '#eda100' },
  { key: 'maintenance', label: 'Manutenção (DF)', color: '#dc2626' },
  { key: 'offShift', label: 'Fora do turno', color: '#94a3b8' },
  { key: 'notWorked', label: 'Dias não trabalhados (chuva, folgas)', color: '#bae6fd' },
];

const PeriodsTable: React.FC<{
  plan: MinePlan;
  premises?: DetailedPremises;
  linked: boolean;
  setPeriodRow: (i: number, patch: Partial<MinePlan['periods'][number]>) => void;
  setAll: (k: PeriodKind) => void;
}> = ({ plan, premises, linked, setPeriodRow, setAll }) => {
  const [sel, setSel] = useState(0);
  const df = premises?.dfMina ?? 85;
  const uf = premises?.ufMina ?? 85;
  const hpd = linked && premises ? premises.contractedHoursMina || plan.hoursPerDay : plan.hoursPerDay;
  const rows = plan.periods.map((p) => {
    const kind = p.kind ?? 'ano';
    const calDays = p.calendarDays ?? (kind === 'ano' ? 365 : p.workDays);
    const romT = p.romT ?? (premises ? suggestedRomT(premises, kind, p.days) : 0);
    const h = hoursBreakdown(calDays, p.workDays, hpd, df, uf);
    const f = premises ? flowWetTonnes(premises, romT) : null;
    return { p, kind, calDays, romT, h, f };
  });
  const s = rows[Math.min(sel, rows.length - 1)];
  const rm = premises ? (premises.processType === 'seco' ? 100 : premises.rmGlobal) / 100 : 0;
  const rej = premises ? (premises.processType === 'seco' ? 0 : premises.rejeitoTotal) / 100 : 0;
  return (
    <div className="mt-5 border-t border-black/5 pt-4">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Períodos simulados</p>
          <p className="text-xs text-black/50">Cada período tem uma duração e uma meta de ROM. Sem meta informada, usa o consumo mensal das premissas × meses do período.</p>
        </div>
        <label className="text-xs text-black/55">
          Duração de todos
          <select className={clsx(inputCls, 'mt-1 w-44')} value="" onChange={(e) => e.target.value && setAll(e.target.value as PeriodKind)}>
            <option value="">escolher…</option>
            {PERIOD_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="max-h-96 overflow-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left text-xs text-black/45">
              <th className="py-1 pr-2 font-medium">Período</th>
              <th className="py-1 pr-2 font-medium">Duração</th>
              <th className="py-1 pr-2 text-right font-medium">Dias corridos</th>
              <th className="py-1 pr-2 text-right font-medium">Dias trabalhados</th>
              <th className="py-1 pr-2 text-right font-medium">Meta de ROM (t seca)</th>
              <th className="py-1 pr-2 text-right font-medium">Produto (t seca)</th>
              <th className="py-1 pr-2 text-right font-medium">Rejeito (t seca)</th>
              <th className="py-1 text-right font-medium">Horas produtivas / caminhão</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, kind, calDays, romT, h }, i) => (
              <tr key={i} className={clsx('border-t border-black/5', i === sel && 'bg-emerald-50/60')} onClick={() => setSel(i)}>
                <td className="py-1 pr-2">
                  <input className={clsx(inputCls, 'w-32')} value={p.label} onChange={(e) => setPeriodRow(i, { label: e.target.value })} aria-label="Nome do período" />
                </td>
                <td className="py-1 pr-2">
                  <div className="flex gap-1">
                    <select className={clsx(inputCls, 'w-32')} value={kind} onChange={(e) => setPeriodRow(i, { kind: e.target.value as PeriodKind })} aria-label="Duração do período">
                      {PERIOD_KINDS.map((k) => (
                        <option key={k.id} value={k.id}>{k.label}</option>
                      ))}
                    </select>
                    {kind === 'dias' && (
                      <input type="number" className={clsx(inputCls, 'w-20 text-right')} value={p.days ?? 30} onChange={(e) => setPeriodRow(i, { days: Math.max(1, Number(e.target.value)) })} aria-label="Dias corridos" />
                    )}
                    {kind === 'mes' && (
                      <select className={clsx(inputCls, 'w-28')} value={p.month ?? 0} onChange={(e) => setPeriodRow(i, { month: Number(e.target.value) || undefined })} aria-label="Mês do calendário">
                        <option value={0}>mês médio</option>
                        {MONTH_NAMES.map((m, j) => (
                          <option key={m} value={j + 1}>{m}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{n1(calDays)}</td>
                <td className="py-1 pr-2 text-right font-semibold tabular-nums">{n1(p.workDays)}</td>
                <td className="py-1 pr-2 text-right">
                  <input
                    type="number"
                    step={1000}
                    className={clsx(inputCls, 'w-32 text-right', p.romT === undefined && 'text-black/45')}
                    value={Math.round(romT)}
                    onChange={(e) => setPeriodRow(i, { romT: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })}
                    aria-label={`Meta de ROM de ${p.label}`}
                    title={p.romT === undefined ? 'Sugerido pelas premissas (consumo mensal × meses do período)' : 'Meta informada'}
                  />
                  {p.romT !== undefined && (
                    <button type="button" className="ml-1 text-[11px] text-emerald-700 hover:underline" onClick={() => setPeriodRow(i, { romT: undefined })}>sugerida</button>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">{t0(romT * rm)}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{t0(romT * rej)}</td>
                <td className="py-1 text-right tabular-nums">{t0(h.productive)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s && (
        <div className="mt-4 rounded-xl bg-[#F8F9FA] p-4">
          <p className="mb-2 text-sm font-semibold">
            Horas de cada caminhão em {s.p.label}: {t0(s.h.calendar)} h de calendário → <span className="text-emerald-700">{t0(s.h.productive)} h produtivas</span>
          </p>
          <div className="flex h-5 overflow-hidden rounded-md">
            {HOUR_PARTS.map((part) => (s.h[part.key] > 0 ? <div key={part.key} style={{ width: `${(s.h[part.key] / s.h.calendar) * 100}%`, background: part.color }} title={`${part.label}: ${t0(s.h[part.key])} h`} /> : null))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/60">
            {HOUR_PARTS.map((part) => (
              <span key={part.key} className="flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: part.color }} /> {part.label}: <b className="tabular-nums">{t0(s.h[part.key])} h</b>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-black/45">
            {n1(hpd)} h/dia{linked ? ', DF e UF das premissas' : ''} (DF {n1(df)}%, UF {n1(uf)}%). Fila e espera são medidas pela simulação, dentro das horas produtivas.
            {s.f ? ` Transporte do período: ROM ${t0(s.f.rom)} t, produto ${t0(s.f.produto)} t, rejeito ${t0(s.f.rejeito)} t (úmidas).` : ''}
          </p>
        </div>
      )}
    </div>
  );
};

export default PlanView;
