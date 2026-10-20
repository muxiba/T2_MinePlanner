/**
 * Plano de lavra por períodos: frentes que mudam a cada período, destinos de rejeito
 * (sólidos de disposição), movimentações (t por período) e a malha de vias formada pelas rotas.
 *
 * Para cada período monta um modelo de simulação próprio: uma rota por movimentação,
 * do ponto de carga daquele período ao ponto de descarga, pelo caminho mais curto na malha,
 * com acessos internos (rampa limitada) nas pontas.
 */
import { limitsOf, loadTime, payloadFor, replicate, travelTimes } from './des';
import { simplify } from './dxf';
import type { AggregateStats, Circuit, Scenario, SimModel, SimRoute, TruckConfig, Vec3 } from './types';

/* ------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* ------------------------------------------------------------------------- */

export type PlaceKind = 'frente' | 'usina' | 'pilha' | 'terminal' | 'rejeito' | 'outro';

export const PLACE_KINDS: { id: PlaceKind; label: string }[] = [
  { id: 'frente', label: 'Frente de lavra (muda por período)' },
  { id: 'rejeito', label: 'Destino com sólido do período (rejeito, estéril, PDE…)' },
  { id: 'usina', label: 'Usina / planta' },
  { id: 'pilha', label: 'Pilha / pátio' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'outro', label: 'Outro' },
];

/** Ponto de carga ou descarga. Frentes e destinos de rejeito usam esta posição só quando o período não tem área/sólido. */
export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  x: number;
  y: number;
  z: number;
}

/** Área lavrada em um período (contorno do DXF da frente). */
export interface FrontArea {
  id: string;
  period: number;
  /** nome da frente (Place.name) */
  front: string;
  /** definido pelo usuário (não reatribuir automaticamente) */
  manual?: boolean;
  ring: [number, number][];
  areaM2: number;
  /** cota média de lavra no período (pé da cava dentro da área) */
  z: number;
  zMin: number;
  zMax: number;
  /** ponto de carga (dentro da área, perto do centro) */
  lx: number;
  ly: number;
  file?: string;
}

/** Sólido de disposição de rejeito de um período. */
export interface DisposalSolid {
  id: string;
  period: number;
  name: string;
  volumeM3: number;
  hull: [number, number][];
  cx: number;
  cy: number;
  zMin: number;
  zMax: number;
  faces: number;
  file?: string;
  /** topo do sólido em grade grossa (para a topografia do período na vista 3D) */
  top?: import('./dem').TopGrid;
}

export interface Movement {
  id: string;
  material: string;
  origin: string; // Place.id
  destination: string; // Place.id
  /** densidade solta (t/m³), para o limite de volume da caçamba */
  density: number;
  loaders: number;
  bucketT: number;
  passMin: number;
  loadSpotMin: number;
  loaderDf: number;
  dumpStations: number;
  weighing: boolean;
  weighMin: number;
  /** toneladas por período (índice = período − 1), na base do plano (seca ou úmida) */
  tonnes: number[];
  /** movimentação calculada a partir do ROM (não editável): produto e rejeito do ROM que entra na usina, estéril do ROM da frente */
  derived?: { kind: 'produto' | 'rejeito' | 'esteril'; source: string };
}

export interface Period {
  label: string;
  /** dias trabalháveis no período (derivado do tipo e do calendário quando `kind` existe) */
  workDays: number;
  /** duração: mês, ano, quinquênio ou n dias */
  kind?: import('./link').PeriodKind;
  /** dias corridos, quando kind = 'dias' */
  days?: number;
  /** quantidade de unidades (ex.: 3 meses, 2 anos); padrão 1 */
  qty?: number;
  /** mês do calendário (1–12), quando kind = 'mes'; vazio = mês médio */
  month?: number;
  /** dias corridos do período (derivado) */
  calendarDays?: number;
  /** meta de ROM do período (t seca); vazio = consumo mensal das premissas × meses do período */
  romT?: number;
}

export interface MonthCal {
  month: string;
  days: number;
  workDays: number;
  season: 'chuvoso' | 'seco';
}

export interface MinePlan {
  periods: Period[];
  calendar: MonthCal[];
  hoursPerDay: number;
  /** multiplica a meta diária (ex.: 1,2 para dimensionar pelo mês mais carregado) */
  peakFactor: number;
  places: Place[];
  movements: Movement[];
  fronts: FrontArea[];
  solids: DisposalSolid[];
  /** rampa máxima dos acessos internos (%) */
  rampMaxGrade: number;
  /** sinuosidade dos acessos internos (comprimento ÷ distância em linha reta) */
  accessTortuosity: number;
  /** densidade do rejeito disposto (t/m³), para conferir a capacidade dos sólidos */
  disposalDensity: number;
  /** base das toneladas das movimentações: 'seca' (convertida para úmida no transporte) ou 'umida'; vazio = úmida */
  tonnesBasis?: 'seca' | 'umida';
  /** fator seca → úmida transportada (das premissas) */
  wetFactor?: number;
}

/* ------------------------------------------------------------------------- */
/* Padrões                                                                    */
/* ------------------------------------------------------------------------- */

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MONTH_LEN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Calendário uniforme: 12 meses, 26 dias trabalháveis por mês (312 por ano). Editável. */
export function defaultCalendar(): MonthCal[] {
  return MONTH_LEN.map((d, i) => ({ month: MONTHS_PT[i], days: d, workDays: Math.min(26, d), season: 'seco' as const }));
}

/** Calendário com estação chuvosa: janeiro a março e outubro a dezembro com 20 dias, demais com 26. Editável. */
export function rainySeasonCalendar(): MonthCal[] {
  return MONTH_LEN.map((d, i) => {
    const rainy = [1, 2, 3, 10, 11, 12].includes(i + 1);
    return { month: MONTHS_PT[i], days: d, workDays: rainy ? 20 : 26, season: rainy ? ('chuvoso' as const) : ('seco' as const) };
  });
}

export const calendarWorkDays = (c: MonthCal[]) => c.reduce((a, m) => a + (m.workDays || 0), 0);

export function emptyPlan(): MinePlan {
  const calendar = rainySeasonCalendar();
  return {
    periods: Array.from({ length: 5 }, (_, i) => ({ label: `Ano ${i + 1}`, workDays: calendarWorkDays(calendar), kind: 'ano' as const, calendarDays: 365 })),
    calendar,
    hoursPerDay: 20,
    peakFactor: 1,
    places: [],
    movements: [],
    fronts: [],
    solids: [],
    rampMaxGrade: 10,
    accessTortuosity: 1.3,
    disposalDensity: 1.85,
  };
}

export function newMovement(id: string, origin: string, destination: string, periods: number, material = 'Minério (ROM)'): Movement {
  return {
    id,
    material,
    origin,
    destination,
    density: 1.8,
    loaders: 1,
    bucketT: 10,
    passMin: 0.6,
    loadSpotMin: 0.5,
    loaderDf: 85,
    dumpStations: 1,
    weighing: false,
    weighMin: 1,
    tonnes: Array.from({ length: periods }, () => 0),
  };
}

/** Pontos de carga/descarga a partir das pontas das rotas (pontas a menos de 15 m viram um só lugar). */
export function placesFromRoutes(routes: SimRoute[], existing: Place[] = []): Place[] {
  const out = [...existing];
  const near = (p: Vec3) => out.find((q) => Math.hypot(q.x - p.x, q.y - p.y) < 15);
  for (const r of routes) {
    const ends: [Vec3, string][] = [
      [r.points[0], `Início ${r.name}`],
      [r.points[r.points.length - 1], `Fim ${r.name}`],
    ];
    for (const [p, name] of ends) {
      if (near(p)) continue;
      out.push({ id: `p${out.length + 1}-${Math.round(p.x)}`, name, kind: 'outro', x: p.x, y: p.y, z: p.z });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Geometria                                                                  */
/* ------------------------------------------------------------------------- */

export function ringArea(r: [number, number][]) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function pointInRing(x: number, y: number, r: [number, number][]) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Ponto dentro do polígono, o mais perto possível do centroide (ponto de carga da frente). */
export function interiorPoint(r: [number, number][]): [number, number] {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % r.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return r[0];
  cx /= 3 * a;
  cy /= 3 * a;
  if (pointInRing(cx, cy, r)) return [cx, cy];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of r) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const step = Math.max(maxX - minX, maxY - minY) / 60;
  let best: [number, number] = r[0];
  let bd = Infinity;
  for (let x = minX + step / 2; x < maxX; x += step)
    for (let y = minY + step / 2; y < maxY; y += step) {
      if (!pointInRing(x, y, r)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bd) { bd = d; best = [x, y]; }
    }
  return best;
}

export function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/* ------------------------------------------------------------------------- */
/* Atribuição das áreas às frentes                                            */
/* ------------------------------------------------------------------------- */

/**
 * Em cada período, distribui as áreas entre as frentes com movimentação (t > 0), escolhendo a
 * combinação que minimiza: distância de cada área à referência da frente + desequilíbrio entre
 * a fração da área e a fração da tonelagem de cada frente (1 ponto de fração = 1 km).
 * Assim a frente que mais produz fica com a maior área, e áreas vão para a frente mais próxima.
 * Áreas marcadas como manuais não mudam.
 */
export function assignFronts(plan: MinePlan): FrontArea[] {
  const frontPlaces = plan.places.filter((p) => p.kind === 'frente');
  if (!frontPlaces.length) return plan.fronts;
  const out = plan.fronts.map((f) => ({ ...f }));
  const periods = [...new Set(out.map((f) => f.period))];
  for (const per of periods) {
    const areas = out.filter((f) => f.period === per && !f.manual);
    if (!areas.length) continue;
    const tonnesOf = (p: Place) => plan.movements.filter((m) => m.origin === p.id).reduce((a, m) => a + (m.tonnes[per - 1] ?? 0), 0);
    const active = frontPlaces.filter((p) => tonnesOf(p) > 0);
    const cands = active.length ? active : frontPlaces;
    if (cands.length === 1) {
      for (const a of areas) a.front = cands[0].name;
      continue;
    }
    const tTot = cands.reduce((a, p) => a + tonnesOf(p), 0) || 1;
    const aTot = areas.reduce((a, x) => a + x.areaM2, 0) || 1;
    const shareT = cands.map((p) => (active.length ? tonnesOf(p) / tTot : 1 / cands.length));
    const dist = areas.map((a) => cands.map((p) => Math.hypot(a.lx - p.x, a.ly - p.y)));
    const choice = new Array(areas.length).fill(0);
    let best: number[] | null = null;
    let bestCost = Infinity;
    const combos = cands.length ** areas.length;
    if (combos <= 50_000) {
      for (let k = 0; k < combos; k++) {
        let v = k;
        let cost = 0;
        const shareA = new Array(cands.length).fill(0);
        for (let i = 0; i < areas.length; i++) {
          choice[i] = v % cands.length;
          v = Math.floor(v / cands.length);
          cost += dist[i][choice[i]];
          shareA[choice[i]] += areas[i].areaM2 / aTot;
        }
        for (let j = 0; j < cands.length; j++) cost += 1000 * Math.abs(shareT[j] - shareA[j]);
        if (cost < bestCost) {
          bestCost = cost;
          best = [...choice];
        }
      }
    } else best = dist.map((row) => row.indexOf(Math.min(...row)));
    areas.forEach((a, i) => (a.front = cands[best![i]].name));
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Malha de vias                                                              */
/* ------------------------------------------------------------------------- */

interface Net {
  nodes: Vec3[];
  adj: { to: number; w: number }[][];
}

const key = (p: { x: number; y: number }) => `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`;

/** Malha a partir das rotas: vértices, cruzamentos entre rotas e pontas próximas (≤ 15 m) viram nós. */
export function buildNetwork(routes: SimRoute[], snap = 15): Net {
  const lines = routes.map((r) => simplify(r.points, 1.5));
  // cruzamentos entre segmentos de rotas diferentes
  const splits: { t: number; p: Vec3 }[][][] = lines.map((l) => l.map(() => []));
  for (let a = 0; a < lines.length; a++)
    for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a];
      const B = lines[b];
      for (let i = 0; i < A.length - 1; i++) {
        const p = A[i], q = A[i + 1];
        const minx = Math.min(p.x, q.x), maxx = Math.max(p.x, q.x), miny = Math.min(p.y, q.y), maxy = Math.max(p.y, q.y);
        for (let j = 0; j < B.length - 1; j++) {
          const r = B[j], s = B[j + 1];
          if (Math.max(r.x, s.x) < minx || Math.min(r.x, s.x) > maxx || Math.max(r.y, s.y) < miny || Math.min(r.y, s.y) > maxy) continue;
          const d1x = q.x - p.x, d1y = q.y - p.y, d2x = s.x - r.x, d2y = s.y - r.y;
          const den = d1x * d2y - d1y * d2x;
          if (Math.abs(den) < 1e-9) continue;
          const t = ((r.x - p.x) * d2y - (r.y - p.y) * d2x) / den;
          const u = ((r.x - p.x) * d1y - (r.y - p.y) * d1x) / den;
          if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
          const z = (p.z + (q.z - p.z) * t + r.z + (s.z - r.z) * u) / 2;
          const X = { x: p.x + d1x * t, y: p.y + d1y * t, z };
          splits[a][i].push({ t, p: X });
          splits[b][j].push({ t: u, p: X });
        }
      }
    }
  const nodes: Vec3[] = [];
  const index = new Map<string, number>();
  const nodeOf = (p: Vec3) => {
    const k = key(p);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push(p);
      index.set(k, i);
    }
    return i;
  };
  const adj: { to: number; w: number }[][] = [];
  const link = (i: number, j: number) => {
    if (i === j) return;
    const a = nodes[i], b = nodes[j];
    const w = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    (adj[i] ??= []).push({ to: j, w });
    (adj[j] ??= []).push({ to: i, w });
  };
  const ends: number[] = [];
  lines.forEach((l, li) => {
    let prev = -1;
    l.forEach((p, i) => {
      const seq = [p, ...(i < l.length - 1 ? splits[li][i].sort((x, y) => x.t - y.t).map((s) => s.p) : [])];
      for (const v of seq) {
        const n = nodeOf(v);
        if (prev >= 0) link(prev, n);
        prev = n;
      }
    });
    ends.push(nodeOf(l[0]), nodeOf(l[l.length - 1]));
  });
  // pontas de rota perto de qualquer nó de outra rota
  for (const e of ends) {
    const p = nodes[e];
    let best = -1;
    let bd = snap;
    for (let i = 0; i < nodes.length; i++) {
      if (i === e || adj[e]?.some((x) => x.to === i)) continue;
      const d = Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) link(e, best);
  }
  for (let i = 0; i < nodes.length; i++) adj[i] ??= [];
  return { nodes, adj };
}

function nearestNode(net: Net, p: { x: number; y: number }) {
  let best = 0;
  let bd = Infinity;
  net.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function shortestPath(net: Net, from: number, to: number): number[] | null {
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  // malhas pequenas (centenas a poucos milhares de nós): Dijkstra simples com busca linear
  for (;;) {
    let u = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bd) { bd = dist[i]; u = i; }
    if (u < 0) return null;
    if (u === to) break;
    done[u] = 1;
    for (const e of net.adj[u]) {
      const nd = dist[u] + e.w;
      if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
    }
  }
  const path: number[] = [];
  for (let v = to; v >= 0; v = prev[v]) path.unshift(v);
  return path;
}

/**
 * Acesso interno entre um ponto e a via: reta, ou em zigue-zague quando o desnível exige
 * rampa maior que a máxima (o comprimento cresce até a rampa caber).
 */
export function accessLeg(a: Vec3, b: Vec3, maxGradePct: number, tortuosity: number): Vec3[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const dz = b.z - a.z;
  const need = Math.max(d * Math.max(1, tortuosity), Math.abs(dz) / Math.max(0.01, maxGradePct / 100));
  if (d < 1) return [a, b];
  if (need <= d * 1.02) return [a, b];
  let k = Math.max(2, Math.ceil(need / 80));
  if (k % 2) k++;
  const w = Math.sqrt(Math.max(0, (need / k) ** 2 - (d / k) ** 2));
  const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
  const vx = -uy, vy = ux;
  const pts: Vec3[] = [];
  let acc = 0;
  let last = a;
  for (let i = 0; i <= k; i++) {
    const lat = i === 0 || i === k ? 0 : i % 2 ? w : 0;
    const x = a.x + ux * ((d * i) / k) + vx * lat;
    const y = a.y + uy * ((d * i) / k) + vy * lat;
    if (i) acc += Math.hypot(x - last.x, y - last.y);
    const p = { x, y, z: 0 };
    pts.push(p);
    last = p;
  }
  let s = 0;
  pts[0].z = a.z;
  for (let i = 1; i < pts.length; i++) {
    s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    pts[i].z = a.z + (dz * s) / (acc || 1);
  }
  return pts;
}

/* ------------------------------------------------------------------------- */
/* Pontos de cada período                                                     */
/* ------------------------------------------------------------------------- */

export interface ResolvedPoint {
  p: Vec3;
  /** de onde veio a posição */
  source: 'area' | 'solido' | 'fixo';
  label: string;
}

export function resolvePlace(plan: MinePlan, placeId: string, period: number): ResolvedPoint | null {
  const pl = plan.places.find((p) => p.id === placeId);
  if (!pl) return null;
  if (pl.kind === 'frente') {
    const areas = plan.fronts.filter((f) => f.period === period && f.front === pl.name);
    if (areas.length) {
      const a = areas.reduce((x, y) => (y.areaM2 > x.areaM2 ? y : x));
      return { p: { x: a.lx, y: a.ly, z: a.z || pl.z }, source: 'area', label: a.areaM2 > 10 ? `${pl.name} · área ${fmtHa(a.areaM2)}` : `${pl.name} · ponto do período` };
    }
  }
  if (pl.kind === 'rejeito') {
    const s = plan.solids.find((x) => x.period === period);
    if (s) return { p: { x: s.cx, y: s.cy, z: (s.zMin + s.zMax) / 2 }, source: 'solido', label: s.name };
  }
  return { p: { x: pl.x, y: pl.y, z: pl.z }, source: 'fixo', label: pl.name };
}

const fmtHa = (m2: number) => `${(m2 / 1e4).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ha`;

/** Caminho (pontos 3D) entre dois pontos: acesso → malha → acesso. */
export function pathBetween(net: Net, a: Vec3, b: Vec3, plan: Pick<MinePlan, 'rampMaxGrade' | 'accessTortuosity'>): Vec3[] {
  if (!net.nodes.length) return accessLeg(a, b, plan.rampMaxGrade, plan.accessTortuosity);
  const na = nearestNode(net, a);
  const nb = nearestNode(net, b);
  const path = shortestPath(net, na, nb) ?? [na, nb];
  const mid = path.map((i) => net.nodes[i]);
  const head = accessLeg(a, mid[0], plan.rampMaxGrade, plan.accessTortuosity);
  const tail = accessLeg(mid[mid.length - 1], b, plan.rampMaxGrade, plan.accessTortuosity);
  const pts = [...head, ...mid.slice(1, -1), ...tail];
  // remove pontos repetidos
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.2 || Math.abs(p.z - pts[i - 1].z) > 0.05);
}

/* ------------------------------------------------------------------------- */
/* Modelo de um período                                                       */
/* ------------------------------------------------------------------------- */

export interface PeriodCircuitInfo {
  movementId: string;
  circuitId: string;
  name: string;
  material: string;
  tonnes: number;
  targetTpd: number;
  originLabel: string;
  destLabel: string;
  originSource: ResolvedPoint['source'];
  destSource: ResolvedPoint['source'];
  lengthM: number;
  dz: number;
}

export function buildPeriodModel(base: SimModel, plan: MinePlan, period: number, net = buildNetwork(base.routes)) {
  const routes: SimRoute[] = [];
  const circuits: Circuit[] = [];
  const info: PeriodCircuitInfo[] = [];
  const per = plan.periods[period - 1];
  const days = Math.max(1, per?.workDays ?? 1);
  const basisK = plan.tonnesBasis === 'seca' ? plan.wetFactor || 1 : 1;
  for (const m of plan.movements) {
    const t = (m.tonnes[period - 1] ?? 0) * basisK;
    if (!(t > 0)) continue;
    const o = resolvePlace(plan, m.origin, period);
    const d = resolvePlace(plan, m.destination, period);
    if (!o || !d) continue;
    const pts = pathBetween(net, o.p, d.p, plan);
    const id = `pm-${m.id}`;
    const destName = plan.places.find((p) => p.id === m.destination)?.name ?? 'Destino';
    const originName = plan.places.find((p) => p.id === m.origin)?.name ?? 'Origem';
    const name = `${originName} → ${destName}`;
    routes.push({ id: `r-${id}`, name, points: pts });
    const prev = base.circuits.find((c) => c.id === id);
    circuits.push({
      id,
      name,
      routeId: `r-${id}`,
      trucks: prev?.trucks ?? 1,
      density: m.density,
      loaders: Math.max(1, m.loaders),
      loadSpotMin: m.loadSpotMin,
      loaderTph: 600,
      bucketT: m.bucketT,
      passMin: m.passMin,
      loaderDf: m.loaderDf,
      weighing: m.weighing,
      weighMin: m.weighMin,
      dumpStations: Math.max(1, m.dumpStations),
      destination: destName,
    });
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    info.push({
      movementId: m.id,
      circuitId: id,
      name,
      material: m.material,
      tonnes: t,
      targetTpd: (t / days) * (plan.peakFactor || 1),
      originLabel: o.label,
      destLabel: d.label,
      originSource: o.source,
      destSource: d.source,
      lengthM: L,
      dz: pts[pts.length - 1].z - pts[0].z,
    });
  }
  // recebimento: só os destinos com recebimento cadastrado na aba Circuito (mesmo nome) têm restrição
  const receiving = base.receiving.filter((r) => circuits.some((c) => c.destination === r.destination));
  const model: SimModel = { ...base, routes, circuits, receiving, targetTpd: 0, plan: undefined };
  return { model, info };
}

/* ------------------------------------------------------------------------- */
/* Dimensionamento por período                                                */
/* ------------------------------------------------------------------------- */

export interface PeriodCircuitResult extends PeriodCircuitInfo {
  trucks: number;
  achievedTpd: number;
  cycleMin: number;
  loadedMin: number;
  emptyMin: number;
  payloadT: number;
  /** não atinge a meta nem com mais caminhões (gargalo na carga/descarga) */
  saturated: boolean;
}

export interface PeriodResult {
  period: number;
  label: string;
  configId: string;
  scenarioId?: string;
  /** disponibilidade física usada no período (já descontado o envelhecimento) */
  truckDf?: number;
  /** idade média da frota no início do período (h) */
  avgAgeH?: number;
  circuits: PeriodCircuitResult[];
  trucks: number;
  /** necessidade sem arredondar (soma de caminhões × meta ÷ produção simulada): compara configurações */
  trucksExact: number;
  loaders: number;
  /** horas trabalhadas da frota de caminhões no período */
  truckHours: number;
  /** horas de operação por caminhão no período (média) */
  hoursPerTruck: number;
  ok: boolean;
  stats: Pick<AggregateStats, 'loaderUtil' | 'dumpUtil' | 'queueLoadMin' | 'queueDumpMin' | 'costPerT'> | null;
}

/** Estimativa inicial: caminhões = produção horária × ciclo ÷ (carga útil × eficiência × disponibilidade). */
function initialTrucks(model: SimModel, c: Circuit, cfg: TruckConfig, sc: Scenario, targetTpd: number) {
  const r = model.routes.find((x) => x.id === c.routeId)!;
  const tt = travelTimes(r.points, cfg.speed, limitsOf(model, cfg), model.rollingResistance);
  const cycle = loadTime(cfg, c) + (tt.loaded + tt.empty) * (sc.travelFactor || 1) + cfg.dumpMin + cfg.maneuverMin + (c.weighing ? c.weighMin : 0);
  const tph = targetTpd / Math.max(1, sc.hoursPerDay);
  const perTruck = (payloadFor(cfg, c) * 60) / cycle * (sc.efficiency / 100) * (sc.truckDf / 100);
  return { n: Math.max(1, Math.ceil(tph / Math.max(perTruck, 1e-6))), tt, cycle };
}

export function sizePeriod(
  base: SimModel,
  plan: MinePlan,
  period: number,
  cfg: TruckConfig,
  scenarioBase: Scenario,
  opts: { reps?: number; maxIter?: number; net?: ReturnType<typeof buildNetwork> } = {},
): PeriodResult {
  const { model, info } = buildPeriodModel(base, plan, period, opts.net);
  const sc: Scenario = { ...scenarioBase, hoursPerDay: plan.hoursPerDay || scenarioBase.hoursPerDay };
  const label = plan.periods[period - 1]?.label ?? `Período ${period}`;
  if (!model.circuits.length)
    return { period, label, configId: cfg.id, circuits: [], trucks: 0, trucksExact: 0, loaders: 0, truckHours: 0, hoursPerTruck: 0, ok: true, stats: null };
  const reps = opts.reps ?? Math.min(base.replications, 4);
  const trucks: Record<string, number> = {};
  const extra: Record<string, { tt: { loaded: number; empty: number } }> = {};
  model.circuits.forEach((c, i) => {
    const est = initialTrucks(model, c, cfg, sc, info[i].targetTpd);
    trucks[c.id] = est.n;
    extra[c.id] = { tt: est.tt };
  });
  const saturated = new Set<string>();
  const lastGainBase: Record<string, number> = {};
  let agg = replicate(model, { config: cfg, scenario: sc, trucks }, reps);
  const maxIter = opts.maxIter ?? 40;
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    model.circuits.forEach((c, i) => {
      if (saturated.has(c.id)) return;
      const got = agg.perCircuit[i]?.tpd.mean ?? 0;
      if (got >= info[i].targetTpd * 0.995) return;
      // ganho do último caminhão adicionado muito pequeno → gargalo fora da frota
      if (lastGainBase[c.id] !== undefined && got < lastGainBase[c.id] * 1.015) {
        saturated.add(c.id);
        trucks[c.id] = Math.max(1, trucks[c.id] - 1);
        changed = true;
        return;
      }
      lastGainBase[c.id] = got;
      trucks[c.id]++;
      changed = true;
    });
    if (!changed) break;
    agg = replicate(model, { config: cfg, scenario: sc, trucks }, reps);
  }
  // reduz se a estimativa inicial passou da conta
  for (let i = 0; i < model.circuits.length; i++) {
    const c = model.circuits[i];
    while (trucks[c.id] > 1 && !saturated.has(c.id)) {
      const test = { ...trucks, [c.id]: trucks[c.id] - 1 };
      const a2 = replicate(model, { config: cfg, scenario: sc, trucks: test }, reps);
      const ok = model.circuits.every((cc, j) => (a2.perCircuit[j]?.tpd.mean ?? 0) >= info[j].targetTpd * 0.995 || saturated.has(cc.id));
      if (!ok) break;
      trucks[c.id]--;
      agg = a2;
    }
  }
  const nTrucks = Object.values(trucks).reduce((a, b) => a + b, 0);
  const worked = 1 - (agg.stateShare.manutencao ?? 0) - (agg.stateShare.fora_turno ?? 0);
  const days = Math.max(1, plan.periods[period - 1]?.workDays ?? 1);
  // horas efetivamente trabalhadas: a frota inteira passa da meta (não existe fração de caminhão),
  // então cada movimentação trabalha só o necessário para a meta e o resto fica parado
  const truckHours = model.circuits.reduce((a, c, i) => {
    const got = agg.perCircuit[i]?.tpd.mean ?? 0;
    const use = got > 0 ? Math.min(1, info[i].targetTpd / got) : 1;
    return a + trucks[c.id] * use * worked * 24 * days;
  }, 0);
  const circuits: PeriodCircuitResult[] = model.circuits.map((c, i) => {
    const got = agg.perCircuit[i]?.tpd.mean ?? 0;
    return {
      ...info[i],
      trucks: trucks[c.id],
      achievedTpd: got,
      cycleMin: 0,
      loadedMin: extra[c.id].tt.loaded * (sc.travelFactor || 1),
      emptyMin: extra[c.id].tt.empty * (sc.travelFactor || 1),
      payloadT: payloadFor(cfg, c),
      saturated: saturated.has(c.id) && got < info[i].targetTpd * 0.995,
    };
  });
  return {
    period,
    label,
    configId: cfg.id,
    circuits,
    trucks: nTrucks,
    trucksExact: circuits.reduce((a, c) => a + (c.achievedTpd > 0 ? (c.trucks * Math.min(c.targetTpd, c.achievedTpd)) / c.achievedTpd : 0), 0),
    loaders: model.circuits.reduce((a, c) => a + c.loaders, 0),
    truckHours,
    hoursPerTruck: nTrucks ? truckHours / nTrucks : 0,
    ok: circuits.every((c) => c.achievedTpd >= c.targetTpd * 0.995),
    stats: { loaderUtil: agg.loaderUtil, dumpUtil: agg.dumpUtil, queueLoadMin: agg.queueLoadMin, queueDumpMin: agg.queueDumpMin, costPerT: agg.costPerT },
  };
}

/** Frota que mantém o período dimensionado (para animação ou matriz do período). */
export function periodModelWithFleet(base: SimModel, plan: MinePlan, period: number, result?: PeriodResult | null) {
  const { model, info } = buildPeriodModel(base, plan, period);
  if (result) {
    model.circuits = model.circuits.map((c) => ({ ...c, trucks: result.circuits.find((r) => r.circuitId === c.id)?.trucks ?? c.trucks }));
  }
  return { model, info };
}

/* ------------------------------------------------------------------------- */
/* Capacidade dos sólidos de rejeito                                          */
/* ------------------------------------------------------------------------- */

export interface DisposalCheck {
  period: number;
  label: string;
  tonnes: number;
  requiredM3: number;
  capacityM3: number;
  balanceM3: number;
  cumulativeM3: number;
}

export function disposalCheck(plan: MinePlan): DisposalCheck[] {
  const rejeito = new Set(plan.places.filter((p) => p.kind === 'rejeito').map((p) => p.id));
  let cum = 0;
  const out: DisposalCheck[] = [];
  plan.periods.forEach((per, i) => {
    const period = i + 1;
    const solid = plan.solids.filter((s) => s.period === period).reduce((a, s) => a + s.volumeM3, 0);
    // só conta períodos com sólido: nos demais o rejeito vai para o destino fixo (ex.: PRU)
    if (!solid) return;
    const tonnes = plan.movements.filter((m) => rejeito.has(m.destination)).reduce((a, m) => a + (m.tonnes[i] ?? 0), 0);
    const req = tonnes / Math.max(0.1, plan.disposalDensity);
    cum += solid - req;
    out.push({ period, label: per.label, tonnes, requiredM3: req, capacityM3: solid, balanceM3: solid - req, cumulativeM3: cum });
  });
  return out;
}

/* ------------------------------------------------------------------------- */
/* Planilha (CSV) das movimentações                                           */
/* ------------------------------------------------------------------------- */

/** Colunas: Material; Origem; Destino; Densidade; P1; P2; ... (nomes dos lugares, t por período). */
export function movementsToCsv(plan: MinePlan) {
  const name = (id: string) => plan.places.find((p) => p.id === id)?.name ?? '';
  const head = ['Material', 'Origem', 'Destino', 'Densidade solta (t/m³)', ...plan.periods.map((p) => p.label)];
  const rows = plan.movements.map((m) => [m.material, name(m.origin), name(m.destination), String(m.density).replace('.', ','), ...plan.periods.map((_, i) => String(Math.round(m.tonnes[i] ?? 0)))]);
  return '﻿' + [head, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

const num = (s: string) => {
  const t = s.trim().replace(/\s/g, '');
  if (!t) return 0;
  // 1.234.567,8 ou 1234567.8
  let n: number;
  if (t.includes(',')) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if ((t.match(/\./g)?.length ?? 0) > 1 || /^\d{1,3}\.\d{3}$/.test(t)) n = Number(t.replace(/\./g, ''));
  else n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

function splitCsvLine(line: string, sep: string) {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Lê a planilha de movimentações. Lugares são casados pelo nome (sem diferenciar maiúsculas);
 * nomes desconhecidos são criados como lugares sem posição (aparecem na lista para corrigir).
 */
export function movementsFromCsv(plan: MinePlan, text: string): { plan: MinePlan; warnings: string[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { plan, warnings: ['Planilha vazia.'] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const head = splitCsvLine(lines[0], sep).map((h) => h.trim());
  const nPer = head.length - 4;
  if (nPer < 1) return { plan, warnings: ['Use as colunas: Material; Origem; Destino; Densidade; e uma coluna por período.'] };
  const warnings: string[] = [];
  const places = [...plan.places];
  const find = (n: string) => {
    const k = n.trim().toLowerCase();
    let p = places.find((x) => x.name.trim().toLowerCase() === k);
    if (!p && n.trim()) {
      p = { id: `p${places.length + 1}-csv`, name: n.trim(), kind: /frente|mina|cava|lavra/i.test(n) ? 'frente' : 'outro', x: 0, y: 0, z: 0 };
      places.push(p);
      warnings.push(`"${n.trim()}" não existia na lista de lugares: foi criado sem posição. Ajuste o tipo e as coordenadas.`);
    }
    return p;
  };
  const periods: Period[] = head.slice(4).map((label, i) => ({ label, workDays: plan.periods[i]?.workDays ?? calendarWorkDays(plan.calendar) }));
  const movements: Movement[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const o = find(c[1] ?? '');
    const d = find(c[2] ?? '');
    if (!o || !d) continue;
    const prev = plan.movements.find((m) => m.origin === o.id && m.destination === d.id && m.material === (c[0] ?? '').trim());
    const mv = prev ? { ...prev } : newMovement(`m${movements.length + 1}-${Date.now().toString(36)}`, o.id, d.id, nPer, (c[0] ?? '').trim() || 'Material');
    mv.density = num(c[3] ?? '') || mv.density;
    mv.tonnes = Array.from({ length: nPer }, (_, i) => num(c[4 + i] ?? ''));
    movements.push(mv);
  }
  return { plan: { ...plan, places, periods, movements }, warnings };
}
