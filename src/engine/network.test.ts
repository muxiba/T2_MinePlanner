import { describe, expect, it } from 'vitest';
import { ensureNetwork, networkBalance } from './network';
import { analyzeFleet, routeKind, routeTargets } from './fleet';
import { DEFAULT_PREMISES, INITIAL_ROUTES } from '../constants';
import type { FlowNode, Route } from '../types';

const P = { ...DEFAULT_PREMISES, targetMonthlyROM: 184407, rmGlobal: 45.11, rejeitoTotal: 54.89, processType: 'umido' as const, hasWasteRock: false };
const R = (id: string, name: string, kind: Route['kind'], fromId: string, toId: string, extra: Partial<Route> = {}): Route => ({ ...INITIAL_ROUTES[0], id, name, kind, fromId, toId, targetMass: undefined, share: undefined, ...extra });

describe('rede de fluxos', () => {
  it('plano antigo: a rede criada sozinha dá as mesmas massas', () => {
    const before = routeTargets(INITIAL_ROUTES, P);
    const net = ensureNetwork(INITIAL_ROUTES, P, routeKind)!;
    const after = routeTargets(net.routes, { ...P, nodes: net.nodes });
    for (const r of INITIAL_ROUTES) expect(after.get(r.id)!).toBeCloseTo(before.get(r.id)!, 3);
    expect(net.nodes.map((n) => n.type).sort()).toEqual(['expedicao', 'frente', 'planta', 'rejeito']);
  });

  it('duas frentes, duas plantas, produto por estoque e limpeza da baia', () => {
    const nodes: FlowNode[] = [
      { id: 'fA', name: 'Frente A', type: 'frente', romShare: 60 },
      { id: 'fB', name: 'Frente B', type: 'frente', romShare: 40 },
      { id: 'p1', name: 'Planta 1', type: 'planta' },
      { id: 'p2', name: 'Planta 2', type: 'planta' },
      { id: 'est', name: 'Estoque de produto', type: 'estoque', stockChangeT: 5000 },
      { id: 'exp', name: 'Terminal', type: 'expedicao' },
      { id: 'baia', name: 'Baia', type: 'rejeito' },
      { id: 'pr', name: 'Pilha de rejeito', type: 'rejeito' },
    ];
    const routes = [
      R('a1', 'A → P1', 'rom', 'fA', 'p1'),
      R('b2', 'B → P2', 'rom', 'fB', 'p2'),
      R('p1e', 'P1 → estoque', 'product', 'p1', 'est'),
      R('p2e', 'P2 → estoque', 'product', 'p2', 'est'),
      R('ee', 'estoque → terminal', 'product', 'est', 'exp'),
      R('p1b', 'P1 → baia', 'tailings', 'p1', 'baia'),
      R('p2r', 'P2 → pilha', 'tailings', 'p2', 'pr'),
      R('bl', 'baia → pilha (limpeza)', 'tailings', 'baia', 'pr', { targetMass: 20000 }),
    ];
    const res = networkBalance(routes, { ...P, nodes }, routeKind);
    const e = (id: string) => res.edges.get(id)!;
    expect(e('a1')).toBeCloseTo(184407 * 0.6, 3);
    expect(e('b2')).toBeCloseTo(184407 * 0.4, 3);
    expect(e('p1e') + e('p2e')).toBeCloseTo(184407 * 0.4511, 3);
    expect(e('ee')).toBeCloseTo(184407 * 0.4511 - 5000, 3);
    expect(e('p1b')).toBeCloseTo(184407 * 0.6 * 0.5489, 3);
    expect(e('bl')).toBe(20000);
    expect(res.romToPlants).toBeCloseTo(184407, 3);
    expect(res.issues.some((i) => i.text.includes('forma 5.000'))).toBe(true);
    expect(res.issues.some((i) => i.level === 'erro')).toBe(false);
  });

  it('avisa produto da planta sem destino', () => {
    const nodes: FlowNode[] = [{ id: 'f', name: 'F', type: 'frente' }, { id: 'p', name: 'Planta', type: 'planta' }];
    const res = networkBalance([R('r', 'F → P', 'rom', 'f', 'p')], { ...P, nodes }, routeKind);
    expect(res.issues.some((i) => i.level === 'erro' && i.text.includes('produto sem movimentação'))).toBe(true);
  });

  it('equipamentos de carga por local: horas de carga ÷ horas efetivas de um equipamento', () => {
    const net = ensureNetwork(INITIAL_ROUTES, P, routeKind)!;
    const frente = net.nodes.find((n) => n.type === 'frente')!;
    const nodes = net.nodes.map((n) => (n.id === frente.id ? { ...n, loaderClassId: 'esc-35', loaderDf: 85 } : n));
    const a = analyzeFleet(net.routes, { ...P, nodes, looseDensity: 2 });
    const need = a.loaderNeeds.find((x) => x.nodeId === frente.id)!;
    const rom = a.routes.find((r) => r.kind === 'rom')!;
    // 40 t ÷ (2,0 m³ × 90% × 2,0 t/m³) = 11,1 → 12 caçambadas de 22 s = 4,4 min + 0,5 min de posicionamento
    expect(rom.loading!.passes).toBe(12);
    expect(rom.loading!.loadMin).toBeCloseTo(4.9, 6);
    const trucks = rom.targetWetT / rom.payloadT;
    expect(need.busyH).toBeCloseTo((trucks * 4.9) / 60, 6);
    expect(need.needed).toBe(Math.ceil(need.busyH / need.effHPerUnit - 1e-6));
  });
});

describe('só transporte, equipamentos por local e estéril', () => {
  it('modo só transporte: massas informadas, aviso em passagem desbalanceada, rede do processo guardada', async () => {
    const { switchFlowMode } = await import('./flowMode');
    const net = ensureNetwork(INITIAL_ROUTES, P, routeKind)!;
    const p0 = { ...P, nodes: net.nodes };
    const sw = switchFlowMode(p0, net.routes, 'transporte')!;
    expect(sw.routes.length).toBe(0);
    const nodes: FlowNode[] = [
      { id: 'o', name: 'Cava', type: 'frente', group: 'origem' },
      { id: 'pt', name: 'Pátio', type: 'estoque', group: 'passagem' },
      { id: 'd', name: 'Porto', type: 'expedicao', group: 'destino' },
    ];
    const pt = { ...sw.premises, nodes };
    const routes = [R('a', 'Cava → Pátio', 'rom', 'o', 'pt', { targetMass: 50000 }), R('b', 'Pátio → Porto', 'rom', 'pt', 'd', { targetMass: 45000 })];
    const t = routeTargets(routes, pt);
    expect(t.get('a')).toBe(50000);
    const res = networkBalance(routes, pt, routeKind);
    expect(res.issues.some((x) => x.nodeId === 'pt')).toBe(true);
    expect(networkBalance(routes, { ...pt, nodes: nodes.map((n) => (n.id === 'pt' ? { ...n, stockChangeT: 5000 } : n)) }, routeKind).issues.length).toBe(0);
    expect(ensureNetwork(routes, pt, routeKind)).toBe(null);
    const back = switchFlowMode(pt, routes, 'processo')!;
    expect(back.routes.length).toBe(net.routes.length);
    expect(back.premises.savedNets?.transporte?.routes.length).toBe(2);
  });

  it('dois equipamentos na planta: um para o produto, outro para o rejeito, e a pá da alimentação', () => {
    const net = ensureNetwork(INITIAL_ROUTES, P, routeKind)!;
    const planta = net.nodes.find((n) => n.type === 'planta')!;
    const prod = net.routes.find((r) => routeKind(r) === 'product')!;
    const nodes = net.nodes.map((n) => (n.id === planta.id ? { ...n, loaders: [{ id: 'a', classId: 'pa-35', routeIds: [prod.id] }, { id: 'b', classId: 'esc-35' }, { id: 'c', classId: 'pa-55', role: 'alimentacao' as const }] } : n));
    const fa = analyzeFleet(net.routes, { ...P, nodes });
    const needs = fa.loaderNeeds.filter((l) => l.nodeId === planta.id);
    expect(needs.map((l) => l.entryId).sort()).toEqual(['a', 'b', 'c']);
    expect(needs.find((l) => l.entryId === 'a')!.routeIds).toEqual([prod.id]);
    expect(needs.find((l) => l.entryId === 'c')!.feedWetT!).toBeGreaterThan(0);
  });

  it('desmarcar estéril desativa as movimentações de estéril e marcar traz de volta', async () => {
    const { setWasteOn } = await import('./flowMode');
    const routes = [R('w', 'Mina → PDE', 'waste', 'f', 'pde'), R('r', 'Mina → Planta', 'rom', 'f', 'p')];
    const off = setWasteOn({ ...P, hasWasteRock: true }, routes, false);
    expect(off.routes.find((r) => r.id === 'w')!.active).toBe(false);
    expect(off.routes.find((r) => r.id === 'r')!.active).toBe(true);
    const on = setWasteOn(off.premises, off.routes, true);
    expect(on.routes.find((r) => r.id === 'w')!.active).toBe(true);
  });
});
