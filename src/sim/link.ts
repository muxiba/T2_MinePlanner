/**
 * Ligação do simulador com as Premissas Fundamentais (fonte única).
 *
 * O simulador usa das premissas: DF e UF da mina, horas por dia, velocidades carregado e vazio,
 * tempos de carga, basculamento e pesagem, classe do caminhão (carga útil e caçamba), umidade,
 * perdas, recuperação mássica e rejeito. O que muda é a movimentação do período simulado
 * (mês, ano, quinquênio ou n dias), que substitui o "Consumo Planta (t/mês)".
 */
import type { DetailedPremises, Route } from '@/types';
import { fleetTypesOf, mixedOn } from '@/engine/mix';
import { distanceAlong, geoFor, pathLength } from '@/engine/geo';
import { catalogOf, wetFromDry } from '@/engine/fleet';
import { interferenceMin, lossesOf } from '@/engine/losses';
import { processPct } from '@/engine/process';
import { ROAD_TRUCK_SPEED, defaultReceiving } from './defaults';
import { configFor, limitsOf, loadTime, mixOf, payloadFor, travelTimes } from './des';
import { defaultCalendar, type MinePlan, type MonthCal, type Movement, type Period } from './plan';
import type { Circuit, Scenario, SimModel, SpeedTable, TruckConfig } from './types';

/* ------------------------------------------------------------------------- */
/* Período                                                                     */
/* ------------------------------------------------------------------------- */

export type PeriodKind = 'mes' | 'ano' | 'quinquenio' | 'dias';

export const PERIOD_KINDS: { id: PeriodKind; label: string; plural: string }[] = [
  { id: 'dias', label: 'Dias', plural: 'dias' },
  { id: 'mes', label: 'Meses', plural: 'meses' },
  { id: 'ano', label: 'Anos', plural: 'anos' },
  { id: 'quinquenio', label: 'Quinquênios (5 anos)', plural: 'quinquênios' },
];

/** Texto da duração: "3 meses", "1 ano", "45 dias". */
export function periodText(kind: PeriodKind | undefined, qty = 1, days?: number) {
  const k = kind ?? 'ano';
  if (k === 'dias') return `${days ?? qty} dias`;
  const n = Math.max(1, qty);
  const one = { mes: 'mês', ano: 'ano', quinquenio: 'quinquênio' }[k];
  const many = { mes: 'meses', ano: 'anos', quinquenio: 'quinquênios' }[k];
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
}

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

/**
 * Dias trabalhados e dias corridos de um período de `qty` unidades (dias, meses, anos ou quinquênios).
 * Mês com `month` informado usa aquele mês do calendário; sem mês, o mês médio do calendário.
 */
export function periodDays(kind: PeriodKind | undefined, calendar: MonthCal[] | undefined, days?: number, month?: number, qty = 1) {
  const cal = calendar?.length ? calendar : defaultCalendar();
  const yearWork = sum(cal, 'workDays');
  const yearCal = sum(cal, 'days') || 365;
  const n = Math.max(0, qty || 1);
  switch (kind) {
    case 'mes': {
      const m = month && n === 1 ? cal[month - 1] : undefined;
      return m ? { work: m.workDays, calendar: m.days } : { work: (yearWork / 12) * n, calendar: (yearCal / 12) * n };
    }
    case 'quinquenio':
      return { work: yearWork * 5 * n, calendar: yearCal * 5 * n };
    case 'dias': {
      const d = Math.max(1, days ?? qty ?? 30);
      return { work: d * (yearWork / yearCal), calendar: d };
    }
    case 'ano':
    default:
      return { work: yearWork * n, calendar: yearCal * n };
  }
}

/** Meses equivalentes do período (para multiplicar o consumo mensal das premissas). */
export function periodMonths(kind: PeriodKind | undefined, days?: number, qty = 1) {
  const n = Math.max(0, qty || 1);
  return kind === 'mes' ? n : kind === 'quinquenio' ? 60 * n : kind === 'dias' ? Math.max(1, days ?? qty ?? 30) / 30.4375 : 12 * n;
}

/** Meta de ROM do período pelas premissas (t seca) = consumo mensal × meses do período. */
export function suggestedRomT(premises: DetailedPremises, kind: PeriodKind | undefined, days?: number, qty = 1) {
  return Math.round((premises.targetMonthlyROM || 0) * periodMonths(kind, days, qty));
}

/** Atualiza os dias trabalhados de cada período pelo tipo e pelo calendário. */
export function syncPeriods(plan: MinePlan): MinePlan {
  let changed = false;
  const periods = plan.periods.map((p) => {
    if (!p.kind) return p;
    const d = periodDays(p.kind, plan.calendar, p.days, p.month, p.qty);
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
  if (/terminal|produto|concentrado|product|expedi/.test(n)) return 'produto';
  if (/baia|rejeit|rejeir|pru|tailing|filtrad|barragem/.test(n)) return 'rejeito';
  if (/est[ée]ril|pde|waste|bota.?fora/.test(n)) return 'esteril';
  return 'rom';
}

/** Fator seca → úmida transportada das premissas (ex.: 1,10 = 9% de umidade + 1% de perda). */
export const wetFactor = (p: DetailedPremises) => wetFromDry(1, p.umidadeNatural || 0, p.perdaMaterial || 0, p.moistureMode);

/** Frações do ROM: produto (RM global), rejeito (rejeito total) e estéril (REM das premissas). Processo a seco: 100% produto, sem rejeito. */
export function flowShares(p: DetailedPremises) {
  const pp = processPct(p);
  return {
    rm: pp.rm / 100,
    rej: pp.rej / 100,
    rem: p.hasWasteRock && p.targetMonthlyROM > 0 ? (p.targetMonthlyWasteRock || 0) / p.targetMonthlyROM : 0,
  };
}

/** t secas de cada fluxo para uma meta de ROM seca: produto = ROM × RM, rejeito = ROM × rejeito, estéril = ROM × REM. */
export function flowDryTonnes(premises: DetailedPremises, romDryT: number): Record<Flow, number> {
  const s = flowShares(premises);
  return { rom: romDryT, produto: romDryT * s.rm, rejeito: romDryT * s.rej, esteril: romDryT * s.rem, outro: 0 };
}

/** t úmidas transportadas de cada fluxo para uma meta de ROM seca (seca × fator de umidade e perdas). */
export function flowWetTonnes(premises: DetailedPremises, romDryT: number): Record<Flow, number> {
  const k = wetFactor(premises);
  const d = flowDryTonnes(premises, romDryT);
  return { rom: d.rom * k, produto: d.produto * k, rejeito: d.rejeito * k, esteril: d.esteril * k, outro: 0 };
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
    name: (() => {
      const cls = catalogOf(premises).trucks.find((t) => t.id === premises.truckClassId);
      const cap = `${premises.truckCapacity || 0} t${premises.truckVolumeM3 ? `, ${premises.truckVolumeM3} m³` : ''}`;
      return cls ? `Premissas: ${cls.manufacturer ? `${cls.manufacturer} ` : ''}${cls.name}${premises.truckVolumeM3 ? ` · ${premises.truckVolumeM3} m³` : ''}` : `Premissas: caminhão ${cap}`;
    })(),
    vehicle: prev?.vehicle,
    speedLimitLoadedKmh: prev?.speedLimitLoadedKmh,
    speedLimitEmptyKmh: prev?.speedLimitEmptyKmh,
    rollingResistance: prev?.rollingResistance,
    trafficDelayMin: prev?.trafficDelayMin,
    payloadT: premises.truckCapacity || 40,
    volumeM3: premises.truckVolumeM3 || undefined,
    dumpMin: Math.max(0, premises.dumpingTime || 0),
    maneuverMin: 0,
    speed: premisesSpeed(model, premises),
    costFixedPerH: prev?.costFixedPerH ?? 0,
    costVarPerH: prev?.costVarPerH ?? 0,
  };
}

/** Id da configuração de cada tipo da frota mista (catálogo). */
export const typeConfigId = (classId: string) => `${PREMISES_CONFIG_ID}:${classId}`;

/** Frota mista: uma configuração por tipo de caminhão das premissas (mesmas velocidades e tempos; carga útil, volume e custos do tipo). */
export function fleetTypeConfigs(model: SimModel, premises: DetailedPremises, base: TruckConfig): TruckConfig[] {
  if (!mixedOn(premises)) return [];
  return fleetTypesOf(premises).map((t) => {
    const id = typeConfigId(t.classId);
    const prev = model.configs.find((c) => c.id === id);
    const road = t.cls.vehicle === 'rodoviario';
    return {
      ...base,
      id,
      name: `Premissas: ${t.cls.manufacturer ? `${t.cls.manufacturer} ` : ''}${t.cls.name}`,
      vehicle: t.cls.vehicle ?? base.vehicle,
      payloadT: t.cls.payloadT,
      volumeM3: t.cls.volumeM3 || undefined,
      // velocidades próprias do tipo (frota mista); sem elas, as das premissas
      speed: t.speedLoaded || t.speedEmpty ? premisesSpeed(model, { ...premises, velocidadeCheio: t.speedLoaded || premises.velocidadeCheio, velocidadeVazio: t.speedEmpty || premises.velocidadeVazio }) : base.speed,
      speedLimitLoadedKmh: prev?.speedLimitLoadedKmh ?? (road ? base.speedLimitLoadedKmh : undefined),
      speedLimitEmptyKmh: prev?.speedLimitEmptyKmh ?? (road ? base.speedLimitEmptyKmh : undefined),
      rollingResistance: prev?.rollingResistance ?? base.rollingResistance,
      trafficDelayMin: prev?.trafficDelayMin ?? base.trafficDelayMin,
      costFixedPerH: prev?.costFixedPerH ?? 0,
      costVarPerH: prev?.costVarPerH ?? 0,
    };
  });
}

/** Tira o prefixo de letra antigo (“A – …”): as letras eram só identificadores internos. */
export function cleanConfigName<T extends { name: string }>(c: T): T {
  const name = c.name.replace(/^[A-Z]\s*[–-]\s+/, '').replace(/^Basculante 6x4 \(frota atual\)$/, 'Basculante 6x4 – 27 t');
  return name === c.name ? c : { ...c, name };
}

/** Taxa efetiva da carga (t/h) que reproduz o tempo de carga das premissas para o caminhão das premissas. */
export const premisesLoaderTph = (p: DetailedPremises) => ((p.truckCapacity || 40) / Math.max(0.1, p.loadingTime || 3)) * 60;
const weighOf = (p: DetailedPremises) => (p.weighingTimeLoaded || 0) + (p.weighingTimeEmpty || 0);

/**
 * Modelo efetivo: aplica as premissas sobre o modelo salvo. Idempotente.
 * Campos derivados das premissas não são editáveis enquanto a ligação estiver ligada.
 */
export function withPremises(model: SimModel, premises: DetailedPremises, edges?: EdgeMasses, netRoutes?: Route[]): SimModel {
  if (!linkOn(model)) return model;
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : 2.0;
  const prevP = model.configs.find((c) => c.id === PREMISES_CONFIG_ID);
  const pCfg0 = premisesConfig(model, premises, prevP);
  const typeCfgs = fleetTypeConfigs(model, premises, pCfg0);
  const pCfg = typeCfgs.length ? { ...pCfg0, name: `Premissas: frota mista (${fleetTypesOf(premises).map((t) => `${t.count}× ${t.cls.name}`).join(' + ')})` } : pCfg0;
  const isP = (id: string) => id === PREMISES_CONFIG_ID || id.startsWith(`${PREMISES_CONFIG_ID}:`);
  const configs = [pCfg, ...typeCfgs, ...model.configs.filter((c) => !isP(c.id)).map(cleanConfigName)];
  // frota mista: a composição vem da movimentação ligada ao circuito; sem movimentação, a proporção da frota toda
  const fleetMix = typeCfgs.length ? Object.fromEntries(fleetTypesOf(premises).map((t) => [typeConfigId(t.classId), t.count])) : undefined;
  const mixFor = (c: Circuit) => {
    if (!fleetMix) return undefined;
    const r = c.edgeId ? netRoutes?.find((x) => x.id === c.edgeId) : undefined;
    const m = r?.mix ? Object.fromEntries(Object.entries(r.mix).filter(([, n]) => n > 0).map(([k, n]) => [typeConfigId(k), n])) : {};
    return Object.keys(m).length ? m : fleetMix;
  };
  const hours = premises.contractedHoursMina || 24;
  // perdas detalhadas: cada parada vira evento na simulação e a eficiência cobre só o que não foi listado (100%)
  const L = premises.losses?.enabled ? lossesOf(premises) : null;
  const stops = L
    ? { shifts: L.shifts, shiftChangeMin: L.shiftChangeMin + L.otherMinPerShift, mealMin: L.mealMin, fuelMin: L.fuelMin, interferenceMin: L.interferenceMin }
    : undefined;
  const scenarios: Scenario[] = model.scenarios.map((s, i) => {
    const base = i === 0 ? { ...s, truckDf: premises.dfMina, efficiency: premises.ufMina, hoursPerDay: hours } : { ...s, hoursPerDay: hours };
    return stops ? { ...base, efficiency: 100, stops } : { ...base, stops: undefined };
  });
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
    mix: mixFor(c),
    // tempo de carga próprio da movimentação ligada (tabela de transporte): vale como tempo fixo de carga
    ...((() => {
      const r = c.edgeId ? netRoutes?.find((x) => x.id === c.edgeId) : undefined;
      return r?.loadMin !== undefined ? { loadSpotMin: r.loadMin, loaderTph: 1e9 } : {};
    })()),
    // paradas no trajeto da movimentação ligada: posição pela distância da origem ÷ DMT
    stops: (() => {
      const r = c.edgeId ? netRoutes?.find((x) => x.id === c.edgeId) : undefined;
      if (!r?.stops?.length) return undefined;
      // posição: ponto do DXF da parada sobre o trajeto do período; sem eles, a distância informada ÷ DMT
      const g = geoFor(r, model.geoPeriod ?? 1);
      const PL = g.path && g.path.length > 1 ? pathLength(g.path) : 0;
      const L = Math.max(1, r.distance || 1);
      const fracOf = (x: (typeof r.stops)[number]) => (PL > 0 && g.stops[x.id] ? distanceAlong(g.path!, g.stops[x.id]) / PL : (x.distM || 0) / L);
      return r.stops.map((x) => ({ name: x.name, weigh: x.kind === 'pesagem', frac: Math.min(1, Math.max(0, fracOf(x))), stopMin: Math.max(0, x.stopMin || 0), dir: x.dir, posts: Math.max(1, x.posts || 1) }));
    })(),
  }));
  const dests = [...new Set(model.circuits.map((c) => c.destination))];
  const recList = [...model.receiving, ...dests.filter((d) => !model.receiving.some((r) => r.destination === d)).map((d) => defaultReceiving(d))];
  const receiving = recList.map((r) => {
    if (r.manualTph) return r;
    const tph = receivingLoaderTph(premises, r.loaderId, density);
    return tph ? { ...r, stackerTph: tph, stackerDf: premises.dfPlanta || r.stackerDf } : r;
  });
  // trajeto do DXF da movimentação ligada (período escolhido): vira a rota do circuito, com rampas
  const gp = model.geoPeriod ?? 1;
  const geoRoutes: SimModel['routes'] = [];
  const circuitsGeo = circuits.map((c) => {
    const r = c.edgeId ? netRoutes?.find((x) => x.id === c.edgeId) : undefined;
    const path = r ? geoFor(r, gp).path : undefined;
    if (!r || !path || path.length < 2) return c;
    const id = `geo-${r.id}`;
    if (!geoRoutes.some((x) => x.id === id)) geoRoutes.push({ id, name: r.name, points: path });
    return { ...c, routeId: id };
  });
  // a rota substituída pelo trajeto do DXF sai da lista se nenhum outro circuito a usa
  const replaced = new Set(circuits.filter((c, i) => circuitsGeo[i].routeId !== c.routeId).map((c) => c.routeId));
  const stillUsed = new Set(circuitsGeo.map((c) => c.routeId));
  const simRoutes = geoRoutes.length ? [...model.routes.filter((x) => !geoRoutes.some((g) => g.id === x.id) && !(replaced.has(x.id) && !stillUsed.has(x.id))), ...geoRoutes] : model.routes;
  let out: SimModel = { ...base, routes: simRoutes, circuits: circuitsGeo, receiving };
  // trucks automáticos e meta do período (aba Circuito)
  const calc = circuitTargets(out, premises, edges);
  out = {
    ...out,
    circuits: out.circuits.map((c, i) => {
      const w = calc[i] ? { dispatchWeight: calc[i].tonnes } : {};
      return c.autoTrucks === false || !calc[i] ? { ...c, ...w } : { ...c, ...w, trucks: Math.max(1, calc[i].trucks) };
    }),
    dispatch: model.dispatch ?? (typeCfgs.length && premises.mixMode === 'estatistico' ? 'dinamico' : undefined),
    targetTpd: calc.length ? Math.round(calc.reduce((a, x) => a + x.tonnes, 0) / Math.max(1, calc[0].workDays)) : model.targetTpd,
  };
  // despacho dinâmico: a frota é uma só; total = soma das frações arredondada para cima, repartida pelos circuitos
  if (out.dispatch === 'dinamico' && calc.length > 1) {
    const auto = out.circuits.map((c, i) => c.autoTrucks !== false && !!calc[i]);
    const ex = calc.map((x, i) => (auto[i] ? x.trucksExact : 0));
    const N = Math.max(1, Math.ceil(ex.reduce((a, b) => a + b, 0) - 1e-6));
    const base = ex.map((e) => Math.floor(e));
    let left = N - base.reduce((a, b) => a + b, 0);
    ex.map((e, i) => ({ i, f: e - Math.floor(e) })).filter((o) => auto[o.i]).sort((a, b) => b.f - a.f).forEach((o) => { if (left-- > 0) base[o.i]++; });
    out = { ...out, circuits: out.circuits.map((c, i) => (auto[i] ? { ...c, trucks: base[i] } : c)) };
  }
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
  return syncPeriods(syncDerived({ ...plan, hoursPerDay: premises.contractedHoursMina || plan.hoursPerDay, movements, wetFactor: wetFactor(premises) }, premises));
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
  interferenceMin: number;
  cycleMin: number;
  payloadT: number;
  perTruckTph: number;
  loaderTph: number;
  trucksExact: number;
  trucks: number;
  /** t secas no período */
  tonnesDry: number;
  /** meta digitada pelo analista (não a do fluxo) */
  overridden: boolean;
  /** participação no fluxo (0–1) */
  sharePct: number;
}

/** Período da aba Circuito (padrão: um mês das premissas). */
export function circuitPeriod(model: SimModel, premises: DetailedPremises) {
  const p = model.period ?? { kind: 'mes' as PeriodKind };
  const qty = p.qty ?? 1;
  const cal = model.plan?.calendar;
  let d = periodDays(p.kind, cal, p.kind === 'dias' ? p.days ?? qty : undefined, undefined, qty);
  // 1 mês ligado às premissas: o mesmo calendário diário do 2. Dimensionamento (mesmas horas)
  const dc = premises.dailyCalendar;
  if (linkOn(model) && p.kind === 'mes' && qty === 1 && dc?.length) {
    const hpd = premises.contractedHoursMina || 24;
    d = { work: dc.reduce((a, x) => a + (x.hoursMina || 0), 0) / hpd, calendar: dc.length };
  }
  const romT = p.romT ?? suggestedRomT(premises, p.kind, p.kind === 'dias' ? p.days ?? qty : undefined, qty);
  return { kind: p.kind, qty, days: p.days, romT, suggested: p.romT === undefined, workDays: d.work, calendarDays: d.calendar, fromPremisesCalendar: linkOn(model) && p.kind === 'mes' && qty === 1 && !!dc?.length };
}

/** Meta de cada circuito no período, ciclo analítico e caminhões necessários (igual ao Dimensionamento). */
/** Massas secas por mês de cada movimentação da rede (id da rota → t), do 2. Dimensionamento. */
export type EdgeMasses = Map<string, number>;

export function circuitTargets(model: SimModel, premises: DetailedPremises, edges?: EdgeMasses): CircuitCalc[] {
  if (!model.circuits.length) return [];
  const per = circuitPeriod(model, premises);
  const flows = flowDryTonnes(premises, per.romT);
  const k = wetFactor(premises);
  const sc = model.scenarios[0];
  const cfg0 = model.configs[0];
  if (!sc || !cfg0) return [];
  // UF: com as perdas detalhadas a simulação usa eventos (eficiência 100%), mas a conta analítica usa a UF calculada
  const ufPct = linkOn(model) ? premises.ufMina : sc.efficiency;
  const prodH = per.workDays * (sc.hoursPerDay || 24) * ((sc.truckDf || 0) / 100) * ((ufPct || 0) / 100);
  const flowOf = (c: Circuit) => c.flow ?? guessFlow(c.name);
  const shareSum: Partial<Record<Flow, number>> = {};
  for (const c of model.circuits) shareSum[flowOf(c)] = (shareSum[flowOf(c)] ?? 0) + (c.share ?? 1);
  const queue = linkOn(model) ? premises.queueMin || 0 : 0;
  const interference = linkOn(model) ? interferenceMin(premises) : 0;
  // produto, rejeito e estéril saem do ROM que de fato é transportado (inclusive metas digitadas nos circuitos de ROM)
  const romCircuits = model.circuits.filter((c) => flowOf(c) === 'rom');
  const romDry = romCircuits.length
    ? romCircuits.reduce((a, c) => a + (c.tonnesDryOverride ?? flows.rom * ((c.share ?? 1) / (shareSum.rom || 1))), 0)
    : per.romT;
  const derived = flowDryTonnes(premises, romDry);
  return model.circuits.map((c) => {
    const flow = flowOf(c);
    const sharePct = flow === 'outro' ? 1 : (c.share ?? 1) / (shareSum[flow] || 1);
    // movimentação da rede ligada ao circuito: massa da movimentação no mês × (ROM do período ÷ ROM do mês)
    // meses do período: ROM do período ÷ ROM do mês (no modo só transporte, pela duração do período)
    const months = premises.flowMode === 'transporte' || !premises.targetMonthlyROM ? periodMonths(per.kind, per.kind === 'dias' ? per.days ?? per.qty : undefined, per.qty) : per.romT / premises.targetMonthlyROM;
    const edgeT = c.edgeId && edges?.has(c.edgeId) ? edges.get(c.edgeId)! * months : undefined;
    const fromFlow = edgeT !== undefined ? edgeT : flow === 'outro' ? c.tonnesManual ?? 0 : (flow === 'rom' ? flows.rom : derived[flow]) * sharePct;
    const overridden = c.tonnesDryOverride !== undefined && flow !== 'outro';
    const tonnesDry = overridden ? c.tonnesDryOverride! : fromFlow;
    const tonnes = tonnesDry * k;
    const r = model.routes.find((x) => x.id === c.routeId);
    const weighMin = c.weighing ? c.weighMin : 0;
    // frota mista: média ponderada dos tipos do circuito (cada um com carga útil e ciclo próprios)
    const perf = mixOf(model, c, configFor(model, c, cfg0)).map(({ cfg, weight }) => {
      const tt = r ? travelTimes(r.points, cfg.speed, limitsOf(model, cfg), cfg.rollingResistance ?? model.rollingResistance) : { loaded: 0, empty: 0 };
      const loadMin = loadTime(cfg, c);
      const dumpMin = cfg.dumpMin + cfg.maneuverMin;
      const interfC = interference + Math.max(0, cfg.trafficDelayMin ?? 0);
      const stopsMin = (c.stops ?? []).reduce((a, x) => a + x.stopMin * (x.dir === 'ambos' ? 2 : 1), 0);
      const cycleMin = loadMin + tt.loaded + tt.empty + dumpMin + weighMin + queue + interfC + stopsMin;
      const payloadT = payloadFor(cfg, c);
      return { weight, tt, loadMin, dumpMin, interfC, cycleMin, payloadT, perTruckTph: cycleMin > 0 ? (payloadT * 60) / cycleMin : 0 };
    });
    const wSum = perf.reduce((a, p) => a + p.weight, 0) || 1;
    const avg = (f: (p: (typeof perf)[number]) => number) => perf.reduce((a, p) => a + p.weight * f(p), 0) / wSum;
    const tt = { loaded: avg((p) => p.tt.loaded), empty: avg((p) => p.tt.empty) };
    const loadMin = avg((p) => p.loadMin);
    const dumpMin = avg((p) => p.dumpMin);
    const interfC = avg((p) => p.interfC);
    const cycleMin = avg((p) => p.cycleMin);
    const payloadT = avg((p) => p.payloadT);
    const perTruckTph = avg((p) => p.perTruckTph);
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
      interferenceMin: interfC,
      cycleMin,
      payloadT,
      perTruckTph,
      loaderTph: c.loaderTph,
      trucksExact,
      trucks: Math.ceil(trucksExact - 1e-6),
      tonnesDry,
      overridden,
      sharePct,
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
  const put = (origin: string, destination: string, material: string, period: number, t: number, derived?: Movement['derived']) => {
    let m = movements.find((x) => x.origin === origin && x.destination === destination);
    if (!m) {
      m = { ...newMovementLike(movements[0]), id: newId(), material, origin, destination, tonnes: Array.from({ length: n }, () => 0) };
      movements.push(m);
    }
    m.derived = derived;
    while (m.tonnes.length < n) m.tonnes.push(0);
    m.tonnes[period - 1] = Math.round(t);
  };
  plan.periods.forEach((per: Period, i) => {
    const romT = per.romT ?? suggestedRomT(premises, per.kind ?? 'ano', per.days, per.qty);
    const f = flowDryTonnes(premises, romT);
    // divisão entre frentes: pela área de cada frente no período; sem área, em partes iguais
    const areas = fronts.map((fr) => plan.fronts.filter((a) => a.period === i + 1 && a.front === fr.name).reduce((s, a) => s + a.areaM2, 0));
    const totalA = areas.reduce((a, b) => a + b, 0);
    fronts.forEach((fr, k) => {
      const share = totalA > 0 ? areas[k] / totalA : 1 / fronts.length;
      put(fr.id, plant.id, 'Minério (ROM)', i + 1, f.rom * share, { kind: 'rom', source: fr.id });
      if (pile && f.esteril > 0) put(fr.id, pile.id, 'Estéril', i + 1, f.esteril * share, { kind: 'esteril', source: fr.id });
    });
    if (terminal) put(plant.id, terminal.id, 'Produto', i + 1, f.produto, { kind: 'produto', source: plant.id });
    if (disposal && f.rejeito > 0) put(plant.id, disposal.id, 'Rejeito filtrado', i + 1, f.rejeito, { kind: 'rejeito', source: plant.id });
  });
  return { plan: syncDerived({ ...plan, movements, tonnesBasis: 'seca', wetFactor: wetFactor(premises) }, premises), warnings };
}

/**
 * Recalcula as movimentações derivadas a partir do ROM (fonte única):
 * produto = ROM que entra na usina × RM global; rejeito = ROM que entra na usina × rejeito total;
 * estéril = ROM que sai da frente × REM. Assim o mesmo número não aparece com valores diferentes.
 * O plano precisa estar em t secas para a conta valer.
 */
export function syncDerived(plan: MinePlan, premises: DetailedPremises): MinePlan {
  if (!plan.movements.some((m) => m.derived)) return plan;
  const s = flowShares(premises);
  const n = plan.periods.length;
  let changed = false;
  // 1) ROM das frentes vinculadas = meta de ROM do período × participação da frente (área no período)
  const romLinked = plan.movements.filter((m) => m.derived?.kind === 'rom');
  const romTonnes = new Map<string, number[]>();
  if (romLinked.length) {
    plan.periods.forEach((per, i) => {
      const meta = per.romT ?? suggestedRomT(premises, per.kind ?? 'ano', per.days, per.qty);
      const areas = romLinked.map((m) => {
        const name = plan.places.find((p) => p.id === m.origin)?.name;
        return plan.fronts.filter((a) => a.period === i + 1 && a.front === name).reduce((acc, a) => acc + a.areaM2, 0);
      });
      const tot = areas.reduce((a, b) => a + b, 0);
      romLinked.forEach((m, k) => {
        const arr = romTonnes.get(m.id) ?? [];
        arr[i] = Math.round(meta * (tot > 0 ? areas[k] / tot : 1 / romLinked.length));
        romTonnes.set(m.id, arr);
      });
    });
  }
  const romOf = (m: Movement, i: number) => (m.derived?.kind === 'rom' ? romTonnes.get(m.id)?.[i] ?? 0 : m.tonnes[i] ?? 0);
  const isRom = (m: Movement) => !m.derived || m.derived.kind === 'rom';
  const isRomInto = (m: Movement, place: string) => isRom(m) && m.destination === place && plan.places.find((p) => p.id === m.origin)?.kind === 'frente';
  const isRomFrom = (m: Movement, place: string) => isRom(m) && m.origin === place && plan.places.find((p) => p.id === m.destination)?.kind === 'usina';
  const movements = plan.movements.map((m) => {
    if (!m.derived) return m;
    if (m.derived.kind === 'rom') {
      const tonnes = Array.from({ length: n }, (_, i) => romOf(m, i));
      if (tonnes.every((t, i) => t === (m.tonnes[i] ?? 0)) && m.tonnes.length === n) return m;
      changed = true;
      return { ...m, tonnes };
    }
    const tonnes = Array.from({ length: n }, (_, i) => {
      const rom =
        m.derived!.kind === 'esteril'
          ? plan.movements.filter((x) => isRomFrom(x, m.derived!.source)).reduce((a, x) => a + romOf(x, i), 0)
          : plan.movements.filter((x) => isRomInto(x, m.derived!.source)).reduce((a, x) => a + romOf(x, i), 0);
      const f = m.derived!.kind === 'produto' ? s.rm : m.derived!.kind === 'rejeito' ? s.rej : s.rem;
      return Math.round(rom * f);
    });
    if (tonnes.every((t, i) => t === (m.tonnes[i] ?? 0)) && m.tonnes.length === n) return m;
    changed = true;
    return { ...m, tonnes };
  });
  const k = wetFactor(premises);
  if (!changed && plan.wetFactor === k) return plan;
  return { ...plan, movements, wetFactor: k };
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
