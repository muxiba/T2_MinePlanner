import { describe, expect, it } from 'vitest';
import { analyzeFleet, analyzeRoute, cascade, loaderLoading, routeTargets, wetFromDry } from './fleet';
import { DEFAULT_PREMISES, INITIAL_ROUTES } from '../constants';
import type { Route } from '../types';

const P = { ...DEFAULT_PREMISES };
const mine = INITIAL_ROUTES.find((r) => r.name.includes('Mina'))!;

describe('fundamentos', () => {
  it('massa úmida = seca / (1 − umidade) × (1 + perda)', () => {
    expect(wetFromDry(100, 9, 1)).toBeCloseTo(110.989, 2);
    expect(wetFromDry(100, 0, 0)).toBe(100);
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
});
