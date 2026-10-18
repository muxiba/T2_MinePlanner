/**
 * Ligação do simulador com as Premissas Fundamentais (fonte única).
 *
 * O simulador usa das premissas: DF e UF da mina, horas por dia, velocidades carregado e vazio,
 * tempos de carga, basculamento e pesagem, classe do caminhão (carga útil e caçamba), umidade,
 * perdas, recuperação mássica e rejeito. O que muda é a movimentação do período simulado
 * (mês, ano, quinquênio ou n dias), que substitui o "Consumo Planta (t/mês)".
 */
import type { DetailedPremises } from '@/types';
import { catalogOf, wetFromDry } from '@/engine/fleet';
import { ROAD_TRUCK_SPEED, defaultReceiving } from './defaults';
import { loadTime, payloadFor, travelTimes } from './des';
import { defaultCalendar, type MinePlan, type MonthCal, type Movement, type Period } from './plan';
import type { Circuit, Scenario, SimModel, SpeedTable, TruckConfig } from './types';

/* ------------------------------------------------------------------------- */
/* Período                                                                     */
/* ------------------------------------------------------------------------- */

export type PeriodKind = 'mes' | 'ano' | 'quinquenio' | 'dias';

export const PERIOD_KINDS: { id: PeriodKind; label: string }[] = [
  { id: 'mes', label: 'Mês' },
  { id: 'ano', label: 'Ano' },
  { id: 'quinquenio', label: 'Quinquênio (5 anos)' },
  { id: 'dias', label: 'Número de dias' },
];

export const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
/** meses de chuva: janeiro, fevereiro, março, outubro, novembro e dezembro */
export const RAINY_MONTHS = [1, 2, 3, 10, 11, 12];
export const RAINY_WORKDAYS = 20; // igual a rainySeasonCalendar() do plano
export const DRY_WORKDAYS = 26;

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Calendário anual com a estação chuvosa (meses 1, 2, 3, 10, 11 e 12 com menos dias trabalhados). Editável. */
export function rainyCalendar(rainyDays = RAINY_WORKDAYS, dryDays = DRY_WORKDAYS): MonthCal[] {
  return MONTH_DAYS.map((d, i) => {
    const rainy = RAINY_MONTHS.includes(i + 1);
    return { month: MONTH_NAMES[i], days: d, workDays: Math.min(d, rainy ? rainyDays : dryDays), season: rainy ? 'chuvoso' : 'seco' };
  });
}

/** Calendário anual sem estação chuvosa. */
export function flatCalendar(workDays = DRY_WORKDAYS): MonthCal[] {
  return MONTH_DAYS.map((d, i) => ({ month: MONTH_NAMES[i], days: d, workDays: Math.min(d, workDays), season: 'seco' as const }));
}

const sum = (c: MonthCal[], k: 'days' | 'workDays') => c.reduce((a, m) => a + (m[k] || 0), 0);

/** Dias trabalhados e dias corridos de um período. */
export function periodDays(kind: PeriodKind | undefined, calendar: MonthCal[] | undefined, days?: number, month?: number) {
  const cal = calendar?.length ? calendar : defaultCalendar();
  const yearWork = sum(cal, 'workDays');
  const yearCal = sum(cal, 'days') || 365;
  switch (kind) {
    case 'mes': {
      const m = month && cal[month - 1];
      return m ? { work: m.workDays, calendar: m.days } : { work: yearWork / 12, calendar: yearCal / 12 };
    }
    case 'quinquenio':
      return { work: yearWork * 5, calendar: yearCal * 5 };
    case 'dias': {
      const d = Math.max(1, days ?? 30);
      return { work: d * (yearWork / yearCal), calendar: d };
    }
    case 'ano':
    default:
      return { work: yearWork, calendar: yearCal };
  }
}

/** Meses equivalentes do período (para sugerir a meta a partir do consumo mensal das premissas). */
export function periodMonths(kind: PeriodKind | undefined, days?: number) {
  return kind === 'mes' ? 1 : kind === 'quinquenio' ? 60 : kind === 'dias' ? Math.max(1, days ?? 30) / 30.4375 : 12;
}

/** Meta de ROM do período sugerida pelas premissas (t seca). */
export function suggestedRomT(premises: DetailedPremises, kind: PeriodKind | undefined, days?: number) {
  return Math.round((premises.targetMonthlyROM || 0) * periodMonths(kind, days));
}

/** Atualiza os dias trabalhados de cada período pelo tipo e pelo calendário. */
export function syncPeriods(plan: MinePlan): MinePlan {
  let changed = false;
  const periods = plan.periods.map((p) => {
    if (!p.kind) return p;
    const d = periodDays(p.kind, plan.calendar, p.days, p.month);
    const work = Math.round(d.work * 10) / 10;
    if (Math.abs(work - p.workDays) < 1e-6 && Math.abs((p.calendarDays ?? 0) - d.calendar) < 1e-6) return p;
    changed = true;
    return { ...p, workDays: work, calendarDays: Math.round(d.calendar * 10) / 10 };
  });
  return changed ? { ...plan, periods } : plan;
}

/** Desdobramento das horas de um período (por caminhão). */
export function hoursBreakdown(calendarDays: number, workDays: number, hoursPerDay: number, dfPct: number, ufPct: number) {
  const calendar = calendarDays * 24;
  const notWorked = Math.max(0, calendarDays - workDays) * 24; // chuva, folgas, feriados
  const offShift = workDays * Math.max(0, 24 - hoursPerDay);
  const scheduled = workDays * hoursPerDay;
  const maintenance = scheduled * (1 - dfPct / 100);
  const available = scheduled - maintenance;
  const stops = available * (1 - ufPct / 100);
  const productive = available - stops;
  return { calendar, notWorked, offShift, scheduled, maintenance, available, stops, productive };
}

/* ------------------------------------------------------------------------- */
/* Fluxos                                                                      */
/* ------------------------------------------------------------------------- */

export type Flow = 'rom' | 'produto' | 'rejeito' | 'esteril' | 'outro';

export const FLOW_LABELS: Record<Flow, string> = {
  rom: 'ROM (mina → planta)',
  produto: 'Produto (expedição)',
  rejeito: 'Rejeito filtrado',
  esteril: 'Estéril',
  outro: 'Outro (t informada)',
};

export function guessFlow(name: string): Flow {
  const n = name.toLowerCase();
  if (/terminal|produto|concentrado|product/.test(n)) return 'produto';
  if (/baia|rejeito|pru|tailing/.test(n)) return 'rejeito';
  if (/est[ée]ril|pde|waste/.test(n)) return 'esteril';
  return 'rom';
}

/** t úmidas transportadas de cada fluxo para uma meta de ROM seca. */
export function flowWetTonnes(premises: DetailedPremises, romDryT: number): Record<Flow, number> {
  const wet = (dry: number) => wetFromDry(dry, premises.umidadeNatural || 0, premises.perdaMaterial || 0, premises.moistureMode);
  const rm = (premises.processType === 'seco' ? 100 : premises.rmGlobal || 0) / 100;
  const rej = (premises.processType === 'seco' ? 0 : premises.rejeitoTotal || 0) / 100;
  const rem = premises.hasWasteRock && premises.targetMonthlyROM > 0 ? (premises.targetMonthlyWasteRock || 0) / premises.targetMonthlyROM : 0;
  return { rom: wet(romDryT), produto: wet(romDryT * rm), rejeito: wet(romDryT * rej), esteril: wet(romDryT * rem), outro: 0 };
}

/* ------------------------------------------------------------------------- */
/* Modelo efetivo                                                              */
/* ------------------------------------------------------------------------- */

export const linkOn = (m: SimModel) => m.link?.enabled !== false;
export const PREMISES_CONFIG_ID = 'P';

function scaleTable(t: SpeedTable, kl: number, ke: number): SpeedTable {
  return {
    loaded: t.loaded.map((x) => ({ ...x, kmh: Math.round(x.kmh * kl * 10) / 10 })),
    empty: t.empty.map((x) => ({ ...x, kmh: Math.round(x.kmh * ke * 10) / 10 })),
  };
}

/**
 * Tabela de velocidade da frota das premissas.
 * 'constante': a velocidade média das premissas em todo o trajeto (igual ao Dimensionamento).
 * 'rampa': a curva típica por rampa, escalada para que o tempo total de viagem nas rotas
 * seja o mesmo das velocidades médias das premissas (rotas mais íngremes ficam mais lentas).
 */
export function premisesSpeed(model: SimModel, premises: DetailedPremises): SpeedTable {
  const vl = Math.max(1, premises.velocidadeCheio || 15);
  const ve = Math.max(1, premises.velocidadeVazio || 20);
  if (model.link?.speedMode === 'constante' || !model.routes.length) {
    return { loaded: [{ maxGrade: 99, kmh: vl }], empty: [{ maxGrade: 99, kmh: ve }] };
  }
  const limit = 999; // calibração sem o limite da via
  let tl = 0;
  let te = 0;
  let dist = 0;
  for (const r of model.routes) {
    const tt = travelTimes(r.points, ROAD_TRUCK_SPEED, limit, model.rollingResistance);
    tl += tt.loaded;
    te += tt.empty;
    for (let i = 1; i < r.points.length; i++) dist += Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].y - r.points[i - 1].y);
  }
  const targetL = ((dist / 1000) / vl) * 60;
  const targetE = ((dist / 1000) / ve) * 60;
  if (!(tl > 0 && te > 0 && targetL > 0)) return { loaded: [{ maxGrade: 99, kmh: vl }], empty: [{ maxGrade: 99, kmh: ve }] };
  return scaleTable(ROAD_TRUCK_SPEED, tl / targetL, te / targetE);
}

export function premisesConfig(model: SimModel, premises: DetailedPremises, prev?: TruckConfig): TruckConfig {
  return {
    id: PREMISES_CONFIG_ID,
    name: `P – Frota das premissas (${premises.truckCapacity || 0} t${premises.truckVolumeM3 ? `, ${premises.truckVolumeM3} m³` : ''})`,
    payloadT: premises.truckCapacity || 40,
    volumeM3: premises.truckVolumeM3 || undefined,
    dumpMin: Math.max(0, premises.dumpingTime || 0),
    maneuverMin: 0,
    speed: premisesSpeed(model, premises),
    costFixedPerH: prev?.costFixedPerH ?? 0,
    costVarPerH: prev?.costVarPerH ?? 0,
  };
}

/** Taxa efetiva da carga (t/h) que reproduz o tempo de carga das premissas para o caminhão das premissas. */
export const premisesLoaderTph = (p: DetailedPremises) => ((p.truckCapacity || 40) / Math.max(0.1, p.loadingTime || 3)) * 60;
const weighOf = (p: DetailedPremises) => (p.weighingTimeLoaded || 0) + (p.weighingTimeEmpty || 0);

/**
 * Modelo efetivo: aplica as premissas sobre o modelo salvo. Idempotente.
 * Campos derivados das premissas não são editáveis enquanto a ligação estiver ligada.
 */
export function withPremises(model: SimModel, premises: DetailedPremises): SimModel {
  if (!linkOn(model)) return model;
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : 2.0;
  const prevP = model.configs.find((c) => c.id === PREMISES_CONFIG_ID);
  const configs = [premisesConfig(model, premises, prevP), ...model.configs.filter((c) => c.id !== PREMISES_CONFIG_ID)];
  const hours = premises.contractedHoursMina || 24;
  const scenarios: Scenario[] = model.scenarios.map((s, i) =>
    i === 0 ? { ...s, truckDf: premises.dfMina, efficiency: premises.ufMina, hoursPerDay: hours } : { ...s, hoursPerDay: hours },
  );
  const loaderTph = premisesLoaderTph(premises);
  const weigh = weighOf(premises);
  const base = { ...model, configs, scenarios };
  const circuits: Circuit[] = model.circuits.map((c) => ({
    ...c,
    density,
    loaderTph,
    loadSpotMin: 0,
    bucketT: undefined,
    passMin: undefined,
    loaderDf: premises.dfMina,
    weighing: weigh > 0,
    weighMin: weigh,
  }));
  const dests = [...new Set(model.circuits.map((c) => c.destination))];
  const recList = [...model.receiving, ...dests.filter((d) => !model.receiving.some((r) => r.destination === d)).map((d) => defaultReceiving(d))];
  const receiving = recList.map((r) => {
    if (r.manualTph) return r;
    const tph = receivingLoaderTph(premises, r.loaderId, density);
    return tph ? { ...r, stackerTph: tph, stackerDf: premises.dfPlanta || r.stackerDf } : r;
  });
  let out: SimModel = { ...base, circuits, receiving };
  // trucks automáticos e meta do período (aba Circuito)
  const calc = circuitTargets(out, premises);
  out = {
    ...out,
    circuits: out.circuits.map((c, i) => (c.autoTrucks === false || !calc[i] ? c : { ...c, trucks: Math.max(1, calc[i].trucks) })),
    targetTpd: calc.length ? Math.round(calc.reduce((a, x) => a + x.tonnes, 0) / Math.max(1, calc[0].workDays)) : model.targetTpd,
  };
  if (model.plan) out.plan = planWithPremises(model.plan, premises, density);
  return out;
}

/** Plano de lavra com horas, carga, pesagem e calendário vindos das premissas. */
export function planWithPremises(plan: MinePlan, premises: DetailedPremises, density = premises.looseDensity || 2.0): MinePlan {
  const cap = premises.truckCapacity || 40;
  const weigh = weighOf(premises);
  const movements: Movement[] = plan.movements.map((m) => {
    const bucket = m.bucketT > 0 ? m.bucketT : 10;
    const passes = Math.max(1, Math.ceil(cap / bucket - 1e-9));
    return {
      ...m,
      density,
      bucketT: bucket,
      passMin: Math.round((Math.max(0.1, premises.loadingTime || 3) / passes) * 1000) / 1000,
      loadSpotMin: 0,
      loaderDf: premises.dfMina,
      weighing: weigh > 0,
      weighMin: weigh,
    };
  });
  return syncPeriods({ ...plan, hoursPerDay: premises.contractedHoursMina || plan.hoursPerDay, movements });
}

/* ------------------------------------------------------------------------- */
/* Cálculo da aba Circuito                                                     */
/* ------------------------------------------------------------------------- */

export interface CircuitCalc {
  circuitId: string;
  flow: Flow;
  /** t úmidas no período */
  tonnes: number;
  workDays: number;
  productiveH: number;
  needTph: number;
  loadMin: number;
  loadedMin: number;
  emptyMin: number;
  dumpMin: number;
  weighMin: number;
  queueMin: number;
  cycleMin: number;
  payloadT: number;
  perTruckTph: number;
  loaderTph: number;
  trucksExact: number;
  trucks: number;
}

/** Período da aba Circuito (padrão: um mês das premissas). */
export function circuitPeriod(model: SimModel, premises: DetailedPremises) {
  const p = model.period ?? { kind: 'mes' as PeriodKind };
  const cal = model.plan?.calendar;
  const d = periodDays(p.kind, cal, p.days);
  const romT = p.romT ?? suggestedRomT(premises, p.kind, p.days);
  return { kind: p.kind, days: p.days, romT, workDays: d.work, calendarDays: d.calendar };
}

/** Meta de cada circuito no período, ciclo analítico e caminhões necessários (igual ao Dimensionamento). */
export function circuitTargets(model: SimModel, premises: DetailedPremises): CircuitCalc[] {
  if (!model.circuits.length) return [];
  const per = circuitPeriod(model, premises);
  const flows = flowWetTonnes(premises, per.romT);
  const sc = model.scenarios[0];
  const cfg = model.configs[0];
  if (!sc || !cfg) return [];
  const prodH = per.workDays * (sc.hoursPerDay || 24) * ((sc.truckDf || 0) / 100) * ((sc.efficiency || 0) / 100);
  const flowOf = (c: Circuit) => c.flow ?? guessFlow(c.name);
  const shareSum: Partial<Record<Flow, number>> = {};
  for (const c of model.circuits) shareSum[flowOf(c)] = (shareSum[flowOf(c)] ?? 0) + (c.share ?? 1);
  const queue = linkOn(model) ? premises.queueMin || 0 : 0;
  return model.circuits.map((c) => {
    const flow = flowOf(c);
    const tonnes = flow === 'outro' ? c.tonnesManual ?? 0 : (flows[flow] * (c.share ?? 1)) / (shareSum[flow] || 1);
    const r = model.routes.find((x) => x.id === c.routeId);
    const tt = r ? travelTimes(r.points, cfg.speed, model.speedLimitKmh, model.rollingResistance) : { loaded: 0, empty: 0 };
    const loadMin = loadTime(cfg, c);
    const dumpMin = cfg.dumpMin + cfg.maneuverMin;
    const weighMin = c.weighing ? c.weighMin : 0;
    const cycleMin = loadMin + tt.loaded + tt.empty + dumpMin + weighMin + queue;
    const payloadT = payloadFor(cfg, c);
    const perTruckTph = cycleMin > 0 ? (payloadT * 60) / cycleMin : 0;
    const needTph = prodH > 0 ? tonnes / prodH : 0;
    const trucksExact = perTruckTph > 0 ? needTph / perTruckTph : 0;
    return {
      circuitId: c.id,
      flow,
      tonnes,
      workDays: per.workDays,
      productiveH: prodH,
      needTph,
      loadMin,
      loadedMin: tt.loaded,
      emptyMin: tt.empty,
      dumpMin,
      weighMin,
      queueMin: queue,
      cycleMin,
      payloadT,
      perTruckTph,
      loaderTph: c.loaderTph,
      trucksExact,
      trucks: Math.ceil(trucksExact - 1e-6),
    };
  });
}

/* ------------------------------------------------------------------------- */
/* Movimentações do plano pelas premissas                                       */
/* ------------------------------------------------------------------------- */

/**
 * Monta as movimentações de cada período a partir da meta de ROM do período:
 * frente(s) → usina (ROM), usina → terminal (produto), usina → destino com sólido (rejeito filtrado)
 * e, se houver estéril nas premissas, frente(s) → pilha (estéril). Valores em t úmidas.
 * Movimentações já existentes (mesma origem e destino) são atualizadas; as demais ficam como estão.
 */
export function generateMovements(plan: MinePlan, premises: DetailedPremises, newId: () => string): { plan: MinePlan; warnings: string[] } {
  const warnings: string[] = [];
  const fronts = plan.places.filter((p) => p.kind === 'frente');
  const plant = plan.places.find((p) => p.kind === 'usina');
  const terminal = plan.places.find((p) => p.kind === 'terminal');
  const disposal = plan.places.find((p) => p.kind === 'rejeito');
  const pile = plan.places.find((p) => p.kind === 'pilha');
  if (!fronts.length) warnings.push('Marque ao menos um lugar como Frente de lavra.');
  if (!plant) warnings.push('Marque um lugar como Usina / planta.');
  if (!plant || !fronts.length) return { plan, warnings };
  if (!terminal && premises.processType !== 'seco') warnings.push('Sem lugar do tipo Terminal: o produto não foi gerado.');
  if (!disposal && premises.processType === 'umido') warnings.push('Sem destino com sólido (rejeito): o rejeito filtrado não foi gerado.');
  const n = plan.periods.length;
  const movements = plan.movements.map((m) => ({ ...m, tonnes: [...m.tonnes] }));
  const put = (origin: string, destination: string, material: string, period: number, t: number) => {
    let m = movements.find((x) => x.origin === origin && x.destination === destination);
    if (!m) {
      m = { ...newMovementLike(movements[0]), id: newId(), material, origin, destination, tonnes: Array.from({ length: n }, () => 0) };
      movements.push(m);
    }
    while (m.tonnes.length < n) m.tonnes.push(0);
    m.tonnes[period - 1] = Math.round(t);
  };
  plan.periods.forEach((per: Period, i) => {
    const romT = per.romT ?? suggestedRomT(premises, per.kind ?? 'ano', per.days);
    const f = flowWetTonnes(premises, romT);
    // divisão entre frentes: pela área de cada frente no período; sem área, em partes iguais
    const areas = fronts.map((fr) => plan.fronts.filter((a) => a.period === i + 1 && a.front === fr.name).reduce((s, a) => s + a.areaM2, 0));
    const totalA = areas.reduce((a, b) => a + b, 0);
    fronts.forEach((fr, k) => {
      const share = totalA > 0 ? areas[k] / totalA : 1 / fronts.length;
      put(fr.id, plant.id, 'Minério (ROM)', i + 1, f.rom * share);
      if (pile && f.esteril > 0) put(fr.id, pile.id, 'Estéril', i + 1, f.esteril * share);
    });
    if (terminal) put(plant.id, terminal.id, 'Produto', i + 1, f.produto);
    if (disposal && f.rejeito > 0) put(plant.id, disposal.id, 'Rejeito filtrado', i + 1, f.rejeito);
  });
  return { plan: { ...plan, movements }, warnings };
}

function newMovementLike(m?: Movement): Movement {
  return {
    id: '',
    material: '',
    origin: '',
    destination: '',
    density: m?.density ?? 2,
    loaders: 1,
    bucketT: m?.bucketT ?? 10,
    passMin: m?.passMin ?? 0.6,
    loadSpotMin: 0,
    loaderDf: m?.loaderDf ?? 85,
    dumpStations: 1,
    weighing: m?.weighing ?? false,
    weighMin: m?.weighMin ?? 1,
    tonnes: [],
  };
}

/* ------------------------------------------------------------------------- */
/* Lugares a partir das pontas das rotas                                       */
/* ------------------------------------------------------------------------- */

const ENDS: Record<Flow, [PlaceKindLite, PlaceKindLite]> = {
  rom: ['frente', 'usina'],
  produto: ['usina', 'terminal'],
  rejeito: ['usina', 'rejeito'],
  esteril: ['frente', 'pilha'],
  outro: ['outro', 'outro'],
};
type PlaceKindLite = import('./plan').PlaceKind;
const KIND_NAME: Record<PlaceKindLite, string> = { frente: 'Frente', usina: 'Usina', terminal: 'Terminal', rejeito: 'Disposição de rejeito', pilha: 'Pilha', outro: 'Ponto' };

/**
 * Cria um lugar em cada ponta das rotas (pontas a menos de 15 m viram um só lugar) e já sugere
 * o tipo pelo nome da rota: ROM = frente → usina; produto = usina → terminal; rejeito = usina → disposição.
 * Com `redo`, descarta os lugares atuais e gera de novo.
 */
export function placesFromRouteEnds(routes: { id: string; name: string; points: { x: number; y: number; z: number }[] }[], existing: import('./plan').Place[], redo = false) {
  const out = redo ? [] : existing.map((p) => ({ ...p }));
  let added = 0;
  const used = new Map<string, number>();
  const nameFor = (k: PlaceKindLite, route: string) => {
    if (k === 'frente') return `Frente ${route.replace(/^\d+[-_ ]*/, '').replace(/_/g, ' ')}`;
    const n = (used.get(k) ?? 0) + 1;
    used.set(k, n);
    return n === 1 ? KIND_NAME[k] : `${KIND_NAME[k]} ${n}`;
  };
  for (const r of routes) {
    if (r.points.length < 2) continue;
    const flow = guessFlow(r.name);
    const ends = [r.points[0], r.points[r.points.length - 1]];
    ends.forEach((p, j) => {
      const near = out.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 15);
      if (near) {
        // ponta compartilhada: um ponto de descarga de ROM que também é início de produto continua usina
        if (near.kind === 'outro' && ENDS[flow][j] !== 'outro') near.kind = ENDS[flow][j];
        return;
      }
      const kind = ENDS[flow][j];
      out.push({ id: `p${Date.now().toString(36)}${out.length}`, name: nameFor(kind, r.name), kind, x: p.x, y: p.y, z: p.z });
      added++;
    });
  }
  return { places: out, added };
}

/* ------------------------------------------------------------------------- */
/* Recebimento: carregadeira                                                    */
/* ------------------------------------------------------------------------- */

export const LOADER_FILL = 0.9;

/** Carregadeiras do catálogo (pás carregadeiras primeiro). */
export function receivingLoaders(premises: DetailedPremises) {
  const ls = catalogOf(premises).loaders;
  return [...ls.filter((l) => /^pa-|carregadeira/i.test(l.id + l.name)), ...ls.filter((l) => !/^pa-|carregadeira/i.test(l.id + l.name))];
}

/** Taxa da carregadeira (t/h) = caçamba (m³) × enchimento × densidade solta × ciclos por hora. */
export function receivingLoaderTph(premises: DetailedPremises, loaderId: string | undefined, density: number) {
  const l = receivingLoaders(premises).find((x) => x.id === (loaderId ?? 'pa-35'));
  if (!l || !(l.cycleSec > 0)) return 0;
  return Math.round(l.bucketM3 * LOADER_FILL * density * (3600 / l.cycleSec));
}
