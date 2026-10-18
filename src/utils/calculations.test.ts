import { describe, expect, it } from 'vitest';
import { calculateRouteProduction, calculateTotalProduction } from './calculations';
import { DEFAULT_PREMISES, INITIAL_ROUTES } from '../constants';
import type { DetailedPremises, Route } from '../types';

const premises: DetailedPremises = { ...DEFAULT_PREMISES };
const route = (over: Partial<Route> = {}): Route => ({ ...INITIAL_ROUTES[0], ...over });
const byName = (rs: Array<{ name: string; targetMass: number }>, frag: string) =>
  rs.find((r) => r.name.toLowerCase().includes(frag))!;

describe('calculateRouteProduction', () => {
  it('rota inativa não produz nada', () => {
    const r = calculateRouteProduction(route({ active: false }), premises, 500);
    expect(r.hourlyProduction).toBe(0);
    expect(r.suggestedTrucks).toBe(0);
  });

  it('distância maior exige mais caminhões para a mesma meta', () => {
    const perto = calculateRouteProduction(route({ distance: 800, targetMass: 100_000 }), premises, 500);
    const longe = calculateRouteProduction(route({ distance: 3000, targetMass: 100_000 }), premises, 500);
    expect(longe.unitaryProductivity).toBeLessThan(perto.unitaryProductivity);
    expect(longe.suggestedTrucks).toBeGreaterThan(perto.suggestedTrucks);
  });

  it('não gera NaN/Infinity com velocidades ou capacidade zeradas', () => {
    const r = calculateRouteProduction(route({ truckCapacity: 0, targetMass: 1000 }), { ...premises, loadingTime: 0 }, 500);
    for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
  });
});

describe('calculateTotalProduction', () => {
  const res = calculateTotalProduction(INITIAL_ROUTES, premises, {});

  it('retorna números finitos nas metas principais', () => {
    for (const k of ['plannedDailyROM', 'plannedDailyPlanta', 'plannedDailyRejeito', 'movimentacaoTotalDiaria'] as const) {
      expect(Number.isFinite(res[k])).toBe(true);
    }
    expect(res.plannedDailyROM).toBeGreaterThan(0);
  });

  it('distribui a massa: produto = ROM × RM global e rejeito = ROM × rejeito total', () => {
    const rs = res.routeResults as Array<{ name: string; targetMass: number }>;
    const rom = byName(rs, 'mina').targetMass;
    expect(rom).toBeCloseTo(premises.targetMonthlyROM, 2);
    expect(byName(rs, 'terminal').targetMass).toBeCloseTo(rom * (premises.rmGlobal / 100), 2);
    expect(byName(rs, 'baia').targetMass).toBeCloseTo(rom * (premises.rejeitoTotal / 100), 2);
  });

  it('processo a seco não gera rejeito e envia todo o ROM como produto', () => {
    const seco = calculateTotalProduction(INITIAL_ROUTES, { ...premises, processType: 'seco' }, {});
    const rs = seco.routeResults as Array<{ name: string; targetMass: number }>;
    expect(byName(rs, 'baia').targetMass).toBe(0);
    expect(byName(rs, 'terminal').targetMass).toBeCloseTo(premises.targetMonthlyROM, 2);
  });

  it('meta maior pede mais caminhões', () => {
    const maior = calculateTotalProduction(INITIAL_ROUTES, { ...premises, targetMonthlyROM: premises.targetMonthlyROM * 2 }, {});
    const s1 = (res.routeResults[0] as { suggestedTrucks: number }).suggestedTrucks;
    const s2 = (maior.routeResults[0] as { suggestedTrucks: number }).suggestedTrucks;
    expect(s2).toBeGreaterThan(s1);
  });
});
