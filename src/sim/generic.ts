/**
 * Modo simples da decisão: usa os circuitos da aba Circuito (rotas básicas de carga e basculamento)
 * e os períodos e o calendário do plano (estação chuvosa), sem frentes, polígonos nem rotas por período.
 * A massa de cada circuito no período = ROM do período × (massa do circuito ÷ ROM da aba Circuito).
 */
import type { SimModel, Scenario, TruckConfig } from './types';
import { payloadFor, configFor, sizeCircuitsFull } from './des';
import type { PeriodResult } from './plan';

export interface GenericPeriod {
  label: string;
  workDays: number;
  /** ROM seco do período */
  romT: number;
}

export interface GenericBasis {
  /** t úmidas transportadas pelo circuito por t seca de ROM */
  ratio: Record<string, number>;
  material: Record<string, string>;
}

export function sizeGenericPeriod(model: SimModel, basis: GenericBasis, per: GenericPeriod, period: number, config: TruckConfig, scenario: Scenario, start: Record<string, number> = {}, reps?: number): PeriodResult {
  const circuits = model.circuits.filter((c) => model.routes.some((r) => r.id === c.routeId) && (basis.ratio[c.id] ?? 0) > 0);
  const m: SimModel = { ...model, circuits };
  const days = Math.max(1, per.workDays);
  const targets = Object.fromEntries(circuits.map((c) => [c.id, (per.romT * basis.ratio[c.id]) / days]));
  if (!circuits.length || per.romT <= 0)
    return { period, label: per.label, configId: config.id, circuits: [], trucks: 0, trucksExact: 0, loaders: 0, truckHours: 0, hoursPerTruck: 0, ok: true, stats: null };
  const { rows, agg } = sizeCircuitsFull(m, { config, scenario }, targets, Object.fromEntries(circuits.map((c) => [c.id, start[c.id] ?? c.trucks ?? 1])), reps);
  const nTrucks = rows.reduce((a, r) => a + r.trucks, 0);
  const worked = 1 - (agg.stateShare.manutencao ?? 0) - (agg.stateShare.fora_turno ?? 0);
  const truckHours = rows.reduce((a, r) => a + r.trucks * (r.achievedTpd > 0 ? Math.min(1, r.targetTpd / r.achievedTpd) : 1) * worked * 24 * days, 0);
  const pcs = rows.map((r) => {
    const c = circuits.find((x) => x.id === r.circuitId)!;
    const route = model.routes.find((x) => x.id === c.routeId)!;
    const pts = route.points;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return {
      movementId: c.id,
      circuitId: c.id,
      name: c.name,
      material: basis.material[c.id] ?? 'Material',
      tonnes: per.romT * basis.ratio[c.id],
      targetTpd: r.targetTpd,
      originLabel: route.name,
      destLabel: c.destination,
      originSource: 'fixo' as const,
      destSource: 'fixo' as const,
      lengthM: len,
      dz: (pts[pts.length - 1]?.z ?? 0) - (pts[0]?.z ?? 0),
      trucks: r.trucks,
      achievedTpd: r.achievedTpd,
      cycleMin: r.cycleMin,
      loadedMin: 0,
      emptyMin: 0,
      payloadT: payloadFor(configFor(model, c, config), c),
      saturated: r.saturated,
    };
  });
  return {
    period,
    label: per.label,
    configId: config.id,
    circuits: pcs,
    trucks: nTrucks,
    trucksExact: pcs.reduce((a, c) => a + (c.achievedTpd > 0 ? (c.trucks * Math.min(c.targetTpd, c.achievedTpd)) / c.achievedTpd : 0), 0),
    loaders: circuits.reduce((a, c) => a + c.loaders, 0),
    truckHours,
    hoursPerTruck: nTrucks ? truckHours / nTrucks : 0,
    ok: pcs.every((c) => c.achievedTpd >= c.targetTpd * 0.995),
    stats: { loaderUtil: agg.loaderUtil, dumpUtil: agg.dumpUtil, queueLoadMin: agg.queueLoadMin, queueDumpMin: agg.queueDumpMin, costPerT: agg.costPerT },
  };
}
