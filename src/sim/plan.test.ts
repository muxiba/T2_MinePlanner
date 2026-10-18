import { describe, expect, it } from 'vitest';
import { emptyModel } from './defaults';
import {
  accessLeg,
  assignFronts,
  buildNetwork,
  buildPeriodModel,
  disposalCheck,
  emptyPlan,
  movementsFromCsv,
  movementsToCsv,
  newMovement,
  pathBetween,
  sizePeriod,
  type MinePlan,
} from './plan';
import { parseFrontsDxf, parseSolidDxf, periodFromName } from './planParse';
import type { SimModel } from './types';

/** Duas vias em cruz: L–O de 0 a 2000 m (y = 0) e N–S em x = 1000 (y de −500 a 500). */
function base(): SimModel {
  const m = emptyModel();
  m.routes = [
    { id: 'a', name: 'Leste-Oeste', points: [{ x: 0, y: 0, z: 100 }, { x: 2000, y: 0, z: 100 }] },
    { id: 'b', name: 'Norte-Sul', points: [{ x: 1000, y: -500, z: 100 }, { x: 1000, y: 500, z: 100 }] },
  ];
  m.receiving = [];
  m.replications = 3;
  return m;
}

function plan(): MinePlan {
  const p = emptyPlan();
  p.periods = p.periods.slice(0, 2);
  p.places = [
    { id: 'f', name: 'Frente', kind: 'frente', x: 0, y: 0, z: 100 },
    { id: 'u', name: 'Usina', kind: 'usina', x: 1000, y: 500, z: 100 },
  ];
  p.movements = [{ ...newMovement('m', 'f', 'u', 2), tonnes: [1_000_000, 0] }];
  return p;
}

describe('plano de lavra', () => {
  it('lê o número do período no nome do arquivo', () => {
    expect(periodFromName('7f607e40-01-Linha.dxf')).toBe(1);
    expect(periodFromName('Ano12_Rejeito.dxf')).toBe(12);
    expect(periodFromName('16-Linha.dxf')).toBe(16);
  });

  it('acha o caminho pela malha passando pelo cruzamento das vias', () => {
    const net = buildNetwork(base().routes);
    const pts = pathBetween(net, { x: 0, y: 0, z: 100 }, { x: 1000, y: 500, z: 100 }, { rampMaxGrade: 10, accessTortuosity: 1 });
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    expect(L).toBeCloseTo(1500, 0);
  });

  it('acesso com desnível grande vira zigue-zague com rampa ≤ máxima', () => {
    const leg = accessLeg({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 30 }, 10, 1);
    let L = 0;
    for (let i = 1; i < leg.length; i++) L += Math.hypot(leg[i].x - leg[i - 1].x, leg[i].y - leg[i - 1].y);
    expect(L).toBeGreaterThanOrEqual(299);
    expect(leg[leg.length - 1].z).toBeCloseTo(30, 5);
  });

  it('a frente de cada período carrega dentro da área daquele período', () => {
    const p = plan();
    p.fronts = [
      { id: 'a1', period: 1, front: '', ring: [[1900, -50], [2000, -50], [2000, 50], [1900, 50]], areaM2: 10000, z: 90, zMin: 85, zMax: 95, lx: 1950, ly: 0 },
    ];
    p.fronts = assignFronts(p);
    expect(p.fronts[0].front).toBe('Frente');
    const { info } = buildPeriodModel(base(), p, 1);
    expect(info[0].originSource).toBe('area');
    // 50 m de acesso + 950 m até o cruzamento + 500 m até a usina
    expect(info[0].lengthM).toBeGreaterThan(1400);
    expect(info[0].dz).toBeCloseTo(10, 0);
  });

  it('distribui as áreas pela tonelagem: a frente que mais produz fica com a maior área', () => {
    const p = plan();
    p.places.push({ id: 'g', name: 'Frente 2', kind: 'frente', x: 100, y: 0, z: 100 });
    p.movements.push({ ...newMovement('m2', 'g', 'u', 2), tonnes: [400_000, 0] });
    p.fronts = [
      { id: 'big', period: 1, front: '', ring: [], areaM2: 150000, z: 0, zMin: 0, zMax: 0, lx: 120, ly: 0 },
      { id: 'small', period: 1, front: '', ring: [], areaM2: 40000, z: 0, zMin: 0, zMax: 0, lx: 0, ly: 30 },
    ];
    const out = assignFronts(p);
    expect(out.find((f) => f.id === 'big')!.front).toBe('Frente');
    expect(out.find((f) => f.id === 'small')!.front).toBe('Frente 2');
  });

  it('planilha de movimentações: exporta e lê de volta', () => {
    const p = plan();
    const back = movementsFromCsv(p, movementsToCsv(p));
    expect(back.warnings).toEqual([]);
    expect(back.plan.movements[0].tonnes).toEqual([1_000_000, 0]);
    const novo = movementsFromCsv(p, 'Material;Origem;Destino;Densidade;Ano 1\nROM;Frente;Britador;1,8;1.234.567');
    expect(novo.plan.movements[0].tonnes[0]).toBe(1234567);
    expect(novo.warnings.length).toBe(1);
  });

  it('capacidade dos sólidos: saldo por período e acumulado', () => {
    const p = plan();
    p.places.push({ id: 'r', name: 'Cava', kind: 'rejeito', x: 0, y: 0, z: 0 });
    p.disposalDensity = 2;
    p.movements.push({ ...newMovement('mr', 'u', 'r', 2), tonnes: [200_000, 300_000] });
    p.solids = [
      { id: 's1', period: 1, name: 'S1', volumeM3: 80_000, hull: [], cx: 0, cy: 0, zMin: 0, zMax: 1, faces: 1 },
      { id: 's2', period: 2, name: 'S2', volumeM3: 200_000, hull: [], cx: 0, cy: 0, zMin: 0, zMax: 1, faces: 1 },
    ];
    const c = disposalCheck(p);
    expect(c[0].balanceM3).toBe(-20_000);
    expect(c[1].cumulativeM3).toBe(30_000);
  });

  it('dimensiona a frota do período para cumprir a meta diária', () => {
    const m = base();
    const p = plan();
    const r = sizePeriod(m, p, 1, m.configs[0], m.scenarios[0], { reps: 3 });
    expect(r.ok).toBe(true);
    expect(r.circuits[0].achievedTpd).toBeGreaterThanOrEqual(r.circuits[0].targetTpd * 0.995);
    // com um caminhão a menos não cumpre
    expect(r.trucks).toBeGreaterThan(1);
    expect(r.trucksExact).toBeLessThanOrEqual(r.trucks);
  });

  it('lê contorno de frente (Boundary + Pit_Toe) e volume de sólido fechado', async () => {
    const dxf = (body: string[]) => ['0', 'SECTION', '2', 'ENTITIES', ...body, '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const poly = (layer: string, pts: number[][], closed = true) => [
      '0', 'POLYLINE', '8', layer, '70', closed ? '9' : '8',
      ...pts.flatMap(([x, y, z]) => ['0', 'VERTEX', '8', layer, '10', String(x), '20', String(y), '30', String(z)]),
      '0', 'SEQEND',
    ];
    const fronts = await parseFrontsDxf(
      dxf([...poly('Boundary', [[0, 0, 110], [100, 0, 110], [100, 100, 110], [0, 100, 110]]), ...poly('Pit_Toe', [[10, 10, 95], [90, 10, 95], [90, 90, 95], [10, 90, 95], [50, 50, 95]], false)]),
    );
    expect(fronts.length).toBe(1);
    expect(fronts[0].areaM2).toBeCloseTo(10000, 0);
    expect(fronts[0].z).toBeCloseTo(95, 5);
    // cubo 10 × 10 × 10 em 12 triângulos
    const v = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
    const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const face = (a: number, b: number, c: number) =>
      ['0', '3DFACE', '8', 'S', ...[a, b, c, c].flatMap((k, i) => [String(10 + i), String(v[k][0]), String(20 + i), String(v[k][1]), String(30 + i), String(v[k][2])])];
    const solid = await parseSolidDxf(dxf(quads.flatMap(([a, b, c, d]) => [...face(a, b, c), ...face(a, c, d)])));
    expect(solid!.volumeClosedM3).toBeCloseTo(1000, 3);
    expect(solid!.volumeGridM3).toBeCloseTo(1000, -1);
    expect(solid!.openEdges).toBe(0);
  });
});
