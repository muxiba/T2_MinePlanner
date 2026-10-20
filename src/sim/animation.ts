/**
 * Posição, orientação e estado dos caminhões e dos equipamentos de carga ao longo do tempo,
 * a partir do histórico (trace) da simulação, e os totais acumulados até o instante mostrado.
 */
import { cumulative, pointAt } from './dxf';
import type { CircuitGeometry } from './des';
import type { TraceItem, TruckState, Vec3 } from './types';

export type DotKind = 'carregado' | 'vazio' | 'fila' | 'carregando' | 'descarregando' | 'interferencia' | 'turno' | 'refeicao' | 'abastecimento' | 'manutencao' | 'ocioso';

export const DOT_KINDS: { id: DotKind; label: string }[] = [
  { id: 'carregado', label: 'Viagem carregado' },
  { id: 'vazio', label: 'Retorno vazio' },
  { id: 'carregando', label: 'Carregando' },
  { id: 'descarregando', label: 'Pesagem e descarga' },
  { id: 'fila', label: 'Na fila' },
  { id: 'interferencia', label: 'Interferência na via' },
  { id: 'turno', label: 'Troca de turno / inspeção' },
  { id: 'refeicao', label: 'Refeição' },
  { id: 'abastecimento', label: 'Abastecimento e lubrificação' },
  { id: 'manutencao', label: 'Manutenção' },
  { id: 'ocioso', label: 'Sem utilização (fora do turno, perdas)' },
];

export function kindOf(s: TruckState): DotKind {
  switch (s) {
    case 'carregado':
      return 'carregado';
    case 'vazio':
      return 'vazio';
    case 'fila_carga':
    case 'fila_balanca':
    case 'fila_descarga':
      return 'fila';
    case 'carregando':
      return 'carregando';
    case 'pesando':
    case 'descarregando':
      return 'descarregando';
    case 'manutencao':
      return 'manutencao';
    case 'interferencia':
      return 'interferencia';
    case 'troca_turno':
      return 'turno';
    case 'refeicao':
      return 'refeicao';
    case 'abastecimento':
      return 'abastecimento';
    default:
      return 'ocioso';
  }
}

export interface TruckDot {
  truck: number;
  circuit: number;
  state: TruckState;
  kind: DotKind;
  p: Vec3;
  /** direção da frente do caminhão (rad, 0 = leste, anti-horário) */
  heading: number;
  /** com material na caçamba */
  loaded: boolean;
}

export type LoaderState = 'carregando' | 'parado' | 'manutencao';

export interface LoaderDot {
  circuit: number;
  unit: number;
  p: Vec3;
  heading: number;
  state: LoaderState;
}

export interface PointQueue {
  circuit: number;
  where: 'carga' | 'descarga';
  serving: number;
  waiting: number;
}

/** Dimensões em metros (comprimento × largura) para o desenho em escala. */
export const EQUIP_SIZE = {
  truck: { length: 10.5, width: 2.6, height: 3.4 },
  loader: { length: 9.5, width: 3.3, height: 3.6 },
};

/** Índice por caminhão, com os trechos em ordem de tempo, para busca rápida. */
export function indexTrace(trace: TraceItem[]) {
  const byTruck = new Map<number, TraceItem[]>();
  for (const it of trace) {
    const l = byTruck.get(it.truck);
    if (l) l.push(it);
    else byTruck.set(it.truck, [it]);
  }
  for (const l of byTruck.values()) l.sort((a, b) => a.t0 - b.t0);
  return byTruck;
}

function findAt(list: TraceItem[], t: number) {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const it = list[mid];
    if (t < it.t0) hi = mid - 1;
    else if (t >= it.t1) lo = mid + 1;
    else return it;
  }
  return null;
}

/** Inverte o perfil acumulado de tempo: fração do tempo de viagem → distância. */
function distanceAtFraction(g: CircuitGeometry, frac: number, loaded: boolean) {
  const cum = loaded ? g.cumLoaded : g.cumEmpty;
  const total = cum[cum.length - 1] || 1;
  const target = Math.min(Math.max(frac, 0), 1) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const t0 = cum[i - 1];
  const t1 = cum[i];
  const k = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
  return g.s[i - 1] + (g.s[i] - g.s[i - 1]) * k;
}

const LOAD_STATES: TruckState[] = ['fila_carga', 'carregando'];
const DUMP_STATES: TruckState[] = ['fila_balanca', 'pesando', 'fila_descarga', 'descarregando'];

export interface TruckTotals {
  truck: number;
  circuit: number;
  /** minutos em cada classe de estado */
  min: Record<DotKind, number>;
  trips: number;
  tonnes: number;
  current: DotKind | null;
}

export interface CircuitTotals {
  circuit: number;
  trucks: number;
  trips: number;
  tonnes: number;
  /** ciclo médio das viagens concluídas (min) */
  cycleMin: number;
  /** fila média por viagem (min) */
  queueMin: number;
  loaderBusyMin: number;
  loaderRepairMin: number;
  loaderIdleMin: number;
}

export function makeAnimator(trace: TraceItem[], geometry: CircuitGeometry[], loaderTrace: { circuit: number; unit: number; t0: number; t1: number }[] = []) {
  const byTruck = indexTrace(trace);
  const cums = geometry.map((g) => cumulative(g.points));
  const end = trace.reduce((a, it) => Math.max(a, it.t1), 0);

  const dirAt = (ci: number, s: number, forward: boolean) => {
    const g = geometry[ci];
    const cum = cums[ci];
    const L = cum[cum.length - 1];
    const a = pointAt(g.points, cum, Math.max(0, Math.min(L, s - 3)));
    const b = pointAt(g.points, cum, Math.max(0, Math.min(L, s + 3)));
    const h = Math.atan2(b.y - a.y, b.x - a.x);
    return forward ? h : h + Math.PI;
  };

  function frame(t: number) {
    const dots: TruckDot[] = [];
    const queues = new Map<string, PointQueue>();
    const loadingNow = new Map<number, number>();
    const q = (circuit: number, where: 'carga' | 'descarga') => {
      const k = `${circuit}-${where}`;
      let v = queues.get(k);
      if (!v) queues.set(k, (v = { circuit, where, serving: 0, waiting: 0 }));
      return v;
    };
    for (const [truck, list] of byTruck) {
      const it = findAt(list, t);
      if (!it) continue;
      const g = geometry[it.circuit];
      if (!g) continue;
      const pts = g.points;
      const cum = cums[it.circuit];
      const L = cum[cum.length - 1];
      const frac = (t - it.t0) / Math.max(it.t1 - it.t0, 1e-6);
      let s: number;
      let forward = true;
      let loaded = false;
      if (it.state === 'carregado') {
        s = distanceAtFraction(g, frac, true);
        loaded = true;
      } else if (it.state === 'vazio') {
        s = L - distanceAtFraction(g, frac, false);
        forward = false;
      } else if (LOAD_STATES.includes(it.state)) {
        const qq = q(it.circuit, 'carga');
        const waiting = it.state === 'fila_carga';
        if (waiting) qq.waiting++;
        else {
          qq.serving++;
          loadingNow.set(it.circuit, (loadingNow.get(it.circuit) ?? 0) + 1);
        }
        // fila: caminhões enfileirados na via, de frente para a carga, a cada ~14 m
        s = waiting ? Math.min(L, 14 * qq.waiting) : 0;
        forward = false;
        loaded = it.state === 'carregando' && frac > 0.5;
      } else if (DUMP_STATES.includes(it.state)) {
        const qq = q(it.circuit, 'descarga');
        const waiting = it.state === 'fila_descarga' || it.state === 'fila_balanca';
        if (waiting) qq.waiting++;
        else qq.serving++;
        s = waiting ? Math.max(0, L - 14 * qq.waiting) : L;
        loaded = it.state !== 'descarregando' || frac < 0.5;
      } else if (it.state === 'interferencia') {
        // parado na via: no fim da ida (carregado) ou no começo da volta (vazio)
        const prev = list[list.indexOf(it) - 1];
        loaded = prev?.state === 'carregado';
        s = loaded ? L * 0.8 : L * 0.25;
        forward = loaded;
      } else {
        // manutenção, paradas programadas, fora do turno, perdas: estacionado no pátio perto da carga
        s = Math.min(L, 30 + (truck % 8) * 8);
      }
      const p = pointAt(pts, cum, s);
      dots.push({ truck, circuit: it.circuit, state: it.state, kind: kindOf(it.state), p, heading: dirAt(it.circuit, s, forward), loaded });
    }
    // equipamentos de carga: ao lado do ponto de carga, de frente para ele
    const loaders: LoaderDot[] = [];
    geometry.forEach((g, ci) => {
      const n = Math.max(1, g.loaders ?? 1);
      const p0 = g.points[0];
      const h = dirAt(ci, 0, true);
      const busy = loadingNow.get(ci) ?? 0;
      for (let u = 0; u < n; u++) {
        const side = 9 + u * 6;
        const p = { x: p0.x + Math.cos(h + Math.PI / 2) * side, y: p0.y + Math.sin(h + Math.PI / 2) * side, z: p0.z };
        const down = loaderTrace.some((x) => x.circuit === ci && x.unit === u && t >= x.t0 && t < x.t1);
        loaders.push({ circuit: ci, unit: u, p, heading: h - Math.PI / 2, state: down ? 'manutencao' : u < busy ? 'carregando' : 'parado' });
      }
    });
    return { dots, queues: [...queues.values()], loaders };
  }

  /** Totais acumulados entre `from` e `t` (min). */
  function totals(from: number, t: number) {
    const trucks: TruckTotals[] = [];
    for (const [truck, list] of byTruck) {
      const min = Object.fromEntries(DOT_KINDS.map((k) => [k.id, 0])) as Record<DotKind, number>;
      let trips = 0;
      let current: DotKind | null = null;
      const ci = list[0]?.circuit ?? 0;
      for (const it of list) {
        const a = Math.max(it.t0, from);
        const b = Math.min(it.t1, t);
        if (b > a) min[kindOf(it.state)] += b - a;
        if (it.state === 'descarregando' && it.t1 <= t && it.t1 > from) trips++;
        if (t >= it.t0 && t < it.t1) current = kindOf(it.state);
      }
      trucks.push({ truck, circuit: ci, min, trips, tonnes: trips * (geometry[ci]?.payloadT ?? 0), current });
    }
    trucks.sort((a, b) => a.truck - b.truck);
    const span = Math.max(0, t - from);
    const circuits: CircuitTotals[] = geometry.map((g, ci) => {
      const ts = trucks.filter((x) => x.circuit === ci);
      const trips = ts.reduce((a, x) => a + x.trips, 0);
      const working = ts.reduce((a, x) => a + x.min.carregado + x.min.vazio + x.min.fila + x.min.carregando + x.min.descarregando + x.min.interferencia, 0);
      const queue = ts.reduce((a, x) => a + x.min.fila, 0);
      const busy = ts.reduce((a, x) => a + x.min.carregando, 0);
      const repair = loaderTrace.filter((x) => x.circuit === ci).reduce((a, x) => a + Math.max(0, Math.min(x.t1, t) - Math.max(x.t0, from)), 0);
      const cap = span * Math.max(1, g.loaders ?? 1);
      return {
        circuit: ci,
        trucks: ts.length,
        trips,
        tonnes: trips * (g.payloadT ?? 0),
        cycleMin: trips ? working / trips : 0,
        queueMin: trips ? queue / trips : 0,
        loaderBusyMin: busy,
        loaderRepairMin: repair,
        loaderIdleMin: Math.max(0, cap - busy - repair),
      };
    });
    return { trucks, circuits, span };
  }

  return { frame, totals, end };
}
