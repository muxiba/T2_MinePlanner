/**
 * Dados dos relatórios (Word, apresentação e Excel): tudo sai do plano salvo —
 * Premissas Fundamentais, 2. Dimensionamento, modelo da Simulação e as rodadas guardadas
 * (matriz e frota mínima da aba Relatórios, busca da frota mínima e decisão de longo prazo).
 * Funções puras: sem DOM, para poder testar e gerar em qualquer ambiente.
 */
import type { DetailedPremises, Route } from '@/types';
import type { DecisionSnapshot, ReportMatrixRow, ReportMinFleet, SimModel, SweepSnapshot, TruckState } from '@/sim/types';
import { STATE_LABELS } from '@/sim/types';
import { analyzeFleet, routeTargets, targetLabels, KIND_LABELS } from '@/engine/fleet';
import { transportMode } from '@/engine/network';
import { circuitPeriod, circuitTargets, withPremises, PREMISES_CONFIG_ID } from '@/sim/link';
import { withReferenceCosts } from '@/sim/references';
import { financeFor } from '@/sim/econ';
import { CONFIG_COLORS, pct } from './theme';

const fmtPct = (v: number) => pct(v, 1);

export interface ReportOptions {
  title: string;
  subtitle?: string;
  client: string;
  company: string;
  author?: string;
  /** configurações incluídas (vazio = todas, menos a das premissas quando há outras) */
  configIds?: string[];
  /** configuração recomendada escolhida pelo usuário (vazio = automática) */
  recommendedId?: string;
  /** texto livre da conclusão (vazio = gerado) */
  conclusion?: string;
  /** condições, restrições e próximos passos (uma por linha) */
  notes?: string;
}

export interface CycleParts {
  loadMin: number;
  loadedMin: number;
  weighMin: number;
  dumpMin: number;
  emptyMin: number;
  queueMin: number;
  otherMin: number;
  cycleMin: number;
}

export interface ReportCircuitStatic extends CycleParts {
  name: string;
  destination: string;
  /** t úmidas no período */
  tonnes: number;
  payloadT: number;
  /** t/h por caminhão */
  tph: number;
  productiveH: number;
  /** t no período por caminhão */
  truckT: number;
  exact: number;
  trucks: number;
  needTph: number;
}

export interface ReportConfig {
  id: string;
  /** rótulo curto (A, B, C…) */
  tag: string;
  name: string;
  color: string;
  payloadT: number;
  dumpMin: number;
  maneuverMin: number;
  costFixedPerH: number;
  costVarPerH: number;
  price: number;
  /** ciclo médio ponderado pelas toneladas (conta estática, sem a fila calculada) */
  cycle: CycleParts;
  tph: number;
  circuits: ReportCircuitStatic[];
  staticTrucks: number;
  staticExact: number;
  /** destino mais ocupado: capacidade da descarga e ocupação na necessidade */
  dump: { destination: string; stations: number; capacityTph: number; needTph: number; occupancy: number; capacityOne: number } | null;
  /** linha da matriz no cenário base (frota fixa) */
  base?: ReportMatrixRow;
  matrix: ReportMatrixRow[];
  minFleet?: ReportMinFleet;
  /** frota usada no custo: mínima simulada ou a estática */
  fleet: number;
  fleetSource: 'simulação' | 'estático';
  cost: { fixedMonth: number; varMonth: number; total: number; perT: number; invest: number };
  decision?: DecisionSnapshot['rows'][number];
}

export interface ReportMovement {
  name: string;
  kind: string;
  material: string;
  distance: number;
  massT: number;
  payloadT: number;
  cycle: CycleParts;
  effectiveH: number;
  tph: number;
  truckMonthT: number;
  exact: number;
  needed: number;
  allocated: number;
  ratio: number;
}

export interface ReportData {
  opts: ReportOptions;
  generatedAt: string;
  periodLabel: string;
  transport: boolean;
  labels: { target: string; delivered: string };
  premises: { label: string; value: string; unit: string; raw?: number }[];
  hours: { workDays: number; calendarDays: number; hoursPerDay: number; df: number; uf: number; eo: number; effectiveH: number; calendarH: number };
  target: { monthT: number; dayT: number; tpd: number; periodT: number; flows: { name: string; t: number; tpd: number }[] };
  statik: { movements: ReportMovement[]; needed: number; allocated: number; premiseFleet: number; meets: boolean; ratio: number; bottleneck: string | null };
  sim: { available: boolean; configsCount: number; scenarios: { id: string; name: string; text: string }[]; replications: number; days: number; warmupH: number; runAt?: string; targetTpd: number };
  configs: ReportConfig[];
  sweep?: SweepSnapshot;
  decision?: DecisionSnapshot;
  recommended: ReportConfig | null;
  recommendedWhy: string[];
  conclusion: string;
  notes: string[];
  stateLabels: Record<TruckState, string>;
}

const fin = (v: number) => (Number.isFinite(v) ? v : 0);
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Modelo efetivo da simulação (o mesmo da aba Simulação: premissas aplicadas e custos de referência). */
export function effectiveModel(premises: DetailedPremises, routes: Route[]): SimModel | null {
  const stored = premises.simulation;
  if (!stored) return null;
  const edges = routes.length ? routeTargets(routes, premises) : undefined;
  return withReferenceCosts(withPremises(stored, premises, edges, routes));
}

/** Configurações padrão do relatório: todas, menos a das premissas quando há outras. */
export function defaultConfigIds(model: SimModel | null): string[] {
  if (!model) return [];
  const all = model.configs.map((c) => c.id);
  const others = all.filter((id) => id !== PREMISES_CONFIG_ID && !id.startsWith(`${PREMISES_CONFIG_ID}:`));
  return others.length >= 1 ? others : all;
}

const parts = (x: Partial<CycleParts>): CycleParts => ({
  loadMin: fin(x.loadMin ?? 0),
  loadedMin: fin(x.loadedMin ?? 0),
  weighMin: fin(x.weighMin ?? 0),
  dumpMin: fin(x.dumpMin ?? 0),
  emptyMin: fin(x.emptyMin ?? 0),
  queueMin: fin(x.queueMin ?? 0),
  otherMin: fin(x.otherMin ?? 0),
  cycleMin: fin(x.cycleMin ?? 0),
});

export function buildReportData(routes: Route[], premises: DetailedPremises, opts: ReportOptions): ReportData {
  const transport = transportMode(premises);
  const lab = targetLabels(premises);
  const fa = analyzeFleet(routes, premises);
  const model = effectiveModel(premises, routes);
  const edges = routes.length ? routeTargets(routes, premises) : undefined;

  /* ------------------------------ horas e meta ------------------------------ */
  const cal = premises.dailyCalendar ?? [];
  const hpd = premises.contractedHoursMina || 24;
  const workDays = cal.length ? cal.reduce((a, d) => a + (d.hoursMina || 0), 0) / hpd : premises.calendarDays || 30;
  const calendarDays = cal.length || premises.calendarDays || 30;
  const mainRoute = fa.routes[0];
  // DF, UF e EO como o 2. Dimensionamento aplica (cascata de horas da movimentação)
  const df = mainRoute?.hours.df ?? (premises.dfMina || 0) / 100;
  const uf = mainRoute?.hours.uf ?? (premises.ufMina || 0) / 100;
  const eo = mainRoute?.hours.eo ?? 1;
  const effectiveH = mainRoute?.hours.effective ?? workDays * hpd * df * uf;
  const monthT = fa.romTargetDryT;
  const periodLabel = `${MONTHS[premises.month ?? 0] ?? ''}/${premises.year ?? ''}`;

  const movements: ReportMovement[] = fa.routes.map((a) => {
    const r = routes.find((x) => x.id === a.id);
    const c = a.cycle;
    return {
      name: a.name,
      kind: KIND_LABELS[a.kind] ?? a.kind,
      material: r?.materialName || '',
      distance: r?.distance ?? 0,
      massT: a.targetWetT,
      payloadT: a.payloadT,
      cycle: parts({ loadMin: c.loadMin, loadedMin: c.travelLoadedMin, weighMin: c.weighMin, dumpMin: c.dumpMin, emptyMin: c.travelEmptyMin, queueMin: c.queueMin, otherMin: Math.max(0, c.totalMin - c.loadMin - c.travelLoadedMin - c.weighMin - c.dumpMin - c.travelEmptyMin - c.queueMin), cycleMin: c.totalMin }),
      effectiveH: a.hours.effective,
      tph: a.truckRateTph,
      truckMonthT: a.truckMonthT,
      exact: a.trucksNeededExact,
      needed: a.trucksNeeded,
      allocated: a.trucksAllocated,
      ratio: a.ratio,
    };
  });

  const premisesRows: ReportData['premises'] = [
    { label: 'Mês de referência', value: periodLabel, unit: '' },
    { label: lab.target, value: '', unit: 't/mês', raw: monthT },
    { label: 'Dias de operação no mês', value: '', unit: 'dias', raw: workDays },
    { label: 'Horas de operação por dia', value: '', unit: 'h/dia', raw: hpd },
    { label: 'Disponibilidade física (DF)', value: '', unit: '%', raw: premises.dfMina },
    { label: 'Utilização (UF)', value: '', unit: '%', raw: premises.ufMina },
    { label: 'Caminhões nas premissas', value: '', unit: 'caminhões', raw: premises.truckCount },
    { label: 'Capacidade do caminhão das premissas', value: '', unit: 't', raw: premises.truckCapacity },
    { label: 'Tempo de carregamento', value: '', unit: 'min', raw: premises.loadingTime },
    { label: 'Tempo de basculamento', value: '', unit: 'min', raw: premises.dumpingTime },
    { label: 'Pesagem carregado', value: '', unit: 'min', raw: premises.weighingTimeLoaded },
    { label: 'Umidade natural', value: '', unit: '%', raw: premises.umidadeNatural },
    { label: 'Perda de material', value: '', unit: '%', raw: premises.perdaMaterial },
  ];
  if (!transport) premisesRows.push({ label: 'Capacidade máxima da planta', value: '', unit: 't/h', raw: premises.plantFeedRateTPH });

  /* --------------------------------- simulação -------------------------------- */
  const per = model ? circuitPeriod(model, premises) : null;
  const sc0 = model?.scenarios[0];
  const configIds = (opts.configIds?.length ? opts.configIds : defaultConfigIds(model)).filter((id) => model?.configs.some((c) => c.id === id));
  const run = model?.reportRun;
  const configs: ReportConfig[] = [];
  if (model && per && sc0) {
    const calendarH = per.calendarDays * 24;
    configIds.forEach((id, i) => {
      const cfg = model.configs.find((c) => c.id === id)!;
      // conta estática do modelo com esta configuração na frente (circuitos com configuração fixa mantêm a sua)
      const calc = circuitTargets({ ...model, configs: [cfg, ...model.configs.filter((c) => c.id !== id)] }, premises, edges);
      const tonnes = calc.reduce((a, c) => a + c.tonnes, 0);
      const w = (f: (c: (typeof calc)[number]) => number) => (tonnes > 0 ? calc.reduce((a, c) => a + f(c) * c.tonnes, 0) / tonnes : calc[0] ? f(calc[0]) : 0);
      const circuits: ReportCircuitStatic[] = calc.map((c) => {
        const mc = model.circuits.find((x) => x.id === c.circuitId)!;
        return {
          name: mc?.name ?? c.circuitId,
          destination: mc?.destination ?? '',
          tonnes: c.tonnes,
          payloadT: c.payloadT,
          tph: c.perTruckTph,
          productiveH: c.productiveH,
          truckT: c.perTruckTph * c.productiveH,
          exact: c.trucksExact,
          trucks: c.trucks,
          needTph: c.needTph,
          // outras paradas = o que sobra do ciclo (interferências e paradas no trajeto, como portaria)
          ...parts({ loadMin: c.loadMin, loadedMin: c.loadedMin, weighMin: c.weighMin, dumpMin: c.dumpMin, emptyMin: c.emptyMin, queueMin: c.queueMin, otherMin: Math.max(0, c.cycleMin - c.loadMin - c.loadedMin - c.weighMin - c.dumpMin - c.emptyMin - c.queueMin), cycleMin: c.cycleMin }),
        };
      });
      const other = (c: (typeof calc)[number]) => Math.max(0, c.cycleMin - c.loadMin - c.loadedMin - c.weighMin - c.dumpMin - c.emptyMin - c.queueMin);
      const cycle = parts({ loadMin: w((c) => c.loadMin), loadedMin: w((c) => c.loadedMin), weighMin: w((c) => c.weighMin), dumpMin: w((c) => c.dumpMin), emptyMin: w((c) => c.emptyMin), queueMin: w((c) => c.queueMin), otherMin: w(other), cycleMin: w((c) => c.cycleMin) });
      // descarga: destino com maior ocupação
      const dests = [...new Set(model.circuits.map((c) => c.destination))];
      let dump: ReportConfig['dump'] = null;
      for (const d of dests) {
        const cs = model.circuits.filter((c) => c.destination === d);
        const stations = Math.max(1, ...cs.map((c) => c.dumpStations || 1));
        // chegada média na descarga ao longo das horas de operação (não só nas horas efetivas dos caminhões)
        const opH = per.workDays * (sc0.hoursPerDay || 24);
        const need = calc.filter((c) => cs.some((x) => x.id === c.circuitId)).reduce((a, c) => a + (opH > 0 ? c.tonnes / opH : c.needTph), 0);
        const capOne = cfg.dumpMin + cfg.maneuverMin > 0 ? (cfg.payloadT * 60) / (cfg.dumpMin + cfg.maneuverMin) : 0;
        const cap = stations * capOne;
        const occ = cap > 0 ? need / cap : 0;
        if (!dump || occ > dump.occupancy) dump = { destination: d, stations, capacityTph: cap, needTph: need, occupancy: occ, capacityOne: capOne };
      }
      const matrix = (run?.matrix ?? []).filter((r) => r.configId === id);
      const base = matrix.find((r) => r.scenarioId === sc0.id) ?? matrix[0];
      const minFleet = (run?.minFleet ?? []).find((m) => m.configId === id && m.scenarioId === sc0.id) ?? (run?.minFleet ?? []).find((m) => m.configId === id);
      const staticTrucks = circuits.reduce((a, c) => a + c.trucks, 0);
      const fleet = minFleet?.total ?? staticTrucks;
      const prodH = calc[0]?.productiveH ?? 0;
      const fixedMonth = fleet * cfg.costFixedPerH * calendarH;
      const varMonth = fleet * prodH * cfg.costVarPerH;
      const price = model.finance ? financeFor(model.finance, cfg.id, cfg.payloadT).price : 0;
      configs.push({
        id,
        tag: String.fromCharCode(65 + i),
        name: cfg.name,
        color: CONFIG_COLORS[i % CONFIG_COLORS.length],
        payloadT: cfg.payloadT,
        dumpMin: cfg.dumpMin,
        maneuverMin: cfg.maneuverMin,
        costFixedPerH: cfg.costFixedPerH,
        costVarPerH: cfg.costVarPerH,
        price,
        cycle,
        tph: w((c) => c.perTruckTph),
        circuits,
        staticTrucks,
        staticExact: circuits.reduce((a, c) => a + c.exact, 0),
        dump,
        base,
        matrix,
        minFleet,
        fleet,
        fleetSource: minFleet ? 'simulação' : 'estático',
        cost: { fixedMonth, varMonth, total: fixedMonth + varMonth, perT: tonnes > 0 ? (fixedMonth + varMonth) / tonnes : 0, invest: fleet * price },
      });
    });
  }

  const decision = model?.lastDecision;
  if (decision) for (const c of configs) c.decision = decision.rows.find((r) => r.configId === c.id && (r.id.endsWith('|*') || decision.rows.filter((x) => x.configId === c.id).length === 1)) ?? decision.rows.find((r) => r.configId === c.id);

  /* ------------------------------- recomendação ------------------------------- */
  const targetTpd = run?.targetTpd || model?.targetTpd || (workDays > 0 ? monthT / workDays : 0);
  const meets = (c: ReportConfig) => (c.base ? c.base.tpd >= targetTpd * 0.995 : true) && (c.minFleet ? c.minFleet.circuits.every((x) => !x.saturated) : true);
  let recommended: ReportConfig | null = configs.find((c) => c.id === opts.recommendedId) ?? null;
  const why: string[] = [];
  if (!recommended && configs.length) {
    const pool = configs.filter(meets);
    const list = (pool.length ? pool : configs).slice().sort((a, b) => a.cost.perT - b.cost.perT);
    recommended = list[0];
    // empate técnico (até 1%): fica a de menor ocupação da descarga
    const tie = list.filter((c) => c.cost.perT <= list[0].cost.perT * 1.01);
    if (tie.length > 1) recommended = tie.slice().sort((a, b) => (a.dump?.occupancy ?? 0) - (b.dump?.occupancy ?? 0))[0];
  }
  if (recommended) {
    const others = configs.filter((c) => c !== recommended);
    const cheaper = others.filter((c) => c.cost.perT < recommended!.cost.perT);
    if (!cheaper.length && others.length) why.push('menor custo por tonelada entre as opções');
    else if (cheaper.length) why.push(`custo por tonelada só ${fmtPct((recommended.cost.perT / Math.min(...cheaper.map((c) => c.cost.perT))) - 1)} acima da mais barata`);
    if (recommended.base && targetTpd > 0) why.push(`entrega ${Math.round((recommended.base.tpd / targetTpd) * 100)}% da meta na simulação com a frota do cenário base`);
    if (recommended.dump) why.push(`descarga ocupada ${Math.round(recommended.dump.occupancy * 100)}% do tempo na necessidade`);
    const first = configs[0];
    if (first && first !== recommended && first.fleet > recommended.fleet) why.push(`${Math.round((1 - recommended.fleet / first.fleet) * 100)}% menos caminhões que a opção ${first.tag}`);
  }

  const conclusion =
    opts.conclusion?.trim() ||
    (recommended
      ? `Recomendamos a configuração ${recommended.tag} – ${recommended.name}: ${why.join('; ')}.`
      : 'Cadastre as configurações de caminhão na Simulação para comparar as opções.');

  return {
    opts,
    generatedAt: new Date().toISOString(),
    periodLabel,
    transport,
    labels: { target: lab.target, delivered: lab.delivered },
    premises: premisesRows,
    hours: { workDays, calendarDays, hoursPerDay: hpd, df, uf, eo, effectiveH, calendarH: calendarDays * 24 },
    target: {
      monthT,
      dayT: workDays > 0 ? monthT / workDays : 0,
      tpd: targetTpd,
      periodT: per?.romT ?? monthT,
      flows: movements.map((m) => ({ name: m.name, t: m.massT, tpd: workDays > 0 ? m.massT / workDays : 0 })),
    },
    statik: {
      movements,
      needed: fa.fleet.needed,
      allocated: fa.fleet.allocated,
      premiseFleet: fa.fleet.premise,
      meets: fa.meetsTarget,
      ratio: fa.systemRatio,
      bottleneck: fa.bottleneck ? `${fa.bottleneck.label} (${Math.round(fa.bottleneck.ratio * 1000) / 10}%)` : null,
    },
    sim: {
      available: !!model && configs.length > 0,
      configsCount: configs.length,
      scenarios: (model?.scenarios ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        text: `${s.hoursPerDay} h/dia · DF ${s.truckDf}% · eficiência ${s.efficiency}%${s.travelFactor !== 1 ? ` · viagens ×${s.travelFactor}` : ''}${s.receivingFactor !== 1 ? ` · recebimento ×${s.receivingFactor}` : ''}`,
      })),
      replications: model?.replications ?? 0,
      days: model?.scenarios[0]?.days ?? 0,
      warmupH: model?.warmupH ?? 0,
      runAt: run?.at,
      targetTpd,
    },
    configs,
    sweep: model?.lastSweep,
    decision,
    recommended,
    recommendedWhy: why,
    conclusion,
    notes: (opts.notes ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    stateLabels: STATE_LABELS,
  };
}
