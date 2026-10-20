import { describe, expect, it } from 'vitest';
import { FleetLedger, agedDf, cashFlow, costDrivers, defaultFinance, evaluate, explainDifference, rank, sensitivity, type EquipFinance } from './econ';
import { emptyPlan, type PeriodResult } from './plan';

const eq: EquipFinance = { price: 1000, residualPct: 20, lifeH: 10_000, dieselMode: 'lph', dieselLph: 10, dieselLpt: 0, maintPerH: 1, maintEscPct: 100, tiresPerH: 0, operatorsPerUnit: 1, dfLossPer10kH: 5 };

function pr(period: number, trucks: number, hours: number, ok = true): PeriodResult {
  return {
    period, label: `Ano ${period}`, configId: 'A', scenarioId: 's1', trucks, trucksExact: trucks, loaders: 0, truckHours: trucks * hours, hoursPerTruck: hours, ok, stats: null,
    circuits: [{ movementId: 'm', circuitId: 'c', name: 'X → Y', material: 'Minério', tonnes: 100_000, targetTpd: 100, originLabel: '', destLabel: '', originSource: 'fixo', destSource: 'fixo', lengthM: 1000, dz: 0, trucks, achievedTpd: ok ? 110 : 90, cycleMin: 0, loadedMin: 0, emptyMin: 0, payloadT: 40, saturated: false }],
  };
}

describe('vida útil e economia', () => {
  it('compra o que falta, troca ao fim da vida útil e credita o residual', () => {
    const l = new FleetLedger(eq);
    const a = l.step(2, 6000);
    expect(a.bought).toBe(2);
    expect(a.capex).toBe(2000);
    const b = l.step(2, 6000); // 12.000 h → troca
    expect(b.replaced).toBe(2);
    expect(b.residualCredit).toBe(400);
    expect(l.ages[0]).toBe(2000);
    // manutenção do 1º período: 6000 h × 1 × (1 + 1 × 0,3) por caminhão
    expect(a.maintenance).toBeCloseTo(2 * 6000 * 1.3, 6);
  });

  it('disponibilidade cai com a idade', () => {
    expect(agedDf(85, eq, 20_000)).toBe(75);
  });

  it('custo nivelado, VPL e ranking', () => {
    const plan = emptyPlan();
    plan.periods = plan.periods.slice(0, 2);
    const fin = { ...defaultFinance([{ id: 'A', payloadT: 40 }, { id: 'B', payloadT: 60 }]), discountRate: 0, salaryMonthly: 0, overheadPerYear: 0, revenuePerT: 0 };
    fin.trucks.A = { ...eq };
    fin.trucks.B = { ...eq, price: 5000 };
    fin.loader = { ...eq, price: 0, maintPerH: 0, dieselLph: 0 };
    fin.dieselPrice = 1;
    const a = evaluate([pr(1, 2, 1000), pr(2, 2, 1000)], plan, fin, 'A', 40, 's1');
    const b = evaluate([{ ...pr(1, 2, 1000), configId: 'B' }, { ...pr(2, 2, 1000), configId: 'B' }], plan, fin, 'B', 60, 's1');
    // diesel 4000 h × 10 L × R$1 = 40.000; compra 2.000; residual no fim = 2 × 1000 × (1 − 0,8 × 0,2) = 1.680
    expect(a.capex).toBe(2000);
    expect(a.salvage).toBeCloseTo(1680, 6);
    expect(a.tonnes).toBe(200_000);
    expect(rank([b, a], 'economico')[0].configId).toBe('A');
    const notOk = evaluate([pr(1, 1, 1000, false), pr(2, 1, 1000)], plan, fin, 'A', 40, 's2');
    expect(rank([notOk, b], 'equilibrado')[0].configId).toBe('B');
    const sens = sensitivity(
      [{ results: [pr(1, 2, 1000), pr(2, 2, 1000)], configId: 'A', payloadT: 40, scenarioId: 's1' }],
      plan, fin, { configId: 'A', scenarioId: 's1' }, 'economico',
    );
    expect(sens[0].key).toBe('diesel');
    expect(sens[0].high).toBeGreaterThan(sens[0].low);
  });

  it('fluxo de caixa fecha com o VPL e explica a diferença de custo', () => {
    const plan = emptyPlan();
    plan.periods = plan.periods.slice(0, 2);
    const fin = { ...defaultFinance([{ id: 'A', payloadT: 40 }]), discountRate: 10, overheadPerYear: 0, revenuePerT: 5, revenueMaterial: '' };
    fin.trucks.A = { ...eq };
    const a = evaluate([pr(1, 2, 1000), pr(2, 2, 1000)], plan, fin, 'A', 40, 's1');
    const cf = cashFlow(a);
    expect(cf.rows.length).toBe(2);
    expect(cf.totals.pvNet).toBeCloseTo(a.npv!, 4);
    expect(cf.totals.cost).toBeCloseTo(a.totalCost, 4);
    const b = evaluate([pr(1, 4, 1000), pr(2, 4, 1000)], plan, fin, 'A', 40, 's2');
    const txt = explainDifference(costDrivers(b), costDrivers(a), 'B', 'A');
    expect(txt[0].includes('a mais')).toBe(true);
    expect(txt.some((t) => t.includes('pico de 4 contra 2'))).toBe(true);
  });
});
