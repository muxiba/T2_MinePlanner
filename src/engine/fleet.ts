/**
 * Motor de dimensionamento de frota (v3).
 *
 * Princípios (prática usual de planejamento de lavra):
 *  0. Fonte única: DF, UF, capacidade do caminhão e número de caminhões vêm das Premissas
 *     Fundamentais. Uma rota só usa valores próprios se marcada (ownRates).
 *  1. Horas efetivas no mês = horas do calendário × DF × UF
 *     (o "EO" das premissas é o próprio DF × UF: não é aplicado de novo).
 *  2. Ciclo do caminhão = carga + ida carregado + descarga + volta vazio + pesagens + fila/manobra.
 *     A carga vem do equipamento de carga (nº de caçambadas × ciclo) quando ele é informado.
 *  3. Carga útil = menor entre a capacidade em peso e o volume da caçamba × densidade solta.
 *  4. Rota limitada pelo menor entre transporte (caminhões) e carga (escavadeira/carregadeira).
 *     Fator de compatibilidade (match factor) MF = (Ncam × t_carga) / (Ncarga × t_ciclo):
 *     MF < 1 → caminhões são o limite (carga espera); MF > 1 → carga é o limite (caminhões em fila).
 *  5. Massa úmida = massa seca × (1 + umidade + perda)  (padrão da planilha)
 *     ou, opcional, massa seca ÷ (1 − umidade) × (1 + perda) para umidade em base úmida.
 *  6. Caminhões são inteiros por rota; a folga (frota das premissas − caminhões nas rotas) pode ser
 *     distribuída pelo otimizador nas rotas que não atingem a meta.
 *
 * Todas as funções são puras (sem React), para poderem ser testadas isoladamente.
 */
import type { DetailedPremises, EquipmentCatalog, LoaderSetup, Route, RouteKind, TruckClass } from '../types';

/** Tempo de troca de caminhão sob o equipamento de carga (posicionamento), em minutos. */
export const TRUCK_EXCHANGE_MIN = 0.6;
/** Eficiência alvo usada nas sugestões: 50 min produtivos por hora. */
export const TARGET_EO = 83;
/** Disponibilidade física alvo usada nas sugestões. */
export const TARGET_DF = 90;
/** Utilização alvo usada nas sugestões. */
export const TARGET_UF = 90;
export const DEFAULT_LOOSE_DENSITY = 2.0;

export const DEFAULT_CATALOG: EquipmentCatalog = {
  trucks: [
    { id: 'rod-30', name: 'Basculante rodoviário 6x4 (~30 t)', payloadT: 30, volumeM3: 18 },
    { id: 'art-40', name: 'Articulado 6x6 (~38 t)', payloadT: 38, volumeM3: 23 },
    { id: 'rig-60', name: 'Rígido fora de estrada (~60 t)', payloadT: 60, volumeM3: 38 },
    { id: 'rig-90', name: 'Rígido fora de estrada (~90 t)', payloadT: 90, volumeM3: 58 },
  ],
  loaders: [
    { id: 'esc-20', name: 'Escavadeira ~20 t (1,2 m³)', bucketM3: 1.2, cycleSec: 20 },
    { id: 'esc-35', name: 'Escavadeira ~35 t (2,0 m³)', bucketM3: 2.0, cycleSec: 22 },
    { id: 'esc-50', name: 'Escavadeira ~50 t (3,0 m³)', bucketM3: 3.0, cycleSec: 24 },
    { id: 'esc-75', name: 'Escavadeira ~75 t (4,5 m³)', bucketM3: 4.5, cycleSec: 26 },
    { id: 'pa-35', name: 'Pá carregadeira (3,5 m³)', bucketM3: 3.5, cycleSec: 35 },
    { id: 'pa-55', name: 'Pá carregadeira grande (5,5 m³)', bucketM3: 5.5, cycleSec: 40 },
  ],
};

export const KIND_LABELS: Record<RouteKind, string> = {
  rom: 'ROM (mina → planta)',
  product: 'Produto (expedição)',
  tailings: 'Rejeito',
  waste: 'Estéril',
};

/* -------------------------------------------------------------------------- */
/* Tipos de resultado                                                          */
/* -------------------------------------------------------------------------- */

export interface HoursCascade {
  calendar: number;
  df: number;
  uf: number;
  eo: number;
  /** horas efetivas no mês = calendário × DF × UF × EO */
  effective: number;
}

export interface CycleBreakdown {
  loadMin: number;
  travelLoadedMin: number;
  dumpMin: number;
  travelEmptyMin: number;
  weighMin: number;
  queueMin: number;
  calculatedMin: number;
  informedMin: number;
  /** ciclo efetivamente usado */
  totalMin: number;
  mode: 'calculated' | 'informed';
}

export interface LoaderAnalysis {
  name: string;
  count: number;
  /** caçambadas por caminhão */
  passes: number;
  /** t por caçambada */
  passLoadT: number;
  /** tempo para carregar 1 caminhão (min), sem a troca */
  loadMin: number;
  hours: HoursCascade;
  /** t úmidas que a carga consegue entregar no mês */
  capacityWetT: number;
  /** caminhões que saturam a carga (acima disso viram fila) */
  trucksToSaturate: number;
  matchFactor: number;
  passesStatus: 'ok' | 'poucas' | 'muitas';
}

export interface RouteAnalysis {
  id: string;
  name: string;
  kind: RouteKind;
  targetDryT: number;
  targetWetT: number;
  payloadT: number;
  payloadLimitedBy: 'peso' | 'volume';
  cycle: CycleBreakdown;
  hours: HoursCascade;
  /** t úmidas por caminhão por hora efetiva */
  truckRateTph: number;
  /** t úmidas por caminhão no mês */
  truckMonthT: number;
  trucksAllocated: number;
  trucksNeededExact: number;
  trucksNeeded: number;
  transportCapacityWetT: number;
  loader: LoaderAnalysis | null;
  capacityWetT: number;
  limitedBy: 'transporte' | 'carga';
  /** capacidade / necessidade (1 = atende exato) */
  ratio: number;
  /** caminhões alocados que não aumentam produção (acima da saturação da carga ou da necessidade) */
  idleTrucks: number;
  /** horas efetivas extras de caminhões da folga alocados por horas (Alocação de Frota Extra) */
  extraEffHours: number;
  extraCapacityWetT: number;
  /** a rota usa valores próprios em vez das premissas */
  ownRates: boolean;
}

export type StageId = 'carga' | 'transporte_rom' | 'planta' | 'produto' | 'rejeito' | 'esteril';

export interface Stage {
  id: StageId;
  label: string;
  needT: number;
  capacityT: number;
  ratio: number;
  unit: 't/mês';
  basis: 'úmida' | 'seca';
}

export type ActionKind = 'deficit' | 'remanejar' | 'produtividade' | 'equipamento' | 'planta' | 'folga';

export interface Action {
  kind: ActionKind;
  title: string;
  detail: string;
  /** ganho de produção em t/mês (úmida) ou economia de caminhões; usado para ordenar */
  gainT?: number;
  trucksSaved?: number;
  priority: number;
}

export interface ClassOption {
  truck: TruckClass;
  payloadT: number;
  trucksNeeded: number;
  trucksNeededExact: number;
  passes: number | null;
  passesStatus: 'ok' | 'poucas' | 'muitas' | null;
  current: boolean;
}

export interface FleetAnalysis {
  mina: { calendarHours: number; uf: number };
  planta: HoursCascade;
  routes: RouteAnalysis[];
  stages: Stage[];
  bottleneck: Stage | null;
  meetsTarget: boolean;
  /** menor razão capacidade/necessidade do sistema */
  systemRatio: number;
  romTargetDryT: number;
  romDeliverableDryT: number;
  fleet: {
    /** caminhões nas rotas (inteiros, informados pelo planejador) */
    allocated: number;
    /** soma do necessário por rota (arredondado para cima em cada rota) */
    needed: number;
    neededExact: number;
    /** frota das premissas (fonte única) */
    premise: number;
    idle: number;
    /** caminhões da folga usados em alocações por horas (equivalente em caminhões-mês) */
    extraEquivalent: number;
    /** frota sem rota = premissas − nas rotas − alocações extras */
    spare: number;
  };
  actions: Action[];
  classComparison: { routeId: string; routeName: string; options: ClassOption[] } | null;
}

/* -------------------------------------------------------------------------- */
/* Funções básicas                                                             */
/* -------------------------------------------------------------------------- */

const pct = (v: number | undefined, fallback: number) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) / 100 : fallback);

export function routeKind(route: Route): RouteKind {
  if (route.kind) return route.kind;
  const n = route.name.toLowerCase();
  if (n.includes('terminal') || n.includes('produto') || n.includes('product')) return 'product';
  if (n.includes('baia') || n.includes('rejeito') || n.includes('tailing')) return 'tailings';
  if (n.includes('estéril') || n.includes('esteril') || n.includes('waste')) return 'waste';
  return 'rom';
}

/** Massa úmida transportada a partir da massa seca. */
export function wetFromDry(dryT: number, moisturePct: number, lossPct: number, mode: 'somada' | 'base_umida' = 'somada'): number {
  const u = Math.min(Math.max(moisturePct, 0), 60) / 100;
  const p = Math.max(lossPct, 0) / 100;
  return mode === 'base_umida' ? (dryT / (1 - u)) * (1 + p) : dryT * (1 + u + p);
}

/** DF, UF e capacidade nominal que valem para a rota (premissas, salvo valores próprios marcados). */
export function routeRates(route: Route, premises: DetailedPremises, area: 'mina' | 'planta') {
  const own = route.ownRates === true;
  const df = own ? route.mechanicalAvailability : area === 'mina' ? premises.dfMina : premises.dfPlanta;
  const uf = own ? (route.utilization ?? (area === 'mina' ? premises.ufMina : premises.ufPlanta)) : area === 'mina' ? premises.ufMina : premises.ufPlanta;
  const capacityT = own ? route.truckCapacity : premises.truckCapacity || route.truckCapacity;
  return { df, uf, capacityT, own };
}

/** Horas de calendário de caminhões da folga alocados nesta rota (Alocação de Frota Extra). */
/** Fila por ciclo e volume da caçamba: valor da rota, se informado, senão o das premissas. */
export function routeQueueMin(route: Route, premises: DetailedPremises) {
  return route.queueMin ?? premises.queueMin ?? 0;
}
export function routeVolumeM3(route: Route, premises: DetailedPremises) {
  const v = route.truckVolumeM3 ?? premises.truckVolumeM3;
  return v && v > 0 ? v : undefined;
}

export function extraCalendarHours(route: Route, premises: DetailedPremises) {
  return (premises.extraAllocations ?? []).filter((a) => a.routeId === route.id).reduce((acc, a) => acc + a.truckCount * a.durationHours, 0);
}

export function sumCalendarHours(premises: DetailedPremises, area: 'mina' | 'planta'): number {
  const fromCalendar = (premises.dailyCalendar ?? []).reduce(
    (acc, d) => acc + (area === 'mina' ? d.hoursMina : d.hoursPlanta),
    0,
  );
  if (fromCalendar > 0) return fromCalendar;
  return premises.calendarDays * (area === 'mina' ? premises.contractedHoursMina : premises.contractedHoursPlanta);
}

export function cascade(calendar: number, dfPct: number, ufPct: number, eoPct: number): HoursCascade {
  const df = pct(dfPct, 1);
  const uf = pct(ufPct, 1);
  const eo = pct(eoPct, 1);
  return { calendar, df, uf, eo, effective: calendar * df * uf * eo };
}

function effectivePayload(capacityT: number, volumeM3: number | undefined, density: number) {
  const byWeight = Math.max(capacityT, 0);
  if (volumeM3 && volumeM3 > 0) {
    const byVolume = volumeM3 * density;
    if (byVolume < byWeight) return { payloadT: byVolume, limitedBy: 'volume' as const };
  }
  return { payloadT: byWeight, limitedBy: 'peso' as const };
}

function passesStatusOf(passes: number): 'ok' | 'poucas' | 'muitas' {
  if (passes < 3) return 'poucas';
  if (passes > 6) return 'muitas';
  return 'ok';
}

/** Carga: caçambadas, tempo de carga por caminhão e status. */
export function loaderLoading(loader: Pick<LoaderSetup, 'bucketM3' | 'fillFactor' | 'cycleSec'>, payloadT: number, density: number) {
  const passLoadT = Math.max(loader.bucketM3, 0.01) * pct(loader.fillFactor, 0.9) * density;
  const passes = Math.max(1, Math.ceil(payloadT / passLoadT - 1e-9));
  const loadMin = (passes * Math.max(loader.cycleSec, 1)) / 60;
  return { passLoadT, passes, loadMin, passesStatus: passesStatusOf(passes) };
}

function cycleFor(route: Route, premises: DetailedPremises, loadMin: number): CycleBreakdown {
  const vLoaded = Math.max(premises.velocidadeCheio, 1) * (1000 / 60); // m/min
  const vEmpty = Math.max(premises.velocidadeVazio, 1) * (1000 / 60);
  const travelLoadedMin = Math.max(route.distance, 0) / vLoaded;
  const travelEmptyMin = Math.max(route.distance, 0) / vEmpty;
  const dumpMin = Math.max(premises.dumpingTime, 0);
  const weighMin = Math.max(premises.weighingTimeLoaded, 0) + Math.max(premises.weighingTimeEmpty, 0);
  const queueMin = Math.max(route.queueMin ?? 0, 0);
  const calculatedMin = loadMin + travelLoadedMin + dumpMin + travelEmptyMin + weighMin + queueMin;
  const informedMin = Math.max(route.cycleTime || 0, 0);
  const mode = route.cycleMode === 'informed' && informedMin > 0 ? 'informed' : 'calculated';
  return {
    loadMin,
    travelLoadedMin,
    dumpMin,
    travelEmptyMin,
    weighMin,
    queueMin,
    calculatedMin,
    informedMin,
    totalMin: Math.max(mode === 'informed' ? informedMin : calculatedMin, 0.1),
    mode,
  };
}

/** Distribui a meta mensal (seca) entre as rotas de cada tipo, respeitando massas fixadas nas rotas. */
export function routeTargets(routes: Route[], premises: DetailedPremises): Map<string, number> {
  const seco = premises.processType === 'seco';
  const rm = seco ? 100 : premises.rmGlobal;
  const rej = seco ? 0 : premises.rejeitoTotal;
  const active = routes.filter((r) => r.active);
  const byKind = (k: RouteKind) => active.filter((r) => routeKind(r) === k);
  const out = new Map<string, number>();

  const distribute = (group: Route[], total: number) => {
    const fixed = group.reduce((a, r) => a + (r.targetMass || 0), 0);
    const auto = group.filter((r) => !r.targetMass);
    const rest = Math.max(0, total - fixed);
    for (const r of group) out.set(r.id, r.targetMass || (auto.length ? rest / auto.length : 0));
  };

  const romGroup = byKind('rom');
  distribute(romGroup, premises.targetMonthlyROM);
  const romTotal = romGroup.reduce((a, r) => a + (out.get(r.id) || 0), 0) || premises.targetMonthlyROM;
  distribute(byKind('product'), (romTotal * rm) / 100);
  distribute(byKind('tailings'), (romTotal * rej) / 100);
  distribute(byKind('waste'), premises.hasWasteRock ? premises.targetMonthlyWasteRock : 0);
  return out;
}

/** Análise completa de uma rota (com overrides opcionais para simular cenários). */
export function analyzeRoute(
  route: Route,
  premises: DetailedPremises,
  targetDryT: number,
  overrides: { payloadT?: number; volumeM3?: number; trucks?: number; df?: number; uf?: number; eo?: number; queueMin?: number; speedFactor?: number; extraHours?: number } = {},
): RouteAnalysis {
  const kind = routeKind(route);
  const area = kind === 'product' || kind === 'tailings' ? 'planta' : 'mina';
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : DEFAULT_LOOSE_DENSITY;
  const targetWetT = wetFromDry(targetDryT, premises.umidadeNatural, premises.perdaMaterial, premises.moistureMode);
  const rates = routeRates(route, premises, area);

  const { payloadT, limitedBy: payloadLimitedBy } = effectivePayload(
    overrides.payloadT ?? rates.capacityT,
    overrides.volumeM3 ?? routeVolumeM3(route, premises),
    density,
  );

  const loading = route.loader ? loaderLoading(route.loader, payloadT, density) : null;
  const loadMin = loading ? loading.loadMin : Math.max(premises.loadingTime, 0);

  const speedFactor = overrides.speedFactor ?? 1;
  const effPremises = speedFactor === 1 ? premises : { ...premises, velocidadeCheio: premises.velocidadeCheio * speedFactor, velocidadeVazio: premises.velocidadeVazio * speedFactor };
  const cycle = cycleFor({ ...route, queueMin: overrides.queueMin ?? routeQueueMin(route, premises) }, effPremises, loadMin);

  const calendar = sumCalendarHours(premises, area);
  const uf = overrides.uf ?? rates.uf;
  // horas efetivas = calendário × DF × UF (EO só entra como alavanca de cenário, padrão 100%)
  const hours = cascade(calendar, overrides.df ?? rates.df, uf, overrides.eo ?? 100);

  const truckRateTph = (payloadT * 60) / cycle.totalMin;
  const truckMonthT = truckRateTph * hours.effective;
  const trucksAllocated = Math.max(0, overrides.trucks ?? route.truckCount ?? 0);
  const trucksNeededExact = truckMonthT > 0 ? targetWetT / truckMonthT : 0;
  const trucksNeeded = Math.ceil(trucksNeededExact - 1e-6);
  // caminhões da folga alocados por horas: horas de calendário × DF × UF
  const extraEffHours = (overrides.extraHours ?? extraCalendarHours(route, premises)) * hours.df * hours.uf * hours.eo;
  const extraCapacityWetT = truckRateTph * extraEffHours;
  const transportCapacityWetT = trucksAllocated * truckMonthT + extraCapacityWetT;

  let loader: LoaderAnalysis | null = null;
  if (route.loader && loading) {
    const lh = cascade(calendar, route.loader.availability, uf, overrides.eo ?? 100);
    const serviceMin = loading.loadMin + TRUCK_EXCHANGE_MIN;
    const count = Math.max(route.loader.count, 0);
    const capacityWetT = count * (60 / serviceMin) * payloadT * lh.effective;
    // caminhões que a carga consegue atender sem fila (por hora efetiva de cada um)
    const trucksToSaturate = count > 0 ? (count * cycle.totalMin) / serviceMin : 0;
    const matchFactor = count > 0 ? (trucksAllocated * serviceMin) / (count * cycle.totalMin) : Infinity;
    loader = {
      name: route.loader.name,
      count,
      passes: loading.passes,
      passLoadT: loading.passLoadT,
      loadMin: loading.loadMin,
      hours: lh,
      capacityWetT,
      trucksToSaturate,
      matchFactor,
      passesStatus: loading.passesStatus,
    };
  }

  const capacityWetT = loader ? Math.min(transportCapacityWetT, loader.capacityWetT) : transportCapacityWetT;
  const limitedBy = loader && loader.capacityWetT < transportCapacityWetT ? 'carga' : 'transporte';
  const ratio = targetWetT > 0 ? capacityWetT / targetWetT : capacityWetT > 0 ? Infinity : 1;
  const usefulTrucks = Math.min(
    trucksNeeded,
    loader ? Math.ceil(loader.trucksToSaturate - 1e-6) : Infinity,
  );
  const idleTrucks = Math.max(0, trucksAllocated - usefulTrucks);

  return {
    id: route.id,
    name: route.name,
    kind,
    targetDryT,
    targetWetT,
    payloadT,
    payloadLimitedBy,
    cycle,
    hours,
    truckRateTph,
    truckMonthT,
    trucksAllocated,
    trucksNeededExact,
    trucksNeeded,
    transportCapacityWetT,
    loader,
    capacityWetT,
    limitedBy,
    ratio,
    idleTrucks,
    extraEffHours,
    extraCapacityWetT,
    ownRates: rates.own,
  };
}

/* -------------------------------------------------------------------------- */
/* Análise do sistema                                                          */
/* -------------------------------------------------------------------------- */

function stageFrom(id: StageId, label: string, list: RouteAnalysis[], field: 'capacityWetT' | 'loaderCap'): Stage | null {
  if (!list.length) return null;
  const needT = list.reduce((a, r) => a + r.targetWetT, 0);
  const capacityT = list.reduce(
    (a, r) => a + (field === 'capacityWetT' ? r.capacityWetT : r.loader ? r.loader.capacityWetT : r.capacityWetT),
    0,
  );
  if (needT <= 0) return null;
  return { id, label, needT, capacityT, ratio: capacityT / needT, unit: 't/mês', basis: 'úmida' };
}

const fmtT = (n: number) => `${Math.round(n).toLocaleString('pt-BR')} t`;
const fmtN = (n: number, d = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function analyzeFleet(routes: Route[], premises: DetailedPremises): FleetAnalysis {
  const targets = routeTargets(routes, premises);
  const active = routes.filter((r) => r.active);
  const analyses = active.map((r) => analyzeRoute(r, premises, targets.get(r.id) || 0));

  const rom = analyses.filter((a) => a.kind === 'rom');
  const prod = analyses.filter((a) => a.kind === 'product');
  const tail = analyses.filter((a) => a.kind === 'tailings');
  const waste = analyses.filter((a) => a.kind === 'waste');

  const planta = cascade(sumCalendarHours(premises, 'planta'), premises.dfPlanta, premises.ufPlanta, 100);
  const plantCapacityDry = Math.max(premises.plantFeedRateTPH || 0, 0) * planta.effective;

  const stages: Stage[] = [];
  const romWithLoader = rom.filter((r) => r.loader);
  if (romWithLoader.length) {
    const s = stageFrom('carga', 'Carga na mina', romWithLoader, 'loaderCap');
    if (s) stages.push(s);
  }
  const transporte = stageFrom('transporte_rom', 'Transporte de ROM', rom, 'capacityWetT');
  if (transporte) stages.push(transporte);
  else if (premises.targetMonthlyROM > 0) {
    // sem rota de ROM ativa: nada chega à planta
    stages.push({
      id: 'transporte_rom',
      label: 'Transporte de ROM',
      needT: wetFromDry(premises.targetMonthlyROM, premises.umidadeNatural, premises.perdaMaterial, premises.moistureMode),
      capacityT: 0,
      ratio: 0,
      unit: 't/mês',
      basis: 'úmida',
    });
  }
  if (premises.targetMonthlyROM > 0 && plantCapacityDry > 0) {
    stages.push({
      id: 'planta',
      label: 'Planta (alimentação)',
      needT: premises.targetMonthlyROM,
      capacityT: plantCapacityDry,
      ratio: plantCapacityDry / premises.targetMonthlyROM,
      unit: 't/mês',
      basis: 'seca',
    });
  }
  const sProd = stageFrom('produto', 'Expedição de produto', prod, 'capacityWetT');
  if (sProd) stages.push(sProd);
  const sTail = stageFrom('rejeito', 'Transporte de rejeito', tail, 'capacityWetT');
  if (sTail) stages.push(sTail);
  const sWaste = stageFrom('esteril', 'Transporte de estéril', waste, 'capacityWetT');
  if (sWaste) stages.push(sWaste);

  const bottleneck = stages.length ? stages.reduce((min, s) => (s.ratio < min.ratio ? s : min)) : null;
  const systemRatio = bottleneck ? bottleneck.ratio : 1;
  const romTargetDryT = premises.targetMonthlyROM;
  // o ROM que chega e é processado é limitado pela pior etapa do caminho mina → planta
  const romPathRatio = Math.min(1, ...stages.filter((s) => ['carga', 'transporte_rom', 'planta'].includes(s.id)).map((s) => s.ratio));
  const romDeliverableDryT = romTargetDryT * (Number.isFinite(romPathRatio) ? romPathRatio : 1);

  const allocated = analyses.reduce((a, r) => a + r.trucksAllocated, 0);
  const needed = analyses.reduce((a, r) => a + r.trucksNeeded, 0);
  const neededExact = analyses.reduce((a, r) => a + r.trucksNeededExact, 0);
  const idle = analyses.reduce((a, r) => a + r.idleTrucks, 0);
  const calMina = sumCalendarHours(premises, 'mina') || 1;
  const extraEquivalent = active.reduce((a, r) => a + extraCalendarHours(r, premises), 0) / calMina;
  const spare = Math.max(0, (premises.truckCount || 0) - allocated - extraEquivalent);

  const actions = buildActions(active, analyses, premises, targets, stages, plantCapacityDry);
  const mainRom = [...rom].sort((a, b) => b.targetWetT - a.targetWetT)[0];
  const classComparison = mainRom
    ? {
        routeId: mainRom.id,
        routeName: mainRom.name,
        options: compareTruckClasses(active.find((r) => r.id === mainRom.id)!, premises, targets.get(mainRom.id) || 0),
      }
    : null;

  return {
    mina: { calendarHours: sumCalendarHours(premises, 'mina'), uf: pct(premises.ufMina, 1) },
    planta,
    routes: analyses,
    stages,
    bottleneck,
    meetsTarget: systemRatio >= 0.999,
    systemRatio,
    romTargetDryT,
    romDeliverableDryT,
    fleet: { allocated, needed, neededExact, premise: premises.truckCount || 0, idle, extraEquivalent, spare },
    actions,
    classComparison,
  };
}

/* -------------------------------------------------------------------------- */
/* Comparador de classes de caminhão                                           */
/* -------------------------------------------------------------------------- */

export function compareTruckClasses(route: Route, premises: DetailedPremises, targetDryT: number): ClassOption[] {
  const catalog = premises.equipmentCatalog ?? DEFAULT_CATALOG;
  const current = analyzeRoute(route, premises, targetDryT);
  const options: ClassOption[] = catalog.trucks.map((t) => {
    const a = analyzeRoute(route, premises, targetDryT, { payloadT: t.payloadT, volumeM3: t.volumeM3 });
    return {
      truck: t,
      payloadT: a.payloadT,
      trucksNeeded: a.trucksNeeded,
      trucksNeededExact: a.trucksNeededExact,
      passes: a.loader ? a.loader.passes : null,
      passesStatus: a.loader ? a.loader.passesStatus : null,
      current: Math.abs(t.payloadT - current.payloadT) < 0.5,
    };
  });
  if (!options.some((o) => o.current)) {
    options.unshift({
      truck: { id: 'atual', name: `Frota atual (${fmtN(current.payloadT, 0)} t)`, payloadT: current.payloadT, volumeM3: routeVolumeM3(route, premises) ?? 0 },
      payloadT: current.payloadT,
      trucksNeeded: current.trucksNeeded,
      trucksNeededExact: current.trucksNeededExact,
      passes: current.loader ? current.loader.passes : null,
      passesStatus: current.loader ? current.loader.passesStatus : null,
      current: true,
    });
  }
  return options.sort((a, b) => a.payloadT - b.payloadT);
}

/* -------------------------------------------------------------------------- */
/* Recomendações                                                               */
/* -------------------------------------------------------------------------- */

function buildActions(
  routes: Route[],
  analyses: RouteAnalysis[],
  premises: DetailedPremises,
  targets: Map<string, number>,
  stages: Stage[],
  plantCapacityDry: number,
): Action[] {
  const actions: Action[] = [];
  const byId = new Map(routes.map((r) => [r.id, r]));
  const catalog = premises.equipmentCatalog ?? DEFAULT_CATALOG;
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : DEFAULT_LOOSE_DENSITY;

  // 1. Planta como gargalo
  const plant = stages.find((s) => s.id === 'planta');
  if (plant && plant.ratio < 0.999) {
    const missing = plant.needT - plant.capacityT;
    actions.push({
      kind: 'planta',
      priority: 0,
      title: 'A planta não processa a meta de ROM',
      detail: `Capacidade da planta: ${fmtT(plant.capacityT)}/mês para uma meta de ${fmtT(plant.needT)} (faltam ${fmtT(missing)}). Colocar mais caminhões na mina não aumenta a produção: só forma pilha. Revise a taxa de alimentação (${fmtN(premises.plantFeedRateTPH, 0)} t/h), a DF (${fmtN(premises.dfPlanta, 0)}%) e a UF (${fmtN(premises.ufPlanta, 0)}%) da planta.`,
      gainT: missing,
    });
  }

  // 2. Déficits e folgas por rota
  const surplus: { a: RouteAnalysis; spare: number }[] = [];
  const deficits: { a: RouteAnalysis; missingTrucks: number }[] = [];
  for (const a of analyses) {
    if (a.targetWetT <= 0) continue;
    if (a.ratio < 0.999) {
      if (a.limitedBy === 'carga' && a.loader) {
        const r = byId.get(a.id)!;
        // mais 1 equipamento igual resolve?
        const plusOne = analyzeRoute({ ...r, loader: { ...r.loader!, count: r.loader!.count + 1 } }, premises, a.targetDryT, {
          trucks: Math.max(a.trucksAllocated, a.trucksNeeded),
        });
        // ou um equipamento maior do catálogo
        const bigger = catalog.loaders
          .filter((l) => l.bucketM3 > r.loader!.bucketM3)
          .map((l) => ({
            l,
            res: analyzeRoute({ ...r, loader: { ...r.loader!, name: l.name, bucketM3: l.bucketM3, cycleSec: l.cycleSec } }, premises, a.targetDryT, {
              trucks: Math.max(a.trucksAllocated, a.trucksNeeded),
            }),
          }))
          .find((x) => x.res.loader && x.res.loader.capacityWetT >= a.targetWetT);
        const options = [
          plusOne.loader && plusOne.loader.capacityWetT >= a.targetWetT ? `adicionar mais 1 ${r.loader!.name}` : null,
          bigger ? `trocar por ${bigger.l.name} (${bigger.res.loader!.passes} caçambadas por caminhão)` : null,
        ].filter(Boolean);
        actions.push({
          kind: 'deficit',
          priority: 1,
          title: `${a.name}: a carga é o gargalo`,
          detail: `O equipamento de carga entrega ${fmtT(a.loader.capacityWetT)}/mês para uma necessidade de ${fmtT(a.targetWetT)} (${fmtN(a.ratio * 100, 0)}%). Mais caminhões só aumentam a fila. ${options.length ? 'Opções: ' + options.join(' ou ') + '.' : 'Nenhuma classe do catálogo resolve sozinha: considere 2 frentes de carga.'}`,
          gainT: a.targetWetT - a.capacityWetT,
        });
      } else {
        const missingTrucks = Math.max(1, a.trucksNeeded - a.trucksAllocated);
        deficits.push({ a, missingTrucks });
      }
    } else if (a.trucksAllocated > a.trucksNeeded) {
      surplus.push({ a, spare: a.trucksAllocated - a.trucksNeeded });
    }
  }

  // remanejamento antes de pedir caminhão novo
  for (const d of deficits) {
    let missing = d.missingTrucks;
    const moves: string[] = [];
    for (const s of surplus) {
      if (missing <= 0 || s.spare <= 0) continue;
      const take = Math.min(s.spare, missing);
      s.spare -= take;
      missing -= take;
      moves.push(`${take} de "${s.a.name}"`);
    }
    if (moves.length) {
      actions.push({
        kind: 'remanejar',
        priority: 1,
        title: `Remanejar caminhões para ${d.a.name}`,
        detail: `Mova ${moves.join(' e ')} para "${d.a.name}". Hoje a rota atende ${fmtN(d.a.ratio * 100, 0)}% da necessidade com ${d.a.trucksAllocated} caminhões; precisa de ${d.a.trucksNeeded}.`,
        gainT: Math.min(d.a.targetWetT - d.a.capacityWetT, (d.missingTrucks - missing) * d.a.truckMonthT),
        trucksSaved: 0,
      });
    }
    if (missing > 0) {
      actions.push({
        kind: 'deficit',
        priority: 1,
        title: `${d.a.name}: faltam ${missing} caminhão(ões)`,
        detail: `Com ${d.a.trucksAllocated} caminhões de ${fmtN(d.a.payloadT, 0)} t a rota entrega ${fmtT(d.a.capacityWetT)}/mês (${fmtN(d.a.ratio * 100, 0)}% da necessidade). São necessários ${d.a.trucksNeeded} (${fmtN(d.a.trucksNeededExact, 2)} calculados). Antes de alugar, veja as ações de produtividade abaixo: elas podem reduzir essa necessidade.`,
        gainT: missing * d.a.truckMonthT,
      });
    }
  }
  for (const s of surplus) {
    if (s.spare <= 0) continue;
    actions.push({
      kind: 'folga',
      priority: 4,
      title: `${s.a.name}: ${s.spare} caminhão(ões) além do necessário`,
      detail: `A rota precisa de ${s.a.trucksNeeded} e tem ${s.a.trucksAllocated}. Os excedentes podem cobrir manutenção de outras frotas, reforçar outra frente ou ser devolvidos (se alugados).`,
      trucksSaved: s.spare,
    });
  }

  // 3. Alavancas de produtividade (avaliadas na soma de caminhões necessários)
  const totalNeeded = (ov: Parameters<typeof analyzeRoute>[3] | ((r: Route) => Parameters<typeof analyzeRoute>[3])) =>
    routes.reduce((acc, r) => {
      const o = typeof ov === 'function' ? ov(r) : ov;
      return acc + analyzeRoute(r, premises, targets.get(r.id) || 0, o).trucksNeeded;
    }, 0);
  const totalNeededExact = (ov: (r: Route) => Parameters<typeof analyzeRoute>[3]) =>
    routes.reduce((acc, r) => acc + analyzeRoute(r, premises, targets.get(r.id) || 0, ov(r)).trucksNeededExact, 0);

  const baseNeeded = totalNeeded({});
  const baseExact = totalNeededExact(() => ({}));
  const lever = (title: string, detail: string, ov: (r: Route) => Parameters<typeof analyzeRoute>[3]) => {
    const n = totalNeeded(ov);
    const exact = totalNeededExact(ov);
    const saved = baseNeeded - n;
    const gainPct = baseExact > 0 ? (baseExact / exact - 1) * 100 : 0;
    if (saved <= 0 && gainPct < 3) return;
    actions.push({
      kind: 'produtividade',
      priority: 2,
      title,
      detail: `${detail} ${saved > 0 ? `Reduz a frota necessária de ${baseNeeded} para ${n} caminhões.` : ''} Equivale a +${fmtN(gainPct, 0)}% de capacidade com a mesma frota.`,
      trucksSaved: saved,
      gainT: analyses.reduce((a, x) => a + x.capacityWetT, 0) * (gainPct / 100),
    });
  };

  const withQueue = routes.filter((r) => routeQueueMin(r, premises) > 0);
  if (withQueue.length) {
    lever(
      'Reduzir a fila pela metade',
      `Hoje há ${withQueue.map((r) => `${fmtN(routeQueueMin(r, premises))} min em "${r.name}"`).join(', ')} por ciclo. Organizar o despacho (sequência de carga, praça de manobra, sinalização) reduz esse tempo.`,
      (r) => ({ queueMin: routeQueueMin(r, premises) / 2 }),
    );
  }
  const rateOf = (r: Route) => routeRates(r, premises, routeKind(r) === 'product' || routeKind(r) === 'tailings' ? 'planta' : 'mina');
  const lowDf = routes.filter((r) => rateOf(r).df < TARGET_DF);
  if (lowDf.length) {
    lever(
      `Elevar a disponibilidade física dos caminhões para ${TARGET_DF}%`,
      `Hoje: ${[...new Set(lowDf.map((r) => `${fmtN(rateOf(r).df, 0)}%`))].join(', ')}. Manutenção preventiva e estoque de peças críticas.`,
      (r) => ({ df: Math.max(rateOf(r).df, TARGET_DF) }),
    );
  }
  const lowUf = routes.filter((r) => rateOf(r).uf < TARGET_UF);
  if (lowUf.length) {
    lever(
      `Elevar a utilização (UF) para ${TARGET_UF}%`,
      `Hoje: ${[...new Set(lowUf.map((r) => `${fmtN(rateOf(r).uf, 0)}%`))].join(', ')}. Troca de turno no campo, refeição em revezamento e abastecimento fora do pico aumentam as horas trabalhadas.`,
      (r) => ({ uf: Math.max(rateOf(r).uf, TARGET_UF) }),
    );
  }
  lever(
    'Melhorar as vias (+10% de velocidade média)',
    `Velocidades atuais: ${fmtN(premises.velocidadeCheio, 0)} km/h carregado e ${fmtN(premises.velocidadeVazio, 0)} km/h vazio. Manutenção de pista, drenagem e rampas mais suaves aumentam a velocidade média.`,
    (r) => (r.cycleMode === 'informed' ? {} : { speedFactor: 1.1 }),
  );

  // 4. Equipamento: carga útil por volume e caçambadas
  for (const a of analyses) {
    const r = byId.get(a.id)!;
    const vol = routeVolumeM3(r, premises);
    if (a.payloadLimitedBy === 'volume' && vol) {
      actions.push({
        kind: 'equipamento',
        priority: 3,
        title: `${a.name}: caçamba limita a carga pelo volume`,
        detail: `Com ${fmtN(vol, 0)} m³ e densidade solta de ${fmtN(density, 2)} t/m³ cabem ${fmtN(a.payloadT, 1)} t, abaixo das ${fmtN(rateOf(r).capacityT, 0)} t de capacidade. Uma caçamba maior (prolongador lateral) aproveita a capacidade nominal.`,
      });
    }
    if (a.loader && a.loader.passesStatus !== 'ok') {
      actions.push({
        kind: 'equipamento',
        priority: 3,
        title: `${a.name}: ${a.loader.passes} caçambadas por caminhão`,
        detail:
          a.loader.passesStatus === 'muitas'
            ? `O ideal é de 3 a 6 caçambadas. Com ${a.loader.passes}, o caminhão fica ${fmtN(a.loader.loadMin, 1)} min parado na carga: um equipamento de carga maior encurta o ciclo.${(() => {
                const fit = catalog.loaders.find((l) => loaderLoading({ bucketM3: l.bucketM3, fillFactor: r.loader!.fillFactor, cycleSec: l.cycleSec }, a.payloadT, density).passesStatus === 'ok');
                if (!fit) return '';
                const n = loaderLoading({ bucketM3: fit.bucketM3, fillFactor: r.loader!.fillFactor, cycleSec: fit.cycleSec }, a.payloadT, density);
                return ` Sugestão: ${fit.name}, com ${n.passes} caçambadas (${fmtN(n.loadMin, 1)} min de carga).`;
              })()}`
            : `Com menos de 3 caçambadas, a carga é rápida, mas o equipamento fica ocioso e há risco de sobrecarga/dano à caçamba. Caminhões maiores aproveitam melhor a escavadeira.`,
      });
    }
  }

  // 5. Classe de caminhão alternativa na principal rota de ROM
  const mainRom = analyses.filter((a) => a.kind === 'rom').sort((x, y) => y.targetWetT - x.targetWetT)[0];
  if (mainRom) {
    const opts = compareTruckClasses(byId.get(mainRom.id)!, premises, mainRom.targetDryT);
    const cur = opts.find((o) => o.current);
    const best = opts
      .filter((o) => !o.current && (o.passesStatus === null || o.passesStatus === 'ok'))
      .sort((x, y) => x.trucksNeeded - y.trucksNeeded)[0];
    if (cur && best && best.trucksNeeded < cur.trucksNeeded) {
      actions.push({
        kind: 'equipamento',
        priority: 3,
        title: `Avaliar ${best.truck.name} em "${mainRom.name}"`,
        detail: `Atende a meta com ${best.trucksNeeded} caminhões, contra ${cur.trucksNeeded} da classe atual. Menos equipamentos reduzem motoristas e congestionamento, mas confira o custo horário, a largura das vias e a compatibilidade com a carga antes de decidir.`,
        trucksSaved: cur.trucksNeeded - best.trucksNeeded,
      });
    }
  }

  if (!analyses.some((a) => a.kind === 'rom')) {
    actions.unshift({ kind: 'deficit', priority: 0, title: 'Cadastre a rota de ROM (mina → planta)', detail: 'Sem uma rota de ROM ativa, nenhum minério chega à planta. Crie a rota em "Rotas de Transporte" ou ative uma existente.' });
  }
  if (plantCapacityDry <= 0) {
    actions.push({ kind: 'planta', priority: 5, title: 'Informe a taxa de alimentação da planta', detail: 'Sem ela não é possível saber se a planta é o gargalo.' });
  }

  return actions.sort((a, b) => a.priority - b.priority || (b.gainT ?? 0) - (a.gainT ?? 0) || (b.trucksSaved ?? 0) - (a.trucksSaved ?? 0));
}

/** Aplica a frota necessária calculada às rotas (arredondada para cima). */
export function applySuggestedFleet(routes: Route[], analysis: FleetAnalysis): Route[] {
  const need = new Map(analysis.routes.map((r) => [r.id, r.trucksNeeded]));
  return routes.map((r) => (need.has(r.id) ? { ...r, truckCount: need.get(r.id)!, isManualOverride: true } : r));
}


/* -------------------------------------------------------------------------- */
/* Otimização da alocação da frota                                             */
/* -------------------------------------------------------------------------- */

export interface OptimizeResult {
  routes: Route[];
  /** caminhões acrescentados por rota */
  moves: { routeId: string; name: string; from: number; to: number }[];
  beforeDeliverableDryT: number;
  afterDeliverableDryT: number;
  meetsTarget: boolean;
  /** caminhões da frota que continuam sem rota (reserva) */
  spareLeft: number;
  /** caminhões que faltariam (além da frota) para todas as rotas atingirem a meta */
  missingForTarget: number;
}

/**
 * Distribui a frota das premissas entre as rotas para atingir as metas.
 * 'folga': mantém o que o planejador alocou e acrescenta só os caminhões sem rota.
 * 'zero': redistribui toda a frota do zero.
 * Regra: cada caminhão vai para a rota com a menor razão capacidade ÷ meta (ROM primeiro no empate),
 * desde que ele aumente a capacidade (não adianta caminhão onde a carga é o gargalo).
 * Maximizar a menor razão é o que maximiza o que chega à planta e o atendimento de todos os fluxos.
 */
export function optimizeFleet(routes: Route[], premises: DetailedPremises, mode: 'folga' | 'zero' = 'folga'): OptimizeResult {
  const targets = routeTargets(routes, premises);
  const before = analyzeFleet(routes, premises);
  const active = routes.filter((r) => r.active && (targets.get(r.id) || 0) > 0);
  const count = new Map<string, number>(routes.map((r) => [r.id, mode === 'zero' && r.active ? 0 : Math.max(0, Math.round(r.truckCount || 0))]));
  const used = routes.filter((r) => r.active).reduce((a, r) => a + (count.get(r.id) || 0), 0);
  let pool = Math.max(0, Math.floor((premises.truckCount || 0) - used - before.fleet.extraEquivalent + 1e-9));
  const ratio = (r: Route, n: number) => analyzeRoute(r, premises, targets.get(r.id) || 0, { trucks: n }).ratio;
  const pick = () => {
    let best: Route | null = null;
    let bestKey = Infinity;
    for (const r of active) {
      const n = count.get(r.id) || 0;
      const now = ratio(r, n);
      if (now >= 0.999) continue;
      if (ratio(r, n + 1) <= now + 1e-9) continue; // carga é o gargalo: caminhão não ajuda
      const key = now - (routeKind(r) === 'rom' ? 1e-6 : 0);
      if (key < bestKey) {
        bestKey = key;
        best = r;
      }
    }
    return best;
  };
  while (pool > 0) {
    const r = pick();
    if (!r) break;
    count.set(r.id, (count.get(r.id) || 0) + 1);
    pool--;
  }
  // quantos faltariam além da frota
  const virtual = new Map(count);
  let missing = 0;
  for (let guard = 0; guard < 200; guard++) {
    let best: Route | null = null;
    let bestKey = Infinity;
    for (const r of active) {
      const n = virtual.get(r.id) || 0;
      const now = ratio(r, n);
      if (now >= 0.999 || ratio(r, n + 1) <= now + 1e-9) continue;
      if (now < bestKey) {
        bestKey = now;
        best = r;
      }
    }
    if (!best) break;
    virtual.set(best.id, (virtual.get(best.id) || 0) + 1);
    missing++;
  }
  const next = routes.map((r) => (r.active ? { ...r, truckCount: count.get(r.id) || 0, isManualOverride: true } : r));
  const after = analyzeFleet(next, premises);
  return {
    routes: next,
    moves: routes
      .filter((r) => r.active && (count.get(r.id) || 0) !== Math.round(r.truckCount || 0))
      .map((r) => ({ routeId: r.id, name: r.name, from: Math.round(r.truckCount || 0), to: count.get(r.id) || 0 })),
    beforeDeliverableDryT: before.romDeliverableDryT,
    afterDeliverableDryT: after.romDeliverableDryT,
    meetsTarget: after.meetsTarget,
    spareLeft: pool,
    missingForTarget: missing,
  };
}
