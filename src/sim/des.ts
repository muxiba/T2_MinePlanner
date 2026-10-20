/**
 * Simulador de eventos discretos do transporte (mina → descarga).
 *
 * Cada caminhão é um agente que percorre o ciclo:
 *   fila na carga → carregando → viagem carregado (trecho a trecho, velocidade por rampa)
 *   → [fila na balança → pesagem] → fila na descarga (posto livre + espaço no pulmão)
 *   → manobra e descarga → retorno vazio → perdas operacionais → próximo ciclo.
 * Quebras: cada caminhão e cada posto de carga falham após um tempo de operação
 * exponencial (MTBF derivado da disponibilidade física) e ficam em reparo (MTTR).
 * O recebimento é um pulmão (t) esvaziado pela empilhadeira (t/h), que alimenta
 * o estoque da fábrica, consumido a uma taxa constante.
 */
import { routeProfile } from './dxf';
import type {
  AggregateStats,
  Circuit,
  GradeSpeed,
  Receiving,
  RunStats,
  Scenario,
  SimModel,
  SpeedTable,
  Summary,
  TraceItem,
  TruckConfig,
  TruckState,
} from './types';

/* ------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* ------------------------------------------------------------------------- */

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Amostra lognormal com média `mean` e coeficiente de variação `cv`. */
function lognormal(r: () => number, mean: number, cv: number) {
  if (cv <= 0 || mean <= 0) return mean;
  const s2 = Math.log(1 + cv * cv);
  const mu = Math.log(mean) - s2 / 2;
  // Box–Muller
  const u = Math.max(r(), 1e-12);
  const v = r();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.exp(mu + Math.sqrt(s2) * z);
}

const exp = (r: () => number, mean: number) => (Number.isFinite(mean) ? -mean * Math.log(Math.max(r(), 1e-12)) : Infinity);

export function speedFor(table: GradeSpeed[], effGrade: number, limit: number) {
  const sorted = [...table].sort((a, b) => a.maxGrade - b.maxGrade);
  const row = sorted.find((r) => effGrade <= r.maxGrade) ?? sorted[sorted.length - 1];
  return Math.max(1, Math.min(row?.kmh ?? limit, limit));
}

/** Tempo de viagem (min) carregado e vazio para um perfil, e o perfil acumulado (para animação). */
/** Limites de velocidade (km/h) carregado e vazio: os da configuração, se houver, senão os gerais do modelo. */
export function limitsOf(model: Pick<SimModel, 'speedLimitKmh' | 'speedLimitLoadedKmh' | 'speedLimitEmptyKmh'>, cfg?: Pick<TruckConfig, 'speedLimitLoadedKmh' | 'speedLimitEmptyKmh'>) {
  return {
    loaded: cfg?.speedLimitLoadedKmh || model.speedLimitLoadedKmh || model.speedLimitKmh || 40,
    empty: cfg?.speedLimitEmptyKmh || model.speedLimitEmptyKmh || model.speedLimitKmh || 40,
  };
}

export function travelTimes(points: { x: number; y: number; z: number }[], speed: SpeedTable, limitIn: number | { loaded: number; empty: number }, rr: number) {
  const limit = typeof limitIn === 'number' ? { loaded: limitIn, empty: limitIn } : limitIn;
  const segs = routeProfile(points, 20);
  let loaded = 0;
  let empty = 0;
  const cumLoaded: number[] = [0];
  const cumEmpty: number[] = [0];
  const s: number[] = [0];
  for (const g of segs) {
    const vl = speedFor(speed.loaded, g.grade + rr, limit.loaded) / 0.06; // km/h → m/min
    const ve = speedFor(speed.empty, -g.grade + rr, limit.empty) / 0.06;
    loaded += g.len / vl;
    empty += g.len / ve;
    cumLoaded.push(loaded);
    cumEmpty.push(empty);
    s.push(g.s0 + g.h);
  }
  return { loaded, empty, segs, cumLoaded, cumEmpty, s };
}

/** Disponibilidade física → tempo médio entre falhas (min de operação). */
const mtbf = (dfPct: number, mttrMin: number) => (dfPct >= 99.9 ? Infinity : (mttrMin * (dfPct / 100)) / (1 - dfPct / 100));

class Heap {
  private a: { t: number; s: number; f: () => void }[] = [];
  private seq = 0;
  get size() {
    return this.a.length;
  }
  push(t: number, f: () => void) {
    const n = { t, s: this.seq++, f };
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].t < n.t || (a[p].t === n.t && a[p].s < n.s)) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = n;
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const lt = (x: number, y: { t: number; s: number }) => a[x].t < y.t || (a[x].t === y.t && a[x].s < y.s);
        let best = last;
        if (l < a.length && lt(l, best)) {
          m = l;
          best = a[l];
        }
        if (r < a.length && lt(r, best)) {
          m = r;
          best = a[r];
        }
        if (m === i) break;
        a[i] = a[m];
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

/** Recurso com `cap` atendimentos simultâneos e fila FIFO. */
class Server {
  busy = 0;
  busyTime = 0;
  private last = 0;
  queue: (() => void)[] = [];
  constructor(public cap: number) {}
  private acc(t: number) {
    this.busyTime += this.busy * (t - this.last);
    this.last = t;
  }
  request(t: number, start: () => void) {
    this.acc(t);
    if (this.busy < this.cap) {
      this.busy++;
      start();
    } else this.queue.push(start);
  }
  release(t: number) {
    this.acc(t);
    const next = this.queue.shift();
    if (next) next();
    else this.busy--;
  }
  /** ocupa um atendimento sem atender ninguém (ex.: equipamento quebrado) */
  close(t: number) {
    this.acc(t);
    this.busy++;
  }
  finish(t: number) {
    this.acc(t);
  }
}

/** Pulmão + empilhadeira + estoque da fábrica, com fluxo contínuo entre eventos. */
class Receiver {
  level = 0;
  plantStock: number;
  last = 0;
  stackerBusy = 0;
  stockout = 0;
  levelIntegral = 0;
  levelMax = 0;
  plantMin: number;
  readonly rate: number; // t/min
  readonly plantRate: number;
  constructor(public cfg: Receiving, receivingFactor: number, public warmup: number) {
    this.rate = ((cfg.stackerTph || 0) * receivingFactor * (cfg.stackerDf ?? 100)) / 100 / 60;
    this.plantRate = (cfg.plantTph || 0) / 60;
    this.plantStock = cfg.plantStockInitialT || 0;
    this.plantMin = this.plantStock;
  }
  get limited() {
    return this.rate > 0;
  }
  advance(t: number) {
    let dt = t - this.last;
    let now = this.last;
    let guard = 0;
    while (dt > 1e-9 && guard++ < 100) {
      let r = this.level > 1e-9 ? this.rate : 0;
      const plant = this.plantRate > 0;
      const smax = this.cfg.plantStockMaxT || Infinity;
      if (plant && this.plantStock >= smax - 1e-9) r = Math.min(r, this.plantRate);
      const net = plant ? r - this.plantRate : 0;
      let step = dt;
      if (r > 0) step = Math.min(step, this.level / r);
      if (plant && net > 0 && Number.isFinite(smax)) step = Math.min(step, (smax - this.plantStock) / net);
      if (plant && net < 0 && this.plantStock > 1e-9) step = Math.min(step, this.plantStock / -net);
      step = Math.max(step, 1e-9);
      const measured = Math.max(0, Math.min(now + step, Infinity) - Math.max(now, this.warmup));
      this.levelIntegral += this.level * measured;
      if (r > 0) this.stackerBusy += measured;
      if (plant && this.plantStock <= 1e-9 && r < this.plantRate) this.stockout += measured;
      this.level = Math.max(0, this.level - r * step);
      if (plant) this.plantStock = Math.min(smax, Math.max(0, this.plantStock + net * step));
      if (this.plantStock < this.plantMin && now + step > this.warmup) this.plantMin = this.plantStock;
      now += step;
      dt -= step;
    }
    this.last = t;
  }
  capacityFor(payload: number) {
    return this.cfg.bufferT > 0 ? this.cfg.bufferT : payload;
  }
  /** min até caber `payload` (estimativa, sem novas descargas) */
  waitFor(payload: number) {
    const excess = this.level + payload - this.capacityFor(payload);
    if (excess <= 0) return 0;
    return this.rate > 0 ? excess / this.rate + 0.01 : 5;
  }
  add(payload: number) {
    this.level += payload;
    if (this.level > this.levelMax) this.levelMax = this.level;
  }
}

/* ------------------------------------------------------------------------- */
/* Simulação                                                                  */
/* ------------------------------------------------------------------------- */

export interface RunOptions {
  scenario: Scenario;
  config: TruckConfig;
  /** caminhões por circuito (sobrescreve circuit.trucks) */
  trucks?: Record<string, number>;
  seed?: number;
  /** grava o histórico para animação até esta hora */
  traceHours?: number;
}

export interface CircuitGeometry {
  circuitId: string;
  points: { x: number; y: number; z: number }[];
  /** carga por viagem (t) */
  payloadT?: number;
  /** equipamentos de carga no ponto de carga */
  loaders?: number;
  loadedMin: number;
  emptyMin: number;
  s: number[];
  cumLoaded: number[];
  cumEmpty: number[];
}

export interface RunResult {
  stats: RunStats;
  trace: TraceItem[];
  geometry: CircuitGeometry[];
  /** paradas para reparo dos equipamentos de carga (min), dentro da janela do trace */
  loaderTrace?: { circuit: number; unit: number; t0: number; t1: number }[];
}

export function payloadFor(cfg: TruckConfig, c: Circuit) {
  return cfg.volumeM3 && cfg.volumeM3 > 0 && c.density > 0 ? Math.min(cfg.payloadT, cfg.volumeM3 * c.density) : cfg.payloadT;
}

/** Tempo médio de carga (min): por passes da caçamba, se informada, ou pela taxa efetiva do equipamento. */
export function loadTime(cfg: TruckConfig, c: Circuit) {
  const payload = payloadFor(cfg, c);
  if (c.bucketT && c.bucketT > 0 && c.passMin && c.passMin > 0) return Math.max(0.1, c.loadSpotMin + Math.ceil(payload / c.bucketT - 1e-9) * c.passMin);
  return Math.max(0.1, c.loadSpotMin + (payload / Math.max(c.loaderTph, 1)) * 60);
}

/** Configuração usada pelo circuito: a fixa do circuito (ex.: rodoviário) ou a comparada. */
export function configFor(model: Pick<SimModel, 'configs'>, c: Pick<Circuit, 'configId'>, compared: TruckConfig) {
  return (c.configId && model.configs.find((x) => x.id === c.configId)) || compared;
}

export function simulate(model: SimModel, opt: RunOptions): RunResult {
  const sc = opt.scenario;
  const r = rng(opt.seed ?? 1);
  const cv = Math.max(0, sc.cv);
  const T = Math.max(1, sc.days) * 1440;
  const warm = Math.min(Math.max(0, model.warmupH) * 60, T / 2);
  const measured = T - warm;
  const shiftMin = Math.min(24, Math.max(0.5, sc.hoursPerDay)) * 60;
  const traceEnd = (opt.traceHours ?? 0) * 60;
  const trace: TraceItem[] = [];
  const loaderTrace: { circuit: number; unit: number; t0: number; t1: number }[] = [];
  const heap = new Heap();

  const routes = new Map(model.routes.map((x) => [x.id, x]));
  const circuits = model.circuits.filter((c) => routes.has(c.routeId));
  const geometry: CircuitGeometry[] = [];
  const receivers = new Map<string, Receiver>();
  const dumps = new Map<string, Server>();
  for (const c of circuits) {
    if (!receivers.has(c.destination)) {
      const rc = model.receiving.find((x) => x.destination === c.destination) ?? {
        destination: c.destination,
        bufferT: 0,
        stackerTph: 0,
        stackerDf: 100,
        plantTph: 0,
        plantStockInitialT: 0,
        plantStockMaxT: 0,
      };
      receivers.set(c.destination, new Receiver(rc, sc.receivingFactor || 1, warm));
      dumps.set(c.destination, new Server(Math.max(1, c.dumpStations)));
    }
  }

  const truckMttr = Math.max(0.1, model.truckMttrH) * 60;
  const truckMtbf = mtbf(sc.truckDf, truckMttr);
  const eff = Math.min(Math.max(sc.efficiency, 10), 100) / 100;
  const stops = sc.stops && sc.stops.shifts > 0 ? sc.stops : null;
  const nShifts = stops ? Math.max(1, Math.round(stops.shifts)) : 1;
  const shiftLen = shiftMin / nShifts;
  /** paradas programadas de um caminhão com horário em (a, b]: troca de turno, refeição e abastecimento */
  const stopsBetween = (truckId: number, a: number, b: number) => {
    const out: { t: number; dur: number; state: TruckState }[] = [];
    if (!stops) return out;
    for (let d = Math.floor(Math.max(0, a) / 1440); d <= Math.floor(b / 1440); d++) {
      const day = d * 1440;
      for (let s = 0; s < nShifts; s++) {
        const start = day + s * shiftLen;
        // troca de turno no início de cada turno (no início do dia só quando a operação é 24 h)
        if (stops.shiftChangeMin > 0 && (s > 0 || shiftMin >= 1440)) out.push({ t: start, dur: stops.shiftChangeMin, state: 'troca_turno' });
        // refeição no meio do turno, em revezamento (defasada entre caminhões)
        if (stops.mealMin > 0) out.push({ t: start + shiftLen / 2 + ((truckId % 4) - 1.5) * 15, dur: stops.mealMin, state: 'refeicao' });
      }
      if (stops.fuelMin > 0) out.push({ t: day + shiftLen * 0.3 + (truckId % 10) * 12, dur: stops.fuelMin, state: 'abastecimento' });
    }
    return out.filter((x) => x.t > a && x.t <= b).sort((x, y) => x.t - y.t);
  };
  const interf = stops && stops.interferenceMin > 0 ? stops.interferenceMin / 2 : 0;

  type Truck = {
    id: number;
    ci: number;
    state: TruckState;
    since: number;
    opMin: number;
    nextFail: number;
    /** paradas programadas já consideradas até este instante */
    stopUntil?: number;
    cycleStart: number;
  };
  const stateTime: Partial<Record<TruckState, number>> = {};
  let tonnes = 0;
  let trips = 0;
  const perC = circuits.map((c) => ({ name: c.name, tonnes: 0, trips: 0 }));
  let workedMin = 0;
  let truckCount = 0;

  const workedByC = circuits.map(() => 0);
  const trucksByC = circuits.map(() => 0);
  const ctx = circuits.map((c, ci) => {
    const cfg = configFor(model, c, opt.config);
    const route = routes.get(c.routeId)!;
    const tt = travelTimes(route.points, cfg.speed, limitsOf(model, cfg), cfg.rollingResistance ?? model.rollingResistance);
    geometry.push({
      circuitId: c.id,
      points: route.points,
      payloadT: payloadFor(cfg, c),
      loaders: Math.max(1, c.loaders),
      loadedMin: tt.loaded,
      emptyMin: tt.empty,
      s: tt.s,
      cumLoaded: tt.cumLoaded,
      cumEmpty: tt.cumEmpty,
    });
    const loaderMttr = 120;
    const loader = new Server(Math.max(1, c.loaders));
    const loaderFailMean = mtbf(c.loaderDf, loaderMttr);
    // relógio de falha de cada posto de carga (min de operação até falhar)
    const loaderClock = Array.from({ length: Math.max(1, c.loaders) }, () => exp(r, loaderFailMean));
    return {
      c,
      ci,
      tt: { loaded: tt.loaded * (sc.travelFactor || 1), empty: tt.empty * (sc.travelFactor || 1) },
      loader,
      loaderMttr,
      loaderFailMean,
      loaderClock,
      loaderNext: 0,
      weigh: c.weighing ? new Server(1) : null,
      dump: dumps.get(c.destination)!,
      recv: receivers.get(c.destination)!,
      payload: payloadFor(cfg, c),
      loadMean: loadTime(cfg, c),
      cfg,
    };
  });

  const setState = (k: Truck, s: TruckState, t: number) => {
    const a = Math.max(k.since, warm);
    const b = Math.min(t, T);
    if (b > a) stateTime[k.state] = (stateTime[k.state] ?? 0) + (b - a);
    if (traceEnd > 0 && k.since < traceEnd && t > k.since) {
      trace.push({ truck: k.id, circuit: k.ci, state: k.state, t0: k.since, t1: Math.min(t, traceEnd) });
    }
    if (k.state !== 'manutencao' && k.state !== 'fora_turno' && k.state !== 'troca_turno' && k.state !== 'refeicao' && b > a) {
      workedMin += b - a;
      workedByC[k.ci] += b - a;
    }
    k.state = s;
    k.since = t;
  };

  const inShift = (t: number) => t % 1440 < shiftMin;
  const nextShiftStart = (t: number) => Math.floor(t / 1440) * 1440 + 1440;

  const startCycle = (k: Truck, t: number) => {
    if (t >= T) return;
    // quebra?
    if (k.opMin >= k.nextFail) {
      setState(k, 'manutencao', t);
      const rep = exp(r, truckMttr);
      k.opMin = 0;
      k.nextFail = exp(r, truckMtbf);
      heap.push(t + rep, () => startCycle(k, t + rep));
      return;
    }
    if (!inShift(t)) {
      setState(k, 'fora_turno', t);
      const s = nextShiftStart(t);
      heap.push(s, () => startCycle(k, s));
      return;
    }
    // parada programada vencida (troca de turno, refeição, abastecimento)? faz antes do próximo ciclo
    if (stops) {
      const due = stopsBetween(k.id, k.stopUntil ?? -1, t).filter((x) => x.t > t - 180);
      if (due.length) {
        const st = due[0];
        k.stopUntil = st.t;
        setState(k, st.state, t);
        heap.push(t + st.dur, () => startCycle(k, t + st.dur));
        return;
      }
      k.stopUntil = t;
    }
    const x = ctx[k.ci];
    k.cycleStart = t;
    setState(k, 'fila_carga', t);
    x.loader.request(t, () => beginLoad(k, now));
  };

  let now = 0;

  const beginLoad = (k: Truck, t: number) => {
    const x = ctx[k.ci];
    // posto de carga quebrado? (relógio do posto que vai atender)
    const unit = x.loaderNext % x.loaderClock.length;
    x.loaderNext++;
    if (x.loaderClock[unit] <= 0) {
      const rep = exp(r, x.loaderMttr);
      x.loaderClock[unit] = exp(r, x.loaderFailMean);
      if (traceEnd > 0 && t < traceEnd) loaderTrace.push({ circuit: k.ci, unit, t0: t, t1: Math.min(t + rep, traceEnd) });
      // o caminhão espera o reparo ocupando o posto
      heap.push(t + rep, () => beginLoad2(k, t + rep, unit));
      return;
    }
    beginLoad2(k, t, unit);
  };

  const beginLoad2 = (k: Truck, t: number, unit: number) => {
    const x = ctx[k.ci];
    setState(k, 'carregando', t);
    const d = lognormal(r, x.loadMean, cv);
    x.loaderClock[unit] -= d;
    heap.push(t + d, () => {
      x.loader.release(t + d);
      setState(k, 'carregado', t + d);
      const tr = lognormal(r, x.tt.loaded, cv * 0.5);
      const ta = t + d + tr;
      // interferências na via (cruzamentos, equipamentos de apoio, tráfego): espera no trajeto
      const w = interf ? exp(r, interf) : 0;
      if (w > 0.05) {
        heap.push(ta, () => {
          setState(k, 'interferencia', ta);
          heap.push(ta + w, () => {
            setState(k, 'carregado', ta + w);
            afterHaul(k, ta + w);
          });
        });
      } else heap.push(ta, () => afterHaul(k, ta));
    });
  };

  const afterHaul = (k: Truck, t: number) => {
    const x = ctx[k.ci];
    if (x.weigh) {
      setState(k, 'fila_balanca', t);
      x.weigh.request(t, () => {
        setState(k, 'pesando', now);
        const d = lognormal(r, x.c.weighMin, cv);
        const t1 = now + d;
        heap.push(t1, () => {
          x.weigh!.release(t1);
          toDump(k, t1);
        });
      });
    } else toDump(k, t);
  };

  const toDump = (k: Truck, t: number) => {
    const x = ctx[k.ci];
    setState(k, 'fila_descarga', t);
    x.dump.request(t, () => tryDump(k, now));
  };

  const tryDump = (k: Truck, t: number) => {
    const x = ctx[k.ci];
    if (x.recv.limited) {
      x.recv.advance(t);
      const w = x.recv.waitFor(x.payload);
      if (w > 0) {
        // ocupa o posto esperando espaço no pulmão
        heap.push(t + w, () => tryDump(k, t + w));
        return;
      }
      x.recv.add(x.payload);
    }
    setState(k, 'descarregando', t);
    const d = lognormal(r, x.cfg.maneuverMin + x.cfg.dumpMin, cv);
    const t1 = t + d;
    heap.push(t1, () => {
      x.dump.release(t1);
      if (t1 > warm && t1 <= T) {
        tonnes += x.payload;
        trips++;
        perC[k.ci].tonnes += x.payload;
        perC[k.ci].trips++;
      }
      setState(k, 'vazio', t1);
      const tr = lognormal(r, x.tt.empty, cv * 0.5);
      const t2 = t1 + tr;
      const wE = interf ? exp(r, interf) : 0;
      const endEmpty = (t2: number) => {
        const productive = t2 - k.cycleStart;
        k.opMin += productive;
        const loss = (productive * (1 - eff)) / eff;
        if (loss > 0.01) {
          setState(k, 'perdas', t2);
          heap.push(t2 + loss, () => startCycle(k, t2 + loss));
        } else startCycle(k, t2);
      };
      if (wE > 0.05) {
        heap.push(t2, () => {
          setState(k, 'interferencia', t2);
          heap.push(t2 + wE, () => endEmpty(t2 + wE));
        });
      } else heap.push(t2, () => endEmpty(t2));
    });
  };

  // frota: caminhões entram defasados para não chegarem juntos na carga
  const trucks: Truck[] = [];
  let id = 0;
  for (const x of ctx) {
    const n = Math.max(0, Math.round(opt.trucks?.[x.c.id] ?? x.c.trucks));
    for (let i = 0; i < n; i++) {
      const k: Truck = { id: id++, ci: x.ci, state: 'fora_turno', since: 0, opMin: 0, nextFail: exp(r, truckMtbf), cycleStart: 0 };
      truckCount++;
      trucksByC[x.ci]++;
      const t0 = i * (x.loadMean / Math.max(1, x.c.loaders));
      heap.push(t0, () => startCycle(k, t0));
      trucks.push(k);
    }
  }

  while (heap.size) {
    const e = heap.pop();
    if (e.t > T) break;
    now = e.t;
    e.f();
  }
  // fecha os estados no fim
  for (const k of trucks) setState(k, k.state, T);
  for (const rcv of receivers.values()) rcv.advance(T);
  for (const x of ctx) x.loader.finish(T);
  for (const d of dumps.values()) d.finish(T);

  const hours = measured / 60;
  const cycleStates: TruckState[] = ['fila_carga', 'carregando', 'carregado', 'fila_balanca', 'pesando', 'fila_descarga', 'descarregando', 'vazio'];
  const cycle: Partial<Record<TruckState, number>> = {};
  for (const s of cycleStates) if (stateTime[s]) cycle[s] = (stateTime[s] ?? 0) / Math.max(trips, 1);
  const totalState = Object.values(stateTime).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const stateShare: Partial<Record<TruckState, number>> = {};
  for (const [s, v] of Object.entries(stateTime)) stateShare[s as TruckState] = (v ?? 0) / totalState;

  const loaderCap = ctx.reduce((a, x) => a + x.loader.cap, 0) * T;
  const dumpCap = [...dumps.values()].reduce((a, d) => a + d.cap, 0) * T;
  const recvs = [...receivers.values()];
  const limitedRecv = recvs.filter((x) => x.limited);
  const costTotal = ctx.reduce((a, x) => a + trucksByC[x.ci] * x.cfg.costFixedPerH * (measured / 60) + (workedByC[x.ci] / 60) * x.cfg.costVarPerH, 0);

  const stats: RunStats = {
    tonnes,
    trips,
    hours,
    tph: tonnes / hours,
    tpd: (tonnes / hours) * 24,
    cycle,
    cycleMin: Object.values(cycle).reduce((a, b) => a + (b ?? 0), 0),
    stateShare,
    loaderUtil: loaderCap > 0 ? ctx.reduce((a, x) => a + x.loader.busyTime, 0) / loaderCap : 0,
    dumpUtil: dumpCap > 0 ? [...dumps.values()].reduce((a, d) => a + d.busyTime, 0) / dumpCap : 0,
    stackerUtil: limitedRecv.length ? limitedRecv.reduce((a, x) => a + x.stackerBusy, 0) / (limitedRecv.length * measured) : 0,
    queueLoadMin: (stateTime.fila_carga ?? 0) / Math.max(trips, 1),
    queueDumpMin: (stateTime.fila_descarga ?? 0) / Math.max(trips, 1),
    bufferAvgT: recvs.reduce((a, x) => a + x.levelIntegral, 0) / Math.max(measured, 1),
    bufferMaxT: Math.max(0, ...recvs.map((x) => x.levelMax)),
    plantStockoutH: recvs.reduce((a, x) => a + x.stockout, 0) / 60,
    plantStockMinT: Math.min(...recvs.map((x) => x.plantMin)),
    costPerT: tonnes > 0 ? costTotal / tonnes : 0,
    perCircuit: perC.map((p) => ({ ...p, tph: p.tonnes / hours })),
  };
  return { stats, trace, geometry, loaderTrace };
}

/* ------------------------------------------------------------------------- */
/* Réplicas, matriz de cenários e busca da frota                              */
/* ------------------------------------------------------------------------- */

const T975 = [12.71, 4.3, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.2, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.1, 2.09, 2.09];

export function summarize(values: number[]): Summary {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(n, 1);
  if (n < 2) return { mean, lo: mean, hi: mean };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const h = (T975[Math.min(n - 2, T975.length - 1)] * sd) / Math.sqrt(n);
  return { mean, lo: mean - h, hi: mean + h };
}

export function aggregate(runs: RunStats[]): AggregateStats {
  const pick = (f: (s: RunStats) => number) => summarize(runs.map(f));
  const avgRec = (f: (s: RunStats) => Partial<Record<TruckState, number>>) => {
    const out: Partial<Record<TruckState, number>> = {};
    for (const s of runs) for (const [k, v] of Object.entries(f(s))) out[k as TruckState] = (out[k as TruckState] ?? 0) + (v ?? 0) / runs.length;
    return out;
  };
  return {
    reps: runs.length,
    tph: pick((s) => s.tph),
    tpd: pick((s) => s.tpd),
    cycleMin: pick((s) => s.cycleMin),
    queueLoadMin: pick((s) => s.queueLoadMin),
    queueDumpMin: pick((s) => s.queueDumpMin),
    loaderUtil: pick((s) => s.loaderUtil),
    dumpUtil: pick((s) => s.dumpUtil),
    stackerUtil: pick((s) => s.stackerUtil),
    plantStockoutH: pick((s) => s.plantStockoutH),
    costPerT: pick((s) => s.costPerT),
    cycle: avgRec((s) => s.cycle),
    stateShare: avgRec((s) => s.stateShare),
    bufferMaxT: Math.max(...runs.map((s) => s.bufferMaxT)),
    perCircuit:
      runs[0]?.perCircuit.map((p, i) => ({
        name: p.name,
        tph: runs.reduce((a, s) => a + s.perCircuit[i].tph, 0) / runs.length,
        tpd: summarize(runs.map((s) => s.perCircuit[i].tph * 24)),
      })) ?? [],
  };
}

export function replicate(model: SimModel, opt: Omit<RunOptions, 'seed'>, reps = model.replications): AggregateStats {
  const runs: RunStats[] = [];
  for (let i = 0; i < Math.max(1, reps); i++) runs.push(simulate(model, { ...opt, seed: 1000 + i * 7919, traceHours: 0 }).stats);
  return aggregate(runs);
}

export interface SweepPoint {
  trucks: number;
  stats: AggregateStats;
  /** produção avaliada (t/dia): do sistema, se houver 1 circuito, ou do circuito variado */
  value?: Summary;
}

/**
 * Varia a frota de um circuito (os demais fixos) até a produção estabilizar.
 * Retorna a curva produção × nº de caminhões e a frota mínima que atinge a meta.
 */
export function fleetSweep(
  model: SimModel,
  opt: Omit<RunOptions, 'seed' | 'trucks'>,
  circuitId: string,
  maxTrucks = 30,
  reps = Math.min(model.replications, 5),
  onStep?: (p: SweepPoint) => void,
) {
  const base = Object.fromEntries(model.circuits.map((c) => [c.id, c.trucks]));
  const ci = Math.max(0, model.circuits.filter((c) => model.routes.some((r) => r.id === c.routeId)).findIndex((c) => c.id === circuitId));
  const single = model.circuits.length === 1;
  const value = (s: AggregateStats) => (single ? s.tpd : s.perCircuit[ci]?.tpd ?? s.tpd);
  const points: SweepPoint[] = [];
  let minFleet: number | null = null;
  let flat = 0;
  for (let n = 1; n <= maxTrucks; n++) {
    const stats = replicate(model, { ...opt, trucks: { ...base, [circuitId]: n } }, reps);
    const p = { trucks: n, stats };
    points.push(p);
    onStep?.(p);
    if (single && minFleet === null && model.targetTpd > 0 && value(stats).mean >= model.targetTpd) minFleet = n;
    const prev = points[points.length - 2];
    if (prev && value(stats).mean < value(prev.stats).mean * 1.01) flat++;
    else flat = 0;
    if (flat >= 2 && (minFleet !== null || model.targetTpd <= 0 || !single)) break;
    if (flat >= 3) break;
  }
  // ponto de saturação: depois dele, cada caminhão a mais rende < 3% da produção
  let saturation = points[points.length - 1]?.trucks ?? 0;
  for (let i = 1; i < points.length; i++) {
    const gain = value(points[i].stats).mean - value(points[i - 1].stats).mean;
    if (gain < 0.03 * value(points[i - 1].stats).mean) {
      saturation = points[i - 1].trucks;
      break;
    }
  }
  return {
    points: points.map((p) => ({ ...p, value: value(p.stats) })),
    minFleet,
    saturation,
    scope: single ? ('sistema' as const) : ('circuito' as const),
  };
}
