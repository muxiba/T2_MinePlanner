import { describe, expect, it } from 'vitest';
import { DEFAULT_PREMISES } from '../constants';
import { emptyModel, defaultCircuit } from './defaults';
import { emptyPlan, type MinePlan } from './plan';
import { circuitTargets, generateMovements, hoursBreakdown, periodDays, rainyCalendar, suggestedRomT, syncDerived, syncPeriods, withPremises, PREMISES_CONFIG_ID } from './link';
import type { SimModel } from './types';

const P: any = { ...DEFAULT_PREMISES, truckCapacity: 40, truckVolumeM3: 22, dfMina: 85, ufMina: 85, contractedHoursMina: 24, velocidadeCheio: 15, velocidadeVazio: 20, loadingTime: 2, dumpingTime: 2, weighingTimeLoaded: 1, weighingTimeEmpty: 0, queueMin: 2, targetMonthlyROM: 184407, rmGlobal: 45.11, rejeitoTotal: 54.89, umidadeNatural: 9, perdaMaterial: 1, processType: 'umido' };

const route = (id: string, name: string, len: number) => ({ id, name, points: [{ x: 0, y: 0, z: 0 }, { x: len, y: 0, z: 0 }] });

describe('ligação com as premissas', () => {
  it('calendário chuvoso: jan, fev, mar, out, nov e dez', () => {
    const c = rainyCalendar();
    expect(c.filter((m) => m.season === 'chuvoso').map((m) => m.month)).toEqual(['Janeiro', 'Fevereiro', 'Março', 'Outubro', 'Novembro', 'Dezembro']);
    expect(periodDays('ano', c).work).toBe(6 * 20 + 6 * 26);
    expect(periodDays('quinquenio', c).work).toBe(5 * 276);
    expect(periodDays('mes', c, undefined, 1).work).toBe(20);
    expect(periodDays('mes', c, undefined, undefined, 3).work).toBeCloseTo(276 / 4, 6);
    expect(periodDays('ano', c, undefined, undefined, 2).work).toBe(552);
    expect(suggestedRomT(P, 'mes', undefined, 3)).toBe(184407 * 3);
    expect(suggestedRomT(P, 'quinquenio', undefined, 1)).toBe(184407 * 60);
  });

  it('períodos acompanham o calendário', () => {
    const plan: MinePlan = { ...emptyPlan(), periods: [{ label: 'Ano 1', workDays: 0, kind: 'ano' }, { label: 'Q1', workDays: 0, kind: 'quinquenio' }] };
    const s = syncPeriods(plan);
    expect(s.periods[0].workDays).toBe(276);
    expect(s.periods[1].workDays).toBe(1380);
    const h = hoursBreakdown(365, 276, 24, 85, 85);
    expect(h.productive).toBeCloseTo(276 * 24 * 0.85 * 0.85, 6);
  });

  it('modelo efetivo usa a frota, DF/UF e tempos das premissas e calcula os caminhões', () => {
    const m0: SimModel = emptyModel();
    const routes = [route('r1', 'Mina -> Planta', 2085), route('r2', 'Planta -> Terminal', 790)];
    const m: SimModel = { ...m0, routes, circuits: routes.map((r, i) => ({ ...defaultCircuit(r, i), destination: `D${i}` })), link: { enabled: true, speedMode: 'constante' } };
    const e = withPremises(m, P);
    expect(e.configs[0].id).toBe(PREMISES_CONFIG_ID);
    expect(e.configs[0].payloadT).toBe(40);
    expect(e.scenarios[0].truckDf).toBe(85);
    expect(e.scenarios[0].efficiency).toBe(85);
    const calc = circuitTargets(e, P);
    expect(calc[0].flow).toBe('rom');
    expect(calc[0].tonnesDry).toBe(184407); // um mês das premissas
    expect(calc[0].tonnes).toBeCloseTo(184407 * 1.1, 3);
    expect(calc[1].tonnesDry).toBeCloseTo(184407 * 0.4511, 3);
    const ov = circuitTargets({ ...e, circuits: e.circuits.map((c, i) => (i === 0 ? { ...c, tonnesDryOverride: 100000 } : c)) }, P);
    expect(ov[0].tonnesDry).toBe(100000);
    expect(ov[0].overridden).toBe(true);
    expect(calc[1].flow).toBe('produto');
    // ciclo igual ao do Dimensionamento com velocidade constante: carga 2 + ida + basculamento 2 + volta + pesagem 1 + fila 2
    const ida = (2.085 / 15) * 60;
    const volta = (2.085 / 20) * 60;
    expect(calc[0].cycleMin).toBeCloseTo(2 + ida + 2 + volta + 1 + 2, 1);
    expect(e.circuits[0].trucks).toBe(calc[0].trucks);
    // idempotente
    expect(JSON.stringify(withPremises(e, P).circuits)).toBe(JSON.stringify(e.circuits));
  });

  it('movimentações pelas premissas: ROM, produto e rejeito por período', () => {
    const plan: MinePlan = {
      ...emptyPlan(),
      periods: [{ label: 'Ano 1', workDays: 276, kind: 'ano', romT: 1_000_000 }],
      places: [
        { id: 'f', name: 'Frente', kind: 'frente', x: 0, y: 0, z: 0 },
        { id: 'u', name: 'Usina', kind: 'usina', x: 1, y: 0, z: 0 },
        { id: 't', name: 'Terminal', kind: 'terminal', x: 2, y: 0, z: 0 },
        { id: 'd', name: 'Disposição', kind: 'rejeito', x: 3, y: 0, z: 0 },
      ],
      movements: [],
    };
    let k = 0;
    const r = generateMovements(plan, P, () => `m${k++}`);
    expect(r.warnings).toEqual([]);
    const t = (o: string, d: string) => r.plan.movements.find((m) => m.origin === o && m.destination === d)!.tonnes[0];
    expect(r.plan.tonnesBasis).toBe('seca');
    expect(t('f', 'u')).toBe(1_000_000);
    expect(t('u', 't')).toBe(Math.round(1_000_000 * 0.4511));
    expect(t('u', 'd')).toBe(Math.round(1_000_000 * 0.5489));
    // meta de ROM do período alterada: ROM, produto e rejeito acompanham
    const edited = { ...r.plan, periods: [{ ...r.plan.periods[0], romT: 2_000_000 }] };
    const s2 = syncDerived(edited, P);
    expect(s2.movements.find((m) => m.origin === 'f')!.tonnes[0]).toBe(2_000_000);
    expect(s2.movements.find((m) => m.destination === 't')!.tonnes[0]).toBe(Math.round(2_000_000 * 0.4511));
    // ROM digitado à mão (desvinculado): produto acompanha o ROM digitado
    const manual = { ...s2, movements: s2.movements.map((m) => (m.origin === 'f' ? { ...m, derived: undefined, tonnes: [1_500_000] } : m)) };
    expect(syncDerived(manual, P).movements.find((m) => m.destination === 't')!.tonnes[0]).toBe(Math.round(1_500_000 * 0.4511));
    expect(s2.wetFactor).toBeCloseTo(1.1, 6);
  });
});

describe('frota mista na simulação', () => {
  it('cria uma configuração por tipo, leva a composição da movimentação e simula cada tipo', async () => {
    const { simulate } = await import('./des');
    const r1 = route('r1', 'Mina → Planta', 3000);
    const m: SimModel = { ...emptyModel(), routes: [r1], circuits: [{ ...defaultCircuit(r1, 0), flow: 'rom', edgeId: 'R1' }], link: { enabled: true, speedMode: 'constante' } };
    const Pm = { ...P, fleetTypes: [{ classId: 'rod-40', count: 3 }, { classId: 'rod-30', count: 2 }] };
    const e = withPremises(m, Pm, new Map([['R1', 100000]]), [{ id: 'R1', mix: { 'rod-40': 1, 'rod-30': 4 } } as any]);
    expect(e.configs.some((c) => c.id === 'P:rod-30')).toBe(true);
    expect(e.circuits[0].mix).toEqual({ 'P:rod-40': 1, 'P:rod-30': 4 });
    const calc = circuitTargets(e, Pm, new Map([['R1', 100000]]));
    expect(calc[0].payloadT).toBeCloseTo((40 + 4 * 30) / 5, 1);
    const res = simulate({ ...e, circuits: [{ ...e.circuits[0], trucks: 5 }] }, { scenario: e.scenarios[0], config: e.configs[0], seed: 3 });
    expect(res.stats.trips).toBeGreaterThan(0);
    // sem frota mista: nada muda
    expect(withPremises(m, P).circuits[0].mix === undefined).toBe(true);
  });
});
