import { describe, expect, it } from 'vitest';
import { checkFlows, ensureFlowRoutes, routeKind, adjustFleetToTarget, analyzeFleet, analyzeRoute, cascade, fitExtraAllocations, loaderLoading, syncAutoFleet, optimizeFleet, routeTargets, sumCalendarHours, trucksWithoutRoute, wetFromDry } from './fleet';
import { DEFAULT_PREMISES, INITIAL_ROUTES as DEFAULT_ROUTES } from '../constants';
import type { Route } from '../types';

const P = { ...DEFAULT_PREMISES };
/** rotas do plano de exemplo antigo (8, 4 e 4 caminhões, frota manual): base fixa destes testes */
const INITIAL_ROUTES: Route[] = DEFAULT_ROUTES.map((r, i) => ({ ...r, truckCount: [8, 4, 4][i] ?? r.truckCount, fleetMode: undefined }));
const mine = INITIAL_ROUTES.find((r) => r.name.includes('Mina'))!;

describe('fundamentos', () => {
  it('massa úmida: padrão seca × (1 + umidade + perda); opcional base úmida', () => {
    expect(wetFromDry(100, 9, 1)).toBeCloseTo(110, 6);
    expect(wetFromDry(100, 9, 1, 'base_umida')).toBeCloseTo(110.989, 2);
    expect(wetFromDry(100, 0, 0)).toBe(100);
  });

  it('horas efetivas = calendário × DF × UF das premissas (EO não é reaplicado)', () => {
    const a = analyzeRoute({ ...mine, mechanicalAvailability: 50, operationalEfficiency: 50 }, { ...P, dfMina: 85, ufMina: 85 }, 100000);
    expect(a.hours.effective).toBeCloseTo(a.hours.calendar * 0.85 * 0.85, 6);
    const own = analyzeRoute({ ...mine, ownRates: true, mechanicalAvailability: 90, utilization: 80 }, P, 100000);
    expect(own.hours.effective).toBeCloseTo(own.hours.calendar * 0.9 * 0.8, 6);
  });

  it('carga útil vem das premissas, salvo valores próprios', () => {
    expect(analyzeRoute({ ...mine, truckCapacity: 10 }, { ...P, truckCapacity: 40 }, 1000).payloadT).toBe(40);
    expect(analyzeRoute({ ...mine, truckCapacity: 10, ownRates: true }, { ...P, truckCapacity: 40 }, 1000).payloadT).toBe(10);
  });

  it('cascata de horas multiplica DF, UF e EO', () => {
    const h = cascade(720, 85, 85, 72);
    expect(h.effective).toBeCloseTo(720 * 0.85 * 0.85 * 0.72, 6);
  });

  it('caçambadas arredondam para cima e classificam 3–6 como ideal', () => {
    const l = loaderLoading({ bucketM3: 3, fillFactor: 90, cycleSec: 24 }, 40, 2);
    expect(l.passes).toBe(Math.ceil(40 / (3 * 0.9 * 2)));
    expect(l.passesStatus).toBe('muitas');
    expect(loaderLoading({ bucketM3: 4.5, fillFactor: 90, cycleSec: 26 }, 40, 2).passesStatus).toBe('ok');
  });
});

describe('rota', () => {
  it('ciclo informado substitui o calculado', () => {
    const calc = analyzeRoute(mine, P, 100000);
    const inf = analyzeRoute({ ...mine, cycleMode: 'informed', cycleTime: 40 }, P, 100000);
    expect(inf.cycle.totalMin).toBe(40);
    expect(calc.cycle.mode).toBe('calculated');
    expect(inf.trucksNeededExact).toBeGreaterThan(calc.trucksNeededExact);
  });

  it('fila aumenta o ciclo e a frota necessária', () => {
    const a = analyzeRoute(mine, P, 100000);
    const b = analyzeRoute({ ...mine, queueMin: 5 }, P, 100000);
    expect(b.cycle.totalMin - a.cycle.totalMin).toBeCloseTo(5, 6);
    expect(b.trucksNeededExact).toBeGreaterThan(a.trucksNeededExact);
  });

  it('volume da caçamba limita a carga útil', () => {
    const r = analyzeRoute({ ...mine, truckVolumeM3: 15 }, { ...P, looseDensity: 2 }, 100000);
    expect(r.payloadLimitedBy).toBe('volume');
    expect(r.payloadT).toBeCloseTo(30, 6);
  });

  it('carga subdimensionada vira o gargalo e caminhões extras ficam ociosos', () => {
    const r: Route = { ...mine, truckCount: 20, loader: { name: 'Esc', count: 1, bucketM3: 1.2, fillFactor: 90, cycleSec: 20, availability: 85 } };
    const a = analyzeRoute(r, P, 128000);
    expect(a.limitedBy).toBe('carga');
    expect(a.loader!.matchFactor).toBeGreaterThan(1);
    expect(a.idleTrucks).toBeGreaterThan(0);
  });

  it('capacidade = caminhões × produção mensal de cada um', () => {
    const a = analyzeRoute({ ...mine, truckCount: 3 }, P, 100000);
    expect(a.transportCapacityWetT).toBeCloseTo(3 * a.truckMonthT, 6);
    expect(a.trucksNeeded).toBe(Math.ceil(a.trucksNeededExact));
  });
});

describe('sistema', () => {
  it('metas: produto e rejeito proporcionais ao ROM; a seco não há rejeito', () => {
    const t = routeTargets(INITIAL_ROUTES, P);
    const rom = t.get('mina-pilha-2a')!;
    expect(t.get('planta-terminal')).toBeCloseTo((rom * P.rmGlobal) / 100, 6);
    expect(t.get('planta-baia-pru')).toBeCloseTo((rom * P.rejeitoTotal) / 100, 6);
    expect(routeTargets(INITIAL_ROUTES, { ...P, processType: 'seco' }).get('planta-baia-pru')).toBe(0);
  });

  it('planta pequena é o gargalo e gera ação específica', () => {
    const a = analyzeFleet(INITIAL_ROUTES, { ...P, plantFeedRateTPH: 100 });
    expect(a.meetsTarget).toBe(false);
    expect(a.bottleneck?.id).toBe('planta');
    expect(a.actions[0].kind).toBe('planta');
    expect(a.romDeliverableDryT).toBeLessThan(a.romTargetDryT);
  });

  it('déficit de caminhões gera remanejamento antes de pedir equipamento novo', () => {
    const routes = INITIAL_ROUTES.map((r) => (r.id === 'mina-pilha-2a' ? { ...r, truckCount: 2 } : r));
    const a = analyzeFleet(routes, P);
    expect(a.meetsTarget).toBe(false);
    expect(a.bottleneck?.id).toBe('transporte_rom');
    expect(a.actions.some((x) => x.kind === 'remanejar')).toBe(true);
  });

  it('frota folgada atende a meta e aponta excedentes', () => {
    const a = analyzeFleet(INITIAL_ROUTES, P);
    expect(a.meetsTarget).toBe(true);
    expect(a.fleet.idle).toBeGreaterThan(0);
    expect(a.actions.some((x) => x.kind === 'folga')).toBe(true);
  });

  it('comparador: caminhão maior precisa de menos unidades', () => {
    const a = analyzeFleet(INITIAL_ROUTES, P);
    const opts = a.classComparison!.options;
    const counts = opts.map((o) => o.trucksNeeded);
    expect(counts[0]).toBeGreaterThanOrEqual(counts[counts.length - 1]);
  });

  it('otimizador aloca a folga na rota que falta e atinge a meta quando a frota é suficiente', () => {
    const routes = INITIAL_ROUTES.map((r) => ({ ...r, truckCount: 0 }));
    const fleet = analyzeFleet(routes, { ...P, truckCount: 0 }).fleet.needed;
    const prem = { ...P, truckCount: fleet + 2 };
    const base = routes.map((r) => ({ ...r, truckCount: 0 }));
    const opt = optimizeFleet(base, prem, 'folga');
    expect(opt.meetsTarget || analyzeFleet(opt.routes, prem).bottleneck?.id === 'planta').toBe(true);
    const used = opt.routes.filter((r) => r.active).reduce((a, r) => a + r.truckCount, 0);
    expect(used).toBeLessThanOrEqual(prem.truckCount);
    expect(opt.spareLeft).toBe(prem.truckCount - used);
    // frota curta: aponta quantos faltam
    const short = optimizeFleet(base, { ...P, truckCount: 1 }, 'folga');
    expect(short.missingForTarget).toBeGreaterThan(0);
  });
});

describe('ajuste da frota à meta e frota extra', () => {
  const base: Route[] = INITIAL_ROUTES.map((r) => ({ ...r, truckCount: 0 }));
  it('cada rota recebe o inteiro acima do necessário e a sobra fica sem rota', () => {
    const prem = { ...P, truckCount: 40, extraAllocations: [] };
    const adj = adjustFleetToTarget(base, prem);
    const a = analyzeFleet(adj.routes, prem);
    for (const r of a.routes) if (r.targetWetT > 0 && !r.loader) expect(r.trucksAllocated).toBe(Math.ceil(r.trucksNeededExact - 1e-6));
    const used = adj.routes.filter((r) => r.active).reduce((s, r) => s + r.truckCount, 0);
    expect(used + adj.freeTrucks).toBe(40);
  });
  it('rotas + frota extra nunca passam da frota', () => {
    const cal = sumCalendarHours(P, 'mina');
    const routes = base.map((r, i) => ({ ...r, truckCount: i === 0 ? 8 : 1 }));
    const onRoutes = routes.filter((r) => r.active).reduce((s, r) => s + r.truckCount, 0);
    const prem = { ...P, truckCount: onRoutes + 2, extraAllocations: [{ id: 'x', routeId: routes[0].id, truckCount: 2, durationHours: cal, description: '' }] };
    expect(fitExtraAllocations(routes, prem)).toBe(null); // cabe
    // a rota ganha 1 caminhão: a frota extra perde 1
    const more = routes.map((r, i) => (i === 0 ? { ...r, truckCount: 9 } : r));
    const fit = fitExtraAllocations(more, prem)!;
    expect(fit[0].truckCount).toBe(1);
    expect(trucksWithoutRoute(more, prem)).toBe(1);
    // a rota perde 2: sobra 4 sem rota, alocação de 2 continua
    const less = routes.map((r, i) => (i === 0 ? { ...r, truckCount: 6 } : r));
    expect(trucksWithoutRoute(less, prem)).toBe(4);
    expect(fitExtraAllocations(less, prem)).toBe(null);
  });
});

describe('frota automática por rota', () => {
  const base: Route[] = INITIAL_ROUTES.map((r) => ({ ...r, truckCount: 0 }));
  it('inteiro = necessário arredondado para cima; exato = quebrado; acompanha a fila', () => {
    const prem = { ...P, truckCount: 60 };
    const r1 = syncAutoFleet(base.map((r) => ({ ...r, fleetMode: 'inteiro' as const })), prem)!;
    const a1 = analyzeFleet(r1, prem);
    for (const x of a1.routes) if (x.targetWetT > 0) expect(x.trucksAllocated).toBe(Math.ceil(x.trucksNeededExact - 1e-6));
    const r2 = syncAutoFleet(base.map((r) => ({ ...r, fleetMode: 'exato' as const })), prem)!;
    const a2 = analyzeFleet(r2, prem);
    for (const x of a2.routes) if (x.targetWetT > 0) expect(x.trucksAllocated).toBeCloseTo(x.trucksNeededExact, 1);
    // mais fila → mais caminhões, sem clicar de novo
    const prem2 = { ...prem, queueMin: 10 };
    const r3 = syncAutoFleet(r1, prem2)!;
    expect(r3.reduce((s, r) => s + (r.active ? r.truckCount : 0), 0)).toBeGreaterThan(r1.reduce((s, r) => s + (r.active ? r.truckCount : 0), 0));
    expect(syncAutoFleet(r3, prem2)).toBe(null);
  });
  it('nunca passa da frota', () => {
    const prem = { ...P, truckCount: 3 };
    const r = syncAutoFleet(base.map((x) => ({ ...x, fleetMode: 'inteiro' as const })), prem)!;
    expect(r.filter((x) => x.active).reduce((s, x) => s + x.truckCount, 0)).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe('perdas operacionais detalhadas', () => {
  it('UF calculada pelas paradas fixas e interferência no ciclo', async () => {
    const { ufFromLosses, fixedLossMinPerDay } = await import('./losses');
    const p = { ...P, contractedHoursMina: 24, losses: { enabled: true, shifts: 3, shiftChangeMin: 20, mealMin: 60, fuelMin: 30, interferenceMin: 1.5, otherMinPerShift: 10 } };
    expect(fixedLossMinPerDay(p).total).toBe(300);
    expect(ufFromLosses(p)).toBeCloseTo((1 - 300 / 1440) * 100, 6);
    const a = analyzeRoute(mine, p, 100000);
    const b = analyzeRoute(mine, { ...p, losses: { ...p.losses, enabled: false } }, 100000);
    expect(a.cycle.totalMin - b.cycle.totalMin).toBeCloseTo(1.5, 6);
  });
});

describe('fluxos de massa', () => {
  const base = { ...P, targetMonthlyROM: 184407, rmGlobal: 45.11, rejeitoTotal: 54.89, processType: 'umido' as const, hasWasteRock: false, targetMonthlyWasteRock: 0 };
  const mk = (id: string, name: string, extra: Partial<Route> = {}): Route => ({ ...mine, id, name, kind: undefined, targetMass: undefined, ...extra });

  it('rota de rejeito com nome “Pilha de Rejeiro” é rejeito e o ROM não é dividido', () => {
    const rs = [mk('a', 'Mina -> Planta'), mk('b', 'Planta -> Pilha de Rejeiro'), mk('c', 'Planta -> Terminal')];
    expect(routeKind(rs[1])).toBe('tailings');
    const t = routeTargets(rs, base);
    expect(Math.round(t.get('a')!)).toBe(184407);
    expect(t.get('b')!).toBeCloseTo(101221.0, 0);
    expect(t.get('c')!).toBeCloseTo(83186.0, 0);
    expect(checkFlows(rs, base).every((c) => c.status === 'ok')).toBe(true);
  });

  it('fluxo escolhido vale mais que o nome; dois basculamentos de rejeito dividem pelo peso', () => {
    const rs = [mk('a', 'Mina -> Planta'), mk('b', 'Ponto X', { kind: 'tailings', share: 3 }), mk('d', 'Ponto Y', { kind: 'tailings' }), mk('c', 'Planta -> Terminal')];
    const t = routeTargets(rs, base);
    expect(t.get('b')! + t.get('d')!).toBeCloseTo(101221.0, 0);
    expect(t.get('b')! / t.get('d')!).toBeCloseTo(3, 6);
  });

  it('estéril marcado cria a rota; apagada, não volta', () => {
    const P2 = { ...base, hasWasteRock: true, targetMonthlyWasteRock: 50000 };
    const rs = [mk('a', 'Mina -> Planta'), mk('b', 'Planta -> Baia'), mk('c', 'Planta -> Terminal')];
    const out = ensureFlowRoutes(rs, P2)!;
    expect(out.length).toBe(4);
    expect(routeKind(out[3])).toBe('waste');
    expect(ensureFlowRoutes(rs, { ...P2, dismissedFlows: ['waste'] })).toBe(null);
    expect(checkFlows(rs, P2).find((c) => c.kind === 'waste')!.status).toBe('sem_rota');
  });
});
