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
import { processPct } from './process';
import { networkBalance, networkOn, transportBalance, transportMode } from './network';
import type { DetailedPremises, EquipmentCatalog, FlowNode, NodeLoader, ExtraFleetAllocation, LoaderClass, LoaderSetup, Route, RouteKind, TruckClass } from '../types';
import { interferenceMin } from './losses';
import { mixedOn, syncMix } from './mix';

/** Tempo de troca de caminhão sob o equipamento de carga (posicionamento), em minutos. */
export const TRUCK_EXCHANGE_MIN = 0.6;
/** Eficiência alvo usada nas sugestões: 50 min produtivos por hora. */
export const TARGET_EO = 83;
/** Disponibilidade física alvo usada nas sugestões. */
export const TARGET_DF = 90;
/** Utilização alvo usada nas sugestões. */
export const TARGET_UF = 90;
export const DEFAULT_LOOSE_DENSITY = 2.0;

/** Valores econômicos típicos (genéricos, sem marca): ponto de partida editável no catálogo. */
const eco = (price: number, maint: number, diesel: number, tires: number, lifeYears = 5, hoursPerYear = 5000) => ({ price, lifeYears, hoursPerYear, residualPct: 20, maintPerH: maint, maintEscPctYear: 8, dieselLph: diesel, tiresPerH: tires });

export const DEFAULT_CATALOG: EquipmentCatalog = {
  trucks: [
    { id: 'rod-40', name: 'Basculante rodoviário 8x4 (40 t)', payloadT: 40, volumeM3: 22, vehicle: 'rodoviario', ...eco(1_600_000, 70, 28, 25) },
    { id: 'rod-30', name: 'Basculante rodoviário 6x4 (~30 t)', payloadT: 30, volumeM3: 18, vehicle: 'rodoviario', ...eco(1_250_000, 58, 23, 20) },
    { id: 'art-40', name: 'Articulado 6x6 (~38 t)', payloadT: 38, volumeM3: 23, vehicle: 'mina', ...eco(3_400_000, 110, 30, 45, 7) },
    { id: 'rig-60', name: 'Rígido fora de estrada (~60 t)', payloadT: 60, volumeM3: 38, vehicle: 'mina', ...eco(5_500_000, 160, 45, 60, 8) },
    { id: 'rig-90', name: 'Rígido fora de estrada (~90 t)', payloadT: 90, volumeM3: 58, vehicle: 'mina', ...eco(8_000_000, 220, 65, 85, 8) },
  ],
  loaders: [
    { id: 'esc-20', name: 'Escavadeira ~20 t (1,2 m³)', bucketM3: 1.2, cycleSec: 20, ...eco(900_000, 70, 16, 8) },
    { id: 'esc-35', name: 'Escavadeira ~35 t (2,0 m³)', bucketM3: 2.0, cycleSec: 22, ...eco(1_500_000, 95, 24, 10) },
    { id: 'esc-50', name: 'Escavadeira ~50 t (3,0 m³)', bucketM3: 3.0, cycleSec: 24, ...eco(2_400_000, 130, 34, 12, 7) },
    { id: 'esc-75', name: 'Escavadeira ~75 t (4,5 m³)', bucketM3: 4.5, cycleSec: 26, ...eco(3_800_000, 180, 48, 15, 8) },
    { id: 'pa-35', name: 'Pá carregadeira (3,5 m³)', bucketM3: 3.5, cycleSec: 35, ...eco(2_140_000, 110, 30, 15) },
    { id: 'pa-55', name: 'Pá carregadeira grande (5,5 m³)', bucketM3: 5.5, cycleSec: 40, ...eco(3_300_000, 150, 42, 22, 7) },
  ],
};

/** Catálogo do plano, com as classes padrão que faltarem (planos antigos ganham as novas e os dados econômicos). */
export function catalogOf(premises: DetailedPremises): EquipmentCatalog {
  const c = premises.equipmentCatalog;
  if (!c) return DEFAULT_CATALOG;
  const fill = <T extends { id: string }>(list: T[], defs: T[]) => [
    ...defs.filter((d) => !list.some((x) => x.id === d.id)),
    ...list.map((x) => {
      const d = defs.find((y) => y.id === x.id);
      return d ? { ...d, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) } as T : x;
    }),
  ];
  return { trucks: fill(c.trucks, DEFAULT_CATALOG.trucks), loaders: fill(c.loaders, DEFAULT_CATALOG.loaders) };
}

/** Equipamento de carga do local de origem da rota (rede de fluxos), quando é um modelo do catálogo. */
/** Ciclo de uma caçambada (s): a soma das partes, quando informadas, ou o ciclo total do catálogo. */
export function loaderCycleSec(l: Pick<LoaderClass, 'cycleSec' | 'digSec' | 'swingLoadedSec' | 'dumpSec' | 'swingEmptySec'>) {
  const parts = [l.digSec, l.swingLoadedSec, l.dumpSec, l.swingEmptySec];
  const sum = parts.reduce<number>((a, v) => a + (v && v > 0 ? v : 0), 0);
  return parts.some((v) => v && v > 0) ? sum : l.cycleSec;
}

/** Equipamento de carga efetivo do local: o escolhido nele ou o padrão de Transporte / Frota (null = tempo de carga das premissas). */
export function effectiveLoaderId(n: Pick<FlowNode, 'loaderClassId'>, premises: Pick<DetailedPremises, 'defaultLoaderClassId'>): string | null {
  if (n.loaderClassId === 'tempo') return null;
  return n.loaderClassId || premises.defaultLoaderClassId || null;
}

/** Equipamentos de carga do local (planos antigos: um, o escolhido em loaderClassId ou o padrão). */
export function nodeLoaderEntries(n: FlowNode): NodeLoader[] {
  return n.loaders ?? [{ id: `${n.id}-l1`, classId: n.loaderClassId, count: n.loaderCount, role: 'caminhoes' }];
}

/** Altera o primeiro equipamento do local (telas que mostram um só: desenho e tabela da rede). */
export function withFirstEntry(n: FlowNode, patch: Partial<NodeLoader>): FlowNode {
  const list = nodeLoaderEntries(n);
  const first = list[0] ?? { id: `${n.id}-l1`, role: 'caminhoes' as const };
  return { ...n, loaders: [{ ...first, ...patch }, ...list.slice(1)], loaderClassId: undefined, loaderCount: undefined };
}

/** Modelo do equipamento: 'tempo' e o padrão vazio = tempo de carga das premissas (null). */
export function entryClassId(e: NodeLoader, premises: Pick<DetailedPremises, 'defaultLoaderClassId'>): string | null {
  if (e.classId === 'tempo') return null;
  return e.classId || premises.defaultLoaderClassId || null;
}

/** Equipamento do local que carrega os caminhões desta movimentação: o que a lista nominalmente; senão o geral do local. */
export function entryForRoute(n: FlowNode, routeId: string): NodeLoader | null {
  const list = nodeLoaderEntries(n).filter((e) => (e.role ?? 'caminhoes') === 'caminhoes');
  return list.find((e) => e.routeIds?.includes(routeId)) ?? list.find((e) => !e.routeIds?.length) ?? null;
}

export function nodeLoaderOf(route: Route, premises: DetailedPremises): LoaderSetup | null {
  const n = premises.nodes?.find((x) => x.id === route.fromId);
  const e = n ? entryForRoute(n, route.id) : null;
  const id = e ? entryClassId(e, premises) : null;
  if (!n || !e || !id || id === 'silo') return null;
  const l = catalogOf(premises).loaders.find((x) => x.id === id);
  return l ? { name: `${l.manufacturer ? `${l.manufacturer} ` : ''}${l.name}`, count: e.count ?? 1, bucketM3: l.bucketM3, fillFactor: l.fillFactor ?? 90, cycleSec: loaderCycleSec(l), availability: n.loaderDf ?? l.dfPct ?? premises.dfMina ?? 85, spotMin: l.spotMin } : null;
}

/** Equipamento de carga de uma rota a partir de um modelo do catálogo. */
export function loaderFromCatalog(l: LoaderClass, premises: DetailedPremises, count = 1): LoaderSetup {
  return { name: l.name, count, bucketM3: l.bucketM3, fillFactor: l.fillFactor ?? 90, cycleSec: loaderCycleSec(l), availability: l.dfPct ?? (premises.dfMina || 85) };
}

export const KIND_LABELS: Record<RouteKind, string> = {
  rom: 'ROM (mina → planta)',
  product: 'Produto (planta → expedição)',
  tailings: 'Rejeito (planta → pilha/baia)',
  waste: 'Estéril (mina → pilha)',
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
  /** interferências na via por viagem (perdas detalhadas das premissas) */
  interferenceMin: number;
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

export interface MixPart {
  classId: string;
  name: string;
  count: number;
  payloadT: number;
  cycleMin: number;
  truckMonthT: number;
  capacityWetT: number;
  /** caçambadas e tempo de carga deste tipo (equipamento do local ou da rota) */
  passes?: number;
  loadMin?: number;
}

export interface RouteAnalysis {
  /** frota mista: desempenho de cada tipo de caminhão nesta rota */
  mix?: MixPart[];
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
  /** carregamento usado no ciclo (equipamento da rota ou do local de origem) */
  loading: { name: string; passes: number; loadMin: number; source: 'rota' | 'local' } | null;
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
  /** capacidade do caminho mina → planta sem o teto da meta (t seca/mês) */
  romPossibleDryT: number;
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
  /** equipamentos de carga necessários por local (rede) e por rota com equipamento próprio */
  loaderNeeds: LoaderNeed[];
}

/* -------------------------------------------------------------------------- */
/* Funções básicas                                                             */
/* -------------------------------------------------------------------------- */

const pct = (v: number | undefined, fallback: number) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) / 100 : fallback);

export function routeKind(route: Route): RouteKind {
  if (route.kind) return route.kind;
  return guessRouteKind(route.name);
}

/** Fluxo deduzido do nome (só quando a rota não tem fluxo escolhido). */
export function guessRouteKind(name: string): RouteKind {
  const n = name.toLowerCase();
  if (/terminal|produto|product|expedi|concentrado|pellet|sinter/.test(n)) return 'product';
  if (/baia|rejeit|rejeir|tailing|filtrad|\bpdr\b|\bpru\b|barragem/.test(n)) return 'tailings';
  if (/estéril|esteril|waste|\bpde\b|bota.?fora/.test(n)) return 'waste';
  return 'rom';
}

export const FLOW_ORDER: RouteKind[] = ['rom', 'product', 'tailings', 'waste'];

/** Massas secas de cada fluxo pelas premissas (t/mês). */
export function flowTargets(premises: DetailedPremises): Record<RouteKind, number> {
  const pp = processPct(premises);
  const rom = premises.targetMonthlyROM || 0;
  return {
    rom,
    product: (rom * pp.rm) / 100,
    tailings: (rom * pp.rej) / 100,
    waste: premises.hasWasteRock ? premises.targetMonthlyWasteRock || 0 : 0,
  };
}

/** Fluxos que existem nas premissas (e por isso precisam de ao menos uma rota). */
export function requiredFlows(premises: DetailedPremises): RouteKind[] {
  const t = flowTargets(premises);
  return FLOW_ORDER.filter((k) => t[k] > 0);
}

export const FLOW_DEFAULT_NAMES: Record<RouteKind, string> = {
  rom: 'Mina → Planta',
  product: 'Planta → Terminal (produto)',
  tailings: 'Planta → Pilha de rejeito filtrado',
  waste: 'Mina → Pilha de estéril',
};

export function newFlowRoute(kind: RouteKind, premises: DetailedPremises): Route {
  return {
    id: `auto-${kind}-${Math.random().toString(36).slice(2, 8)}`,
    name: FLOW_DEFAULT_NAMES[kind],
    kind,
    active: true,
    truckCount: 0,
    truckCapacity: premises.truckCapacity,
    distance: 1000,
    cycleTime: 20,
    mechanicalAvailability: premises.dfMina,
    operationalEfficiency: 100,
    processType: premises.processType,
  };
}

/**
 * Cria a rota de cada fluxo das premissas que ainda não tem rota (ex.: marcou “possui estéril”).
 * Fluxos cuja rota o usuário apagou ficam de fora. Retorna null se nada mudou.
 */
export function ensureFlowRoutes(routes: Route[], premises: DetailedPremises): Route[] | null {
  if (transportMode(premises)) return null;
  const dismissed = new Set(premises.dismissedFlows ?? []);
  const missing = requiredFlows(premises).filter((k) => !dismissed.has(k) && !routes.some((r) => routeKind(r) === k));
  if (!missing.length) return null;
  return [...routes, ...missing.map((k) => newFlowRoute(k, premises))];
}

export interface FlowCheck {
  kind: RouteKind;
  /** meta seca do fluxo pelas premissas */
  targetDryT: number;
  /** soma das metas das rotas ativas do fluxo */
  assignedDryT: number;
  routes: number;
  status: 'ok' | 'sem_rota' | 'acima' | 'abaixo' | 'sem_meta';
}

/** Confere se as rotas de cada fluxo somam a massa do fluxo principal. */
export function checkFlows(routes: Route[], premises: DetailedPremises): FlowCheck[] {
  const targets = routeTargets(routes, premises);
  const t = flowTargets(premises);
  const active = routes.filter((r) => r.active);
  // produto e rejeito seguem o ROM que de fato vai para a planta
  const romAssigned = active.filter((r) => routeKind(r) === 'rom').reduce((a, r) => a + (targets.get(r.id) || 0), 0);
  const romBase = romAssigned || t.rom;
  const pp = processPct(premises);
  const expected: Record<RouteKind, number> = {
    rom: t.rom,
    product: (romBase * pp.rm) / 100,
    tailings: (romBase * pp.rej) / 100,
    waste: t.waste,
  };
  const net = networkOn(premises) && routes.some((r) => r.fromId) ? networkBalance(routes, premises, routeKind) : null;
  if (net) {
    expected.product = (net.romToPlants * pp.rm) / 100;
    expected.tailings = (net.romToPlants * pp.rej) / 100;
  }
  const typeOf = (id?: string) => premises.nodes?.find((n) => n.id === id)?.type;
  const fromSource = (r: Route, k: RouteKind) => {
    if (!net) return true;
    const t = typeOf(r.fromId);
    return (k === 'rom' || k === 'waste') ? t === 'frente' : t === 'planta';
  };
  return FLOW_ORDER.map((kind) => {
    const rs = active.filter((r) => routeKind(r) === kind && fromSource(r, kind));
    const assigned = rs.reduce((a, r) => a + (targets.get(r.id) || 0), 0);
    const target = expected[kind];
    let status: FlowCheck['status'] = 'ok';
    if (target <= 0) status = rs.length ? 'sem_meta' : 'ok';
    else if (!rs.length) status = 'sem_rota';
    else if (assigned > target * 1.001 + 1) status = 'acima';
    else if (assigned < target * 0.999 - 1) status = 'abaixo';
    return { kind, targetDryT: target, assignedDryT: assigned, routes: rs.length, status };
  }).filter((c) => c.targetDryT > 0 || c.routes > 0);
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
  const interference = interferenceMin(premises);
  const calculatedMin = loadMin + travelLoadedMin + dumpMin + travelEmptyMin + weighMin + queueMin + interference;
  const informedMin = Math.max(route.cycleTime || 0, 0);
  const mode = route.cycleMode === 'informed' && informedMin > 0 ? 'informed' : 'calculated';
  return {
    loadMin,
    travelLoadedMin,
    dumpMin,
    travelEmptyMin,
    weighMin,
    queueMin,
    interferenceMin: interference,
    calculatedMin,
    informedMin,
    totalMin: Math.max(mode === 'informed' ? informedMin : calculatedMin, 0.1),
    mode,
  };
}

/** Distribui a meta mensal (seca) entre as rotas de cada tipo, respeitando massas fixadas nas rotas. */
export function routeTargets(routes: Route[], premises: DetailedPremises): Map<string, number> {
  if (transportMode(premises)) return transportBalance(routes, premises).edges;
  // rede de fluxos (locais e movimentações): balanço de massa por local
  if (networkOn(premises) && routes.some((r) => r.fromId)) return networkBalance(routes, premises, routeKind).edges;
  const { rm, rej } = processPct(premises);
  const active = routes.filter((r) => r.active);
  const byKind = (k: RouteKind) => active.filter((r) => routeKind(r) === k);
  const out = new Map<string, number>();

  // massas digitadas primeiro; o saldo do fluxo vai para as demais rotas pelo peso (padrão 1 = partes iguais)
  const distribute = (group: Route[], total: number) => {
    const fixed = group.reduce((a, r) => a + (r.targetMass || 0), 0);
    const auto = group.filter((r) => !r.targetMass);
    const rest = Math.max(0, total - fixed);
    const w = (r: Route) => (r.share === undefined ? 1 : Math.max(0, r.share));
    const wSum = auto.reduce((a, r) => a + w(r), 0);
    for (const r of group) out.set(r.id, r.targetMass || (wSum > 0 ? (rest * w(r)) / wSum : 0));
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
  overrides: { payloadT?: number; volumeM3?: number; trucks?: number; df?: number; uf?: number; eo?: number; queueMin?: number; speedFactor?: number; extraHours?: number; vLoaded?: number; vEmpty?: number } = {},
): RouteAnalysis {
  // frota mista: cada tipo tem carga útil e ciclo próprios; a capacidade da rota é a soma por tipo
  const mixEntries = Object.entries(route.mix ?? {}).filter(([, n]) => n > 0);
  if (mixEntries.length && overrides.payloadT === undefined && overrides.trucks === undefined) {
    const cat = catalogOf(premises).trucks;
    const parts = mixEntries
      .map(([id, n]) => ({ n, cls: cat.find((c) => c.id === id) }))
      .filter((x): x is { n: number; cls: TruckClass } => !!x.cls)
      .map(({ n, cls }) => {
        const ft = premises.fleetTypes?.find((t) => t.classId === cls.id);
        return { n, cls, a: analyzeRoute({ ...route, mix: undefined, truckCount: n }, premises, targetDryT, { ...overrides, payloadT: cls.payloadT, volumeM3: cls.volumeM3 || undefined, trucks: n, vLoaded: ft?.speedLoaded, vEmpty: ft?.speedEmpty }) };
      });
    if (parts.length) {
      const nTot = parts.reduce((a, p) => a + p.n, 0);
      const base = [...parts].sort((x, y) => y.n - x.n)[0].a;
      const transportCapacityWetT = parts.reduce((a, p) => a + p.a.transportCapacityWetT, 0) - parts.slice(1).reduce((a, p) => a + p.a.extraCapacityWetT, 0);
      const truckMonthT = parts.reduce((a, p) => a + p.n * p.a.truckMonthT, 0) / (nTot || 1);
      const truckRateTph = parts.reduce((a, p) => a + p.n * p.a.truckRateTph, 0) / (nTot || 1);
      const payloadT = parts.reduce((a, p) => a + p.n * p.a.payloadT, 0) / (nTot || 1);
      const cycleAvg = parts.reduce((a, p) => a + p.n * p.a.cycle.totalMin, 0) / (nTot || 1);
      const trucksNeededExact = truckMonthT > 0 ? base.targetWetT / truckMonthT : 0;
      const loaderCap = base.loader ? base.loader.capacityWetT : Infinity;
      const capacityWetT = Math.min(transportCapacityWetT, loaderCap);
      return {
        ...base,
        payloadT,
        truckRateTph,
        truckMonthT,
        trucksAllocated: nTot,
        trucksNeededExact,
        trucksNeeded: Math.ceil(trucksNeededExact - 1e-6),
        transportCapacityWetT,
        capacityWetT,
        limitedBy: loaderCap < transportCapacityWetT ? 'carga' : 'transporte',
        ratio: base.targetWetT > 0 ? capacityWetT / base.targetWetT : capacityWetT > 0 ? Infinity : 1,
        cycle: { ...base.cycle, totalMin: cycleAvg },
        idleTrucks: Math.max(0, nTot - Math.ceil(trucksNeededExact - 1e-6)),
        mix: parts.map((p) => ({ classId: p.cls.id, name: `${p.cls.manufacturer ? `${p.cls.manufacturer} ` : ''}${p.cls.name}`, count: p.n, payloadT: p.a.payloadT, cycleMin: p.a.cycle.totalMin, truckMonthT: p.a.truckMonthT, capacityWetT: p.n * p.a.truckMonthT, passes: p.a.loading?.passes, loadMin: p.a.loading?.loadMin })),
      };
    }
  }
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

  // equipamento de carga: o da rota (dedicado) ou o do local de origem na rede (compartilhado; só define o tempo de carga)
  const nodeL = route.loader ? null : nodeLoaderOf(route, premises);
  const loading = route.loader ? loaderLoading(route.loader, payloadT, density) : nodeL ? loaderLoading(nodeL, payloadT, density) : null;
  const loadMin = loading ? loading.loadMin + (nodeL ? Math.max(0, nodeL.spotMin ?? premises.loaderSpotMin ?? 0.5) : 0) : Math.max(premises.loadingTime, 0);

  const speedFactor = overrides.speedFactor ?? 1;
  const vl = overrides.vLoaded && overrides.vLoaded > 0 ? overrides.vLoaded : premises.velocidadeCheio;
  const ve = overrides.vEmpty && overrides.vEmpty > 0 ? overrides.vEmpty : premises.velocidadeVazio;
  const effPremises = speedFactor === 1 && vl === premises.velocidadeCheio && ve === premises.velocidadeVazio ? premises : { ...premises, velocidadeCheio: vl * speedFactor, velocidadeVazio: ve * speedFactor };
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
    loading: loading ? { name: route.loader?.name ?? nodeL!.name, passes: loading.passes, loadMin, source: route.loader ? 'rota' : 'local' } : null,
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
  // capacidade do caminho mina → planta sem o teto da meta (folga de produção da frota)
  const pathRatios = stages.filter((s) => ['carga', 'transporte_rom', 'planta'].includes(s.id)).map((s) => s.ratio);
  const romPossibleDryT = romTargetDryT * (pathRatios.length ? Math.min(...pathRatios) : 1);

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
    romPossibleDryT,
    fleet: { allocated, needed, neededExact, premise: premises.truckCount || 0, idle, extraEquivalent, spare },
    actions,
    classComparison,
    loaderNeeds: loaderSizing(routes, premises, analyses),
  };
}

export interface LoaderNeed {
  /** local da rede (ou rota, quando o equipamento é próprio da rota) */
  where: string;
  source: 'local' | 'rota';
  nodeId?: string;
  routeIds: string[];
  /** equipamento da lista do local e a função dele */
  entryId?: string;
  role?: 'caminhoes' | 'alimentacao';
  /** alimentação da planta: produção do equipamento (t/h) e massa que ele retoma no mês (t úmida) */
  feedTph?: number;
  feedWetT?: number;
  /** parte de cada movimentação que sai do local */
  perRoute?: { routeId: string; name: string; trucksLoaded: number; busyH: number; neededExact: number }[];
  loaderName: string;
  /** caçambadas por caminhão (média ponderada) */
  passes: number;
  /** tempo de carga por caminhão (min, média ponderada) */
  loadMin: number;
  /** caminhões carregados por mês */
  trucksLoaded: number;
  /** horas de carga necessárias no mês */
  busyH: number;
  /** horas efetivas de um equipamento no mês (calendário × DF × UF) */
  effHPerUnit: number;
  neededExact: number;
  needed: number;
  available: number | null;
  /** ocupação dos equipamentos disponíveis (ou dos necessários) */
  utilization: number;
}

/**
 * Quantos equipamentos de carga cada local precisa: horas de carga no mês (caminhões carregados × tempo de carga)
 * ÷ horas efetivas de um equipamento (calendário × DF do equipamento × UF da área).
 */
export function loaderSizing(routes: Route[], premises: DetailedPremises, analyses: RouteAnalysis[]): LoaderNeed[] {
  const out: LoaderNeed[] = [];
  const byId = new Map(analyses.map((a) => [a.id, a]));
  const active = routes.filter((r) => r.active && byId.has(r.id));
  const areaOf = (k: RouteKind) => (k === 'product' || k === 'tailings' ? 'planta' : 'mina');
  const uf = (area: 'mina' | 'planta') => (area === 'mina' ? premises.ufMina : premises.ufPlanta) || 100;
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : DEFAULT_LOOSE_DENSITY;
  for (const n of premises.nodes ?? []) for (const e of nodeLoaderEntries(n)) {
    const lid = entryClassId(e, premises);
    const l = lid && lid !== 'silo' ? catalogOf(premises).loaders.find((x) => x.id === lid) : null;
    if (!l) continue;
    const lName = `${l.manufacturer ? `${l.manufacturer} ` : ''}${l.name}`;
    if (e.role === 'alimentacao') {
      // alimentação da planta: o equipamento retoma do pátio e alimenta o processo (sem caminhão), pela massa que chega ao local
      const ins = active.filter((r) => r.toId === n.id);
      const feedWetT = ins.reduce((acc, r) => acc + (byId.get(r.id)?.targetWetT ?? 0), 0);
      const passT = Math.max(l.bucketM3, 0.01) * ((l.fillFactor ?? 90) / 100) * density;
      const tph = (passT * 3600) / Math.max(1, loaderCycleSec(l));
      const busyH = tph > 0 ? feedWetT / tph : 0;
      const effH = sumCalendarHours(premises, 'planta') * ((l.dfPct ?? premises.dfPlanta ?? 85) / 100) * (uf('planta') / 100);
      const neededExact = effH > 0 ? busyH / effH : 0;
      const available = e.count ?? null;
      out.push({
        where: n.name, source: 'local', role: 'alimentacao', entryId: e.id, nodeId: n.id, routeIds: ins.map((r) => r.id), loaderName: lName,
        passes: 0, loadMin: 0, trucksLoaded: 0, feedTph: tph, feedWetT, busyH, effHPerUnit: effH, neededExact,
        needed: Math.max(busyH > 0 ? 1 : 0, Math.ceil(neededExact - 1e-6)), available,
        utilization: effH > 0 ? busyH / (effH * Math.max(1, available ?? Math.ceil(neededExact - 1e-6))) : 0,
      });
      continue;
    }
    const rs = active.filter((r) => r.fromId === n.id && !r.loader && entryForRoute(n, r.id)?.id === e.id);
    if (!rs.length) continue;
    let trucks = 0;
    let busyMin = 0;
    let passesW = 0;
    const perRoute: LoaderNeed['perRoute'] = [];
    for (const r of rs) {
      const a = byId.get(r.id)!;
      let tR = 0;
      let bR = 0;
      if (a.mix?.length) {
        // frota mista: cada tipo carrega a sua parte da meta com as suas caçambadas
        const cap = a.mix.reduce((s, m) => s + m.capacityWetT, 0) || 1;
        for (const m of a.mix) {
          const t = m.payloadT > 0 ? (a.targetWetT * (m.capacityWetT / cap)) / m.payloadT : 0;
          tR += t;
          bR += t * (m.loadMin ?? a.loading?.loadMin ?? 0);
          passesW += t * (m.passes ?? a.loading?.passes ?? 0);
        }
      } else {
        tR = a.payloadT > 0 ? a.targetWetT / a.payloadT : 0;
        bR = tR * (a.loading?.loadMin ?? 0);
        passesW += tR * (a.loading?.passes ?? 0);
      }
      trucks += tR;
      busyMin += bR;
      perRoute.push({ routeId: r.id, name: r.name, trucksLoaded: tR, busyH: bR / 60, neededExact: 0 });
    }
    const area = areaOf(routeKind(rs[0]));
    const effH = sumCalendarHours(premises, area) * ((n.loaderDf ?? l.dfPct ?? premises.dfMina ?? 85) / 100) * (uf(area) / 100);
    const busyH = busyMin / 60;
    const neededExact = effH > 0 ? busyH / effH : 0;
    for (const pr of perRoute) pr.neededExact = effH > 0 ? pr.busyH / effH : 0;
    const available = e.count ?? null;
    out.push({
      where: n.name,
      source: 'local',
      role: 'caminhoes',
      entryId: e.id,
      nodeId: n.id,
      routeIds: rs.map((r) => r.id),
      perRoute,
      loaderName: lName,
      passes: trucks ? passesW / trucks : 0,
      loadMin: trucks ? busyMin / trucks : 0,
      trucksLoaded: trucks,
      busyH,
      effHPerUnit: effH,
      neededExact,
      needed: Math.max(busyH > 0 ? 1 : 0, Math.ceil(neededExact - 1e-6)),
      available,
      utilization: effH > 0 ? busyH / (effH * Math.max(1, available ?? Math.ceil(neededExact - 1e-6))) : 0,
    });
  }
  for (const r of active.filter((x) => x.loader)) {
    const a = byId.get(r.id)!;
    if (!a.loader) continue;
    const t = a.payloadT > 0 ? a.targetWetT / a.payloadT : 0;
    const busyH = (t * a.loader.loadMin) / 60;
    const effH = a.loader.hours.effective;
    const neededExact = effH > 0 ? busyH / effH : 0;
    out.push({
      where: r.name,
      source: 'rota',
      routeIds: [r.id],
      loaderName: a.loader.name,
      passes: a.loader.passes,
      loadMin: a.loader.loadMin,
      trucksLoaded: t,
      busyH,
      effHPerUnit: effH,
      neededExact,
      needed: Math.max(busyH > 0 ? 1 : 0, Math.ceil(neededExact - 1e-6)),
      available: a.loader.count,
      utilization: effH > 0 ? busyH / (effH * Math.max(1, a.loader.count)) : 0,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Comparador de classes de caminhão                                           */
/* -------------------------------------------------------------------------- */

export function compareTruckClasses(route: Route, premises: DetailedPremises, targetDryT: number): ClassOption[] {
  const catalog = catalogOf(premises);
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
  const catalog = catalogOf(premises);
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

/* -------------------------------------------------------------------------- */
/* Coerência rotas + frota extra ≤ frota das premissas                          */
/* -------------------------------------------------------------------------- */

/** Caminhões das premissas que não estão em nenhuma rota ativa (inteiro). */
export function trucksWithoutRoute(routes: Route[], premises: DetailedPremises): number {
  const onRoutes = routes.filter((r) => r.active).reduce((a, r) => a + Math.max(0, r.truckCount || 0), 0);
  return Math.max(0, Math.floor((premises.truckCount || 0) - onRoutes + 1e-9));
}

/**
 * Ajusta as alocações da frota extra para caberem nos caminhões sem rota:
 * nenhuma alocação usa mais caminhões do que os sem rota, e a soma das horas-caminhão
 * não passa de (sem rota × horas do mês). Alocações de rotas apagadas/inativas saem.
 * Devolve null quando nada muda.
 */
export function fitExtraAllocations(routes: Route[], premises: DetailedPremises): ExtraFleetAllocation[] | null {
  const list = premises.extraAllocations ?? [];
  if (!list.length) return null;
  const free = trucksWithoutRoute(routes, premises);
  const cal = sumCalendarHours(premises, 'mina') || 1;
  let budget = free * cal;
  const activeIds = new Set(routes.filter((r) => r.active).map((r) => r.id));
  const out: ExtraFleetAllocation[] = [];
  let changed = false;
  for (const x of list) {
    if (!activeIds.has(x.routeId)) {
      changed = true;
      continue;
    }
    let trucks = Math.min(x.truckCount, free);
    let hours = Math.min(x.durationHours, cal);
    if (trucks * hours > budget + 1e-6) {
      // primeiro reduz caminhões inteiros, depois as horas
      trucks = Math.min(trucks, Math.floor(budget / Math.max(hours, 1e-9) + 1e-9));
      if (trucks <= 0 && budget > 1e-6) {
        trucks = 1;
        hours = budget;
      }
    }
    if (trucks <= 0 || hours <= 0) {
      changed = true;
      continue;
    }
    if (trucks !== x.truckCount || Math.abs(hours - x.durationHours) > 1e-6) changed = true;
    budget -= trucks * hours;
    out.push({ ...x, truckCount: trucks, durationHours: hours });
  }
  return changed ? out : null;
}

export interface AdjustResult {
  routes: Route[];
  extraAllocations: ExtraFleetAllocation[];
  moves: { routeId: string; name: string; from: number; to: number }[];
  /** caminhões que ficam sem rota (frota extra) */
  freeTrucks: number;
  /** caminhões que faltariam para todas as rotas baterem a meta */
  shortfall: number;
  meetsTarget: boolean;
}

/**
 * Ajusta a frota inteira à produção: cada rota recebe o número inteiro de caminhões que atende a sua
 * meta (necessário exato arredondado para cima), sem contar a frota extra. Se a frota não der para
 * todas, os caminhões vão para quem está mais longe da meta (ROM primeiro). O que sobra fica sem rota,
 * na frota extra, e as alocações por horas são reajustadas para caberem nessa sobra.
 */
export function adjustFleetToTarget(routes: Route[], premises: DetailedPremises): AdjustResult {
  const clean = { ...premises, extraAllocations: [] };
  const opt0 = optimizeFleet(routes, clean, 'zero');
  const opt = { ...opt0, routes: opt0.routes.map((r) => (r.active ? { ...r, fleetMode: 'inteiro' as const } : r)) };
  const freeTrucks = trucksWithoutRoute(opt.routes, premises);
  const fitted = fitExtraAllocations(opt.routes, premises) ?? premises.extraAllocations ?? [];
  const after = analyzeFleet(opt.routes, { ...premises, extraAllocations: fitted });
  return {
    routes: opt.routes,
    extraAllocations: fitted,
    moves: opt.moves,
    freeTrucks,
    shortfall: opt.missingForTarget,
    meetsTarget: after.meetsTarget,
  };
}

/**
 * Mantém as rotas em modo automático ('inteiro' ou 'exato') sempre ajustadas à meta, também quando
 * as premissas mudam (fila, DMT, DF…). A soma nunca passa da frota: se faltar caminhão, ele vai
 * primeiro para a rota mais longe da meta (ROM no empate). Devolve null quando nada muda.
 */
export function syncAutoFleet(routes: Route[], premises: DetailedPremises): Route[] | null {
  // frota mista (ou saída dela): a composição por tipo decide os caminhões de cada rota
  if (mixedOn(premises) || routes.some((r) => r.mix)) return syncMix(routes, premises);
  const auto = routes.filter((r) => r.active && (r.fleetMode === 'inteiro' || r.fleetMode === 'exato'));
  if (!auto.length) return null;
  const targets = routeTargets(routes, premises);
  const manual = routes.filter((r) => r.active && !auto.includes(r)).reduce((a, r) => a + Math.max(0, r.truckCount || 0), 0);
  let pool = Math.max(0, (premises.truckCount || 0) - manual);
  const desired = new Map<string, number>();
  for (const r of auto) {
    const ex = analyzeRoute(r, premises, targets.get(r.id) || 0, { trucks: 0 }).trucksNeededExact;
    desired.set(r.id, r.fleetMode === 'inteiro' ? Math.ceil(ex - 1e-6) : Math.ceil(ex * 100 - 1e-6) / 100);
  }
  const total = [...desired.values()].reduce((a, b) => a + b, 0);
  const given = new Map<string, number>();
  if (total <= pool + 1e-9) {
    for (const [k, v] of desired) given.set(k, v);
  } else {
    for (const r of auto) given.set(r.id, 0);
    for (let guard = 0; guard < 10000 && pool > 1e-9; guard++) {
      let best: Route | null = null;
      let key = Infinity;
      for (const r of auto) {
        const d = desired.get(r.id)!;
        const g = given.get(r.id)!;
        if (g >= d - 1e-9) continue;
        const k = g / Math.max(d, 1e-9) - (routeKind(r) === 'rom' ? 1e-6 : 0);
        if (k < key) {
          key = k;
          best = r;
        }
      }
      if (!best) break;
      const d = desired.get(best.id)!;
      const g = given.get(best.id)!;
      const step = Math.min(1, d - g, pool);
      given.set(best.id, Math.round((g + step) * 100) / 100);
      pool -= step;
    }
  }
  let changed = false;
  const next = routes.map((r) => {
    if (!given.has(r.id)) return r;
    const v = given.get(r.id)!;
    if (Math.abs((r.truckCount || 0) - v) < 1e-9) return r;
    changed = true;
    return { ...r, truckCount: v, isManualOverride: true };
  });
  return changed ? next : null;
}

/** Formata número de caminhões: inteiro sem casas, quebrado com 2 casas (3,60). */
export function fmtTrucks(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
