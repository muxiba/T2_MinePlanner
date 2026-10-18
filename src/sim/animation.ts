/**
 * Posição dos caminhões ao longo do tempo, a partir do histórico (trace) da simulação.
 */
import { cumulative, pointAt } from './dxf';
import type { CircuitGeometry } from './des';
import type { TraceItem, TruckState, Vec3 } from './types';

export type DotKind = 'carregado' | 'vazio' | 'ponto' | 'parado';

export interface TruckDot {
  truck: number;
  circuit: number;
  state: TruckState;
  kind: DotKind;
  p: Vec3;
}

export interface PointQueue {
  circuit: number;
  where: 'carga' | 'descarga';
  serving: number;
  waiting: number;
}

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

export function makeAnimator(trace: TraceItem[], geometry: CircuitGeometry[]) {
  const byTruck = indexTrace(trace);
  const cums = geometry.map((g) => cumulative(g.points));
  const end = trace.reduce((a, it) => Math.max(a, it.t1), 0);

  function frame(t: number) {
    const dots: TruckDot[] = [];
    const queues = new Map<string, PointQueue>();
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
      let p: Vec3;
      let kind: DotKind;
      if (it.state === 'carregado') {
        p = pointAt(pts, cum, distanceAtFraction(g, frac, true));
        kind = 'carregado';
      } else if (it.state === 'vazio') {
        p = pointAt(pts, cum, L - distanceAtFraction(g, frac, false));
        kind = 'vazio';
      } else if (LOAD_STATES.includes(it.state)) {
        const qq = q(it.circuit, 'carga');
        const waiting = it.state === 'fila_carga';
        if (waiting) qq.waiting++;
        else qq.serving++;
        // fila: caminhões enfileirados para trás na via, a cada ~12 m
        p = pointAt(pts, cum, waiting ? Math.min(L, 12 * qq.waiting) : 0);
        kind = 'ponto';
      } else if (DUMP_STATES.includes(it.state)) {
        const qq = q(it.circuit, 'descarga');
        const waiting = it.state === 'fila_descarga' || it.state === 'fila_balanca';
        if (waiting) qq.waiting++;
        else qq.serving++;
        p = pointAt(pts, cum, waiting ? Math.max(0, L - 12 * qq.waiting) : L);
        kind = 'ponto';
      } else {
        // manutenção, fora do turno, perdas: estacionado perto da carga
        p = pointAt(pts, cum, Math.min(L, 25 + (truck % 6) * 6));
        kind = 'parado';
      }
      dots.push({ truck, circuit: it.circuit, state: it.state, kind, p });
    }
    return { dots, queues: [...queues.values()] };
  }

  return { frame, end };
}
