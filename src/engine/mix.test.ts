import { describe, expect, it } from 'vitest';
import { analyzeFleet, analyzeRoute, routeTargets, syncAutoFleet } from './fleet';
import { autoMix, syncMix } from './mix';
import { DEFAULT_PREMISES, INITIAL_ROUTES } from '../constants';

const P = { ...DEFAULT_PREMISES, targetMonthlyROM: 184407, rmGlobal: 45.11, rejeitoTotal: 54.89, processType: 'umido' as const, hasWasteRock: false };

describe('frota mista', () => {
  it('um tipo só: nada muda (sem composição nas rotas)', () => {
    const p = { ...P, fleetTypes: [{ classId: 'rod-40', count: 8 }] };
    const routes = INITIAL_ROUTES.map((r) => ({ ...r }));
    const s = syncAutoFleet(routes, p);
    expect((s ?? routes).every((r) => !r.mix)).toBe(true);
  });

  it('capacidade da rota = soma por tipo', () => {
    const r = { ...INITIAL_ROUTES[0], mix: { 'rod-40': 2, 'rod-30': 3 } };
    const target = routeTargets(INITIAL_ROUTES, P).get(r.id)!;
    const a = analyzeRoute(r, P, target);
    const a40 = analyzeRoute({ ...r, mix: undefined }, P, target, { payloadT: 40, volumeM3: 22, trucks: 2 });
    const a30 = analyzeRoute({ ...r, mix: undefined }, P, target, { payloadT: 30, volumeM3: 18, trucks: 3 });
    expect(a.trucksAllocated).toBe(5);
    expect(a.mix!.length).toBe(2);
    expect(a.transportCapacityWetT).toBeCloseTo(2 * a40.truckMonthT + 3 * a30.truckMonthT + a40.extraCapacityWetT, 0);
  });

  it('automático: cobre as metas, respeita a via e não passa do estoque de caminhões', () => {
    const routes = INITIAL_ROUTES.map((r, i) => ({ ...r, roadType: i === 1 ? ('estrada' as const) : ('interna' as const) }));
    const p = { ...P, fleetTypes: [{ classId: 'rod-30', count: 10 }, { classId: 'rig-60', count: 10 }], mixMode: 'auto' as const };
    const alloc = autoMix(routes, p);
    expect(alloc.get(routes[1].id)!['rig-60'] ?? 0).toBe(0);
    const used = { 'rod-30': 0, 'rig-60': 0 } as Record<string, number>;
    for (const m of alloc.values()) for (const [k, v] of Object.entries(m)) used[k] += v;
    expect(used['rod-30']).toBeLessThanOrEqual(10);
    expect(used['rig-60']).toBeLessThanOrEqual(10);
    const next = syncMix(routes, p)!;
    const fa = analyzeFleet(next, p);
    for (const r of fa.routes) expect(r.ratio).toBeGreaterThanOrEqual(1);
    for (const r of next) if (r.active) expect(r.truckCount).toBe(Object.values(r.mix ?? {}).reduce((a, b) => a + b, 0));
  });

  it('voltar para um tipo limpa as composições', () => {
    const routes = INITIAL_ROUTES.map((r) => ({ ...r, mix: { 'rod-40': 1 } }));
    const s = syncAutoFleet(routes, { ...P, fleetTypes: [] })!;
    expect(s.every((r) => !r.mix)).toBe(true);
  });
});

describe('frota mista estatística', () => {
  it('frações de caminhão por rota; frota do tipo = soma arredondada para cima', async () => {
    const { typeTotals } = await import('./mix');
    const p = { ...P, fleetTypes: [{ classId: 'rod-40', count: 8 }, { classId: 'rod-30', count: 1 }], mixMode: 'estatistico' as const };
    let routes = INITIAL_ROUTES.map((r) => ({ ...r }));
    for (let i = 0; i < 4; i++) routes = syncAutoFleet(routes, p) ?? routes;
    const fa = analyzeFleet(routes, p);
    for (const a of fa.routes) {
      expect(a.ratio).toBeGreaterThanOrEqual(0.999);
      expect(Math.abs(a.trucksAllocated - a.trucksNeededExact)).toBeLessThan(0.02);
    }
    const sum = routes.reduce((s, r) => s + (r.mix?.['rod-40'] ?? 0), 0);
    expect(typeTotals(routes, p).get('rod-40')).toBe(Math.ceil(sum - 1e-6));
  });
});

describe('velocidade por tipo e equipamento padrão', () => {
  it('tipo mais rápido faz ciclo menor; equipamento padrão vale para os locais sem escolha', async () => {
    const { ensureNetwork } = await import('./network');
    const { routeKind } = await import('./fleet');
    const r = { ...INITIAL_ROUTES[0], mix: { 'rod-40': 2 } };
    const t = routeTargets(INITIAL_ROUTES, P).get(r.id)!;
    const slow = analyzeRoute(r, { ...P, fleetTypes: [{ classId: 'rod-40', count: 2 }, { classId: 'rod-30', count: 1 }] }, t);
    const fast = analyzeRoute(r, { ...P, fleetTypes: [{ classId: 'rod-40', count: 2, speedLoaded: 40, speedEmpty: 50 }, { classId: 'rod-30', count: 1 }] }, t);
    expect(fast.cycle.totalMin).toBeLessThan(slow.cycle.totalMin);
    const net = ensureNetwork(INITIAL_ROUTES, P, routeKind)!;
    const pn = { ...P, nodes: net.nodes, defaultLoaderClassId: 'esc-50' };
    const fa = analyzeFleet(net.routes, pn);
    expect(fa.loaderNeeds.length).toBeGreaterThan(0);
    const pt = { ...pn, nodes: net.nodes.map((n) => ({ ...n, loaderClassId: 'tempo' })) };
    expect(analyzeFleet(net.routes, pt).loaderNeeds.length).toBe(0);
  });
});
