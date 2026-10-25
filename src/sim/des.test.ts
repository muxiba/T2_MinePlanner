import { describe, expect, it } from 'vitest';
import { limitsOf, payloadFor, replicate, simulate, speedFor, summarize, travelTimes } from './des';
import { CONFIG_PRESETS, emptyModel, defaultCircuit } from './defaults';
import { parseDxfText, routeProfile, simplify } from './dxf';
import type { SimModel, Vec3 } from './types';

/** Rota sintética: 1 km plano + 500 m subindo 10%. */
const pts: Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 1000, y: 0, z: 0 },
  { x: 1500, y: 0, z: 50 },
];

function model(trucks: number): SimModel {
  const m = emptyModel();
  m.routes = [{ id: 'r', name: 'Teste', points: pts }];
  m.circuits = [{ ...defaultCircuit(m.routes[0], 0), trucks, weighing: false }];
  m.receiving = [{ destination: 'Destino 1', bufferT: 200, stackerTph: 0, stackerDf: 100, plantTph: 0, plantStockInitialT: 0, plantStockMaxT: 0 }];
  m.replications = 4;
  return m;
}

describe('DXF', () => {
  it('lê POLYLINE 3D, LWPOLYLINE com elevação, POINT e 3DFACE', () => {
    const dxf = [
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'POLYLINE', '8', 'eixo', '70', '8',
      '0', 'VERTEX', '10', '0', '20', '0', '30', '100',
      '0', 'VERTEX', '10', '100', '20', '0', '30', '110',
      '0', 'SEQEND',
      '0', 'LWPOLYLINE', '8', 'curva', '38', '1050', '90', '2', '10', '0', '20', '0', '10', '5', '20', '5',
      '0', 'POINT', '10', '1', '20', '2', '30', '3',
      '0', '3DFACE', '10', '0', '20', '0', '30', '1', '11', '1', '21', '0', '31', '2', '12', '0', '22', '1', '32', '3', '13', '0', '23', '1', '33', '3',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n');
    const lines: Vec3[][] = [];
    let faces = 0;
    let points = 0;
    parseDxfText(dxf, { polyline: (p) => lines.push(p), face: () => faces++, point: () => points++ });
    expect(lines.length).toBe(2);
    expect(lines[0][1].z).toBe(110);
    expect(lines[1][0].z).toBe(1050);
    expect(faces).toBe(1);
    expect(points).toBe(1);
  });

  it('perfil: rampa por trecho e simplificação preservam a geometria', () => {
    const prof = routeProfile(pts, 20);
    expect(prof[1].grade).toBeCloseTo(10, 6);
    expect(simplify([{ x: 0, y: 0, z: 0 }, { x: 5, y: 0.01, z: 0 }, { x: 10, y: 0, z: 0 }], 0.5).length).toBe(2);
  });
});

describe('velocidade e tempo de viagem', () => {
  it('subida carregado é mais lenta que descida vazio', () => {
    const m = model(1);
    const tt = travelTimes(pts, m.configs[0].speed, m.speedLimitKmh, m.rollingResistance);
    expect(tt.loaded).toBeGreaterThan(tt.empty);
    expect(speedFor(m.configs[0].speed.loaded, 12, 40)).toBeLessThan(speedFor(m.configs[0].speed.loaded, 0, 40));
    expect(speedFor(m.configs[0].speed.loaded, 0, 20)).toBe(20); // limite da via
  });
  it('rodoviário usa o próprio limite de velocidade e é mais rápido em estrada plana', () => {
    const m = model(1);
    const road: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 20000, y: 0, z: 0 }];
    const mina = { ...CONFIG_PRESETS.find((x) => x.id === 'mina-8x4')!.make(), id: 'M', costFixedPerH: 0, costVarPerH: 0 };
    const rod = { ...CONFIG_PRESETS.find((x) => x.id === 'rod-carreta')!.make(), id: 'R', costFixedPerH: 0, costVarPerH: 0 };
    expect(limitsOf(m, rod).loaded).toBe(60);
    expect(limitsOf(m, rod).empty).toBe(80);
    const a = travelTimes(road, mina.speed, limitsOf(m, mina), m.rollingResistance);
    const b = travelTimes(road, rod.speed, limitsOf(m, rod), rod.rollingResistance ?? m.rollingResistance);
    expect(b.loaded).toBeLessThan(a.loaded);
    expect(b.loaded).toBeCloseTo(20, 0); // 20 km a 60 km/h ≈ 20 min
    expect(b.empty).toBeCloseTo(15, 0); // 20 km a 80 km/h ≈ 15 min
  });
  it('circuito com caminhão fixo usa a própria configuração, qualquer que seja a comparada', () => {
    const m = model(2);
    const rod = { ...CONFIG_PRESETS.find((x) => x.id === 'rod-rodotrem')!.make(), id: 'R', costFixedPerH: 100, costVarPerH: 200 };
    m.configs = [...m.configs, rod];
    m.circuits = [{ ...m.circuits[0], configId: 'R', density: 0 }];
    const out = simulate(m, { config: m.configs[0], scenario: { ...m.scenarios[0], days: 2 }, trucks: { [m.circuits[0].id]: 2 } });
    expect(out.geometry[0].payloadT).toBe(50);
  });
});

describe('simulação', () => {
  it('produção cresce com a frota até saturar a carga', () => {
    const m = model(1);
    const opt = { config: m.configs[0], scenario: { ...m.scenarios[0], days: 3 } };
    const p1 = replicate(m, { ...opt, trucks: { [m.circuits[0].id]: 1 } }).tpd.mean;
    const p4 = replicate(m, { ...opt, trucks: { [m.circuits[0].id]: 4 } }).tpd.mean;
    const p20 = replicate(m, { ...opt, trucks: { [m.circuits[0].id]: 20 } });
    expect(p4).toBeGreaterThan(p1 * 2.5);
    expect(p20.loaderUtil.mean).toBeGreaterThan(0.85);
    expect(p20.queueLoadMin.mean).toBeGreaterThan(5);
  });

  it('empilhadeira limita a vazão e forma fila na descarga', () => {
    const m = model(12);
    m.receiving[0] = { ...m.receiving[0], bufferT: 0, stackerTph: 150 };
    const sc = { ...m.scenarios[0], days: 3, hoursPerDay: 24 };
    const s = replicate(m, { config: m.configs[0], scenario: sc });
    expect(s.tph.mean).toBeLessThan(150 * 1.01); // DF da empilhadeira = 100% neste teste
    expect(s.tph.mean).toBeGreaterThan(150 * 0.9);
    expect(s.queueDumpMin.mean).toBeGreaterThan(10);
  });

  it('é reproduzível com a mesma semente e conserva a massa', () => {
    const m = model(3);
    const a = simulate(m, { config: m.configs[0], scenario: m.scenarios[0], seed: 7 });
    const b = simulate(m, { config: m.configs[0], scenario: m.scenarios[0], seed: 7 });
    expect(a.stats.tonnes).toBe(b.stats.tonnes);
    expect(a.stats.tonnes).toBeCloseTo(a.stats.trips * payloadFor(m.configs[0], m.circuits[0]), 6);
  });

  it('turno reduz a produção diária proporcionalmente', () => {
    const m = model(3);
    const full = replicate(m, { config: m.configs[0], scenario: { ...m.scenarios[0], hoursPerDay: 24, days: 4 } }).tpd.mean;
    const half = replicate(m, { config: m.configs[0], scenario: { ...m.scenarios[0], hoursPerDay: 12, days: 4 } }).tpd.mean;
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
  });

  it('intervalo de confiança contém a média', () => {
    const s = summarize([10, 12, 11, 13]);
    expect(s.lo).toBeLessThan(s.mean);
    expect(s.hi).toBeGreaterThan(s.mean);
  });
});

describe('paradas operacionais detalhadas', () => {
  it('troca de turno, refeição, abastecimento e interferências viram tempo simulado', () => {
    const m = model(4);
    const sc = { ...m.scenarios[0], hoursPerDay: 24, days: 4, efficiency: 100, truckDf: 100, cv: 0, stops: { shifts: 3, shiftChangeMin: 20, mealMin: 60, fuelMin: 30, interferenceMin: 2 } };
    const res = simulate({ ...m, warmupH: 0 }, { config: m.configs[0], scenario: sc, seed: 3 });
    const sh = res.stats.stateShare;
    // por caminhão e por dia: 3 × 20 = 60 min de troca, 3 × 60 = 180 min de refeição, 30 min de abastecimento
    expect(sh.troca_turno ?? 0).toBeGreaterThan(0.03);
    expect(sh.troca_turno ?? 0).toBeLessThan(0.055);
    expect(sh.refeicao ?? 0).toBeGreaterThan(0.10);
    expect(sh.refeicao ?? 0).toBeLessThan(0.15);
    expect(sh.abastecimento ?? 0).toBeGreaterThan(0.012);
    expect(sh.abastecimento ?? 0).toBeLessThan(0.03);
    expect(sh.interferencia ?? 0).toBeGreaterThan(0);
    const base = simulate({ ...m, warmupH: 0 }, { config: m.configs[0], scenario: { ...sc, stops: undefined }, seed: 3 });
    expect(res.stats.tonnes).toBeLessThan(base.stats.tonnes);
  });
});

describe('frota mista na simulação', () => {
  it('composição fixa: proporções exatas e intercaladas', async () => {
    const { assignTypes } = await import('./des');
    const t = assignTypes(5, [3, 2], null);
    expect(t.filter((x) => x === 0).length).toBe(3);
    expect(t.filter((x) => x === 1).length).toBe(2);
    expect(t[0] !== t[1] || t[1] !== t[2]).toBe(true);
    const d = assignTypes(1000, [1, 1], (() => { let i = 0; return () => ((i++ * 0.618) % 1); })());
    expect(Math.abs(d.filter((x) => x === 0).length - 500)).toBeLessThan(60);
  });
});

describe('despacho dinâmico', () => {
  it('caminhões vão para o circuito mais atrasado: viagens na proporção das metas', () => {
    const r1 = { id: 'r1', name: 'A', points: [{ x: 0, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }] };
    const r2 = { id: 'r2', name: 'B', points: [{ x: 0, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }] };
    const m0 = emptyModel();
    const base: SimModel = { ...m0, routes: [r1, r2], circuits: [{ ...defaultCircuit(r1, 0), destination: 'D1', trucks: 3, dispatchWeight: 3 }, { ...defaultCircuit(r2, 1), destination: 'D2', trucks: 3, dispatchWeight: 1 }] };
    const m: SimModel = { ...base, dispatch: 'dinamico' };
    const res = simulate(m, { scenario: m.scenarios[0], config: m.configs[0], seed: 5 });
    const [a, b] = res.stats.perCircuit;
    expect(a.trips / Math.max(1, b.trips)).toBeGreaterThan(2.3);
    expect(a.trips / Math.max(1, b.trips)).toBeLessThan(3.7);
    const fixed = simulate(base, { scenario: base.scenarios[0], config: base.configs[0], seed: 5 });
    expect(Math.abs(fixed.stats.perCircuit[0].trips - fixed.stats.perCircuit[1].trips)).toBeLessThan(fixed.stats.perCircuit[0].trips * 0.2);
  });
});

describe('paradas no trajeto', () => {
  it('parada de 10 min nos dois sentidos soma ~20 min ao ciclo; balança única forma fila', () => {
    const r1 = { id: 'r1', name: 'A', points: [{ x: 0, y: 0, z: 0 }, { x: 2000, y: 0, z: 0 }] };
    const m0 = emptyModel();
    const c = { ...defaultCircuit(r1, 0), destination: 'D1', trucks: 1 };
    const base: SimModel = { ...m0, routes: [r1], circuits: [c] };
    const withStop: SimModel = { ...base, circuits: [{ ...c, stops: [{ name: 'Balança', weigh: true, frac: 0.5, stopMin: 10, dir: 'ambos', posts: 1 }] }] };
    const a = simulate(base, { scenario: base.scenarios[0], config: base.configs[0], seed: 3 }).stats.perCircuit[0].cycleMin;
    const b = simulate(withStop, { scenario: base.scenarios[0], config: base.configs[0], seed: 3 }).stats.perCircuit[0].cycleMin;
    expect(b - a).toBeGreaterThan(17);
    expect(b - a).toBeLessThan(23);
  });
});
