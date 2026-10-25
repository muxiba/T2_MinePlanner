/**
 * Frota mista: vários tipos de caminhão (catálogo) na mesma operação.
 * - Capacidade de uma rota = Σ caminhões de cada tipo × t/mês daquele tipo na rota (carga útil e volume próprios).
 * - Modo automático: distribui a frota pelo menor custo por tonelada (custo horário do tipo ÷ t/h na rota),
 *   respeitando a via (estrada pública só recebe rodoviários), até cada rota atingir a meta.
 */
import type { DetailedPremises, Route, TruckClass } from '../types';
import { analyzeRoute, catalogOf, routeTargets } from './fleet';

export interface MixType {
  classId: string;
  cls: TruckClass;
  count: number;
}

/** Tipos da frota. Sem frota mista cadastrada: um tipo só, o caminhão das premissas. */
export function fleetTypesOf(premises: DetailedPremises): MixType[] {
  const cat = catalogOf(premises).trucks;
  const list = (premises.fleetTypes ?? []).filter((t) => t.count > 0 && cat.some((c) => c.id === t.classId));
  if (list.length) return list.map((t) => ({ classId: t.classId, cls: cat.find((c) => c.id === t.classId)!, count: t.count }));
  const cls = cat.find((c) => c.id === premises.truckClassId);
  return [{ classId: cls?.id ?? '__premissas', cls: cls ?? { id: '__premissas', name: `Caminhão ${premises.truckCapacity} t`, payloadT: premises.truckCapacity, volumeM3: premises.truckVolumeM3 ?? 0 }, count: premises.truckCount || 0 }];
}

export const mixedOn = (premises: DetailedPremises) => (premises.fleetTypes ?? []).filter((t) => t.count > 0).length > 1;

/** Custo por hora trabalhada de um tipo (propriedade + manutenção média + diesel + pneus + operadores). */
export function hourlyCost(cls: TruckClass, premises: DetailedPremises) {
  const fin = premises.simulation?.finance;
  const diesel = fin?.dieselPrice ?? 6.2;
  const hpy = cls.hoursPerYear || 5000;
  const life = Math.max(1, (cls.lifeYears || 5) * hpy);
  const own = ((cls.price ?? 1_600_000) * (1 - (cls.residualPct ?? 20) / 100)) / life;
  const maint = (cls.maintPerH ?? 70) * (1 + ((cls.maintEscPctYear ?? 8) / 100) * ((cls.lifeYears || 5) / 2));
  const wageYear = (fin?.salaryMonthly ?? 4500) * 12 * (1 + (fin?.chargesPct ?? 80) / 100) * (fin?.shifts ?? 3) * (fin?.reliefFactor ?? 1.25);
  const operator = wageYear / hpy;
  return own + maint + (cls.dieselLph ?? 28) * diesel + (cls.tiresPerH ?? 25) + operator;
}

const fits = (cls: TruckClass, r: Route) => !(r.roadType === 'estrada' && cls.vehicle === 'mina');

export interface MixCell {
  classId: string;
  name: string;
  count: number;
  payloadT: number;
  truckMonthT: number;
  truckRateTph: number;
  costPerH: number;
  costPerT: number;
}

/** Desempenho de cada tipo em cada rota. */
export function typeOnRoute(route: Route, premises: DetailedPremises, targetDryT: number, t: MixType): MixCell {
  const a = analyzeRoute({ ...route, mix: undefined }, premises, targetDryT, { payloadT: t.cls.payloadT, volumeM3: t.cls.volumeM3 || undefined, trucks: 0 });
  const costPerH = hourlyCost(t.cls, premises);
  return { classId: t.classId, name: `${t.cls.manufacturer ? `${t.cls.manufacturer} ` : ''}${t.cls.name}`, count: 0, payloadT: a.payloadT, truckMonthT: a.truckMonthT, truckRateTph: a.truckRateTph, costPerH, costPerT: a.truckRateTph > 0 ? costPerH / a.truckRateTph : Infinity };
}

/**
 * Distribuição automática: rotas com mais horas de caminhão primeiro; em cada rota, o tipo de menor custo por tonelada
 * que cabe na via, até a meta; se o tipo acabar, o próximo. Retorna a frota de cada rota por tipo.
 */
export function autoMix(routes: Route[], premises: DetailedPremises, fractional = (premises.mixMode ?? 'auto') === 'estatistico'): Map<string, Record<string, number>> {
  const types = fleetTypesOf(premises);
  const left = new Map(types.map((t) => [t.classId, t.count]));
  const targets = routeTargets(routes, premises);
  const active = routes.filter((r) => r.active);
  const rows = active.map((r) => {
    const target = targets.get(r.id) || 0;
    const cells = types.filter((t) => fits(t.cls, r)).map((t) => typeOnRoute(r, premises, target, t));
    const wet = analyzeRoute({ ...r, mix: undefined }, premises, target, { trucks: 0 }).targetWetT;
    const best = Math.max(1e-9, ...cells.map((c) => c.truckMonthT));
    return { r, cells: cells.sort((a, b) => a.costPerT - b.costPerT), wet, demand: wet / best };
  });
  rows.sort((a, b) => b.demand - a.demand);
  // estatístico: caminhões compartilhados entre as rotas (fração de caminhão por rota); senão, caminhões inteiros por rota
  const need = (x: number) => (fractional ? Math.ceil(x * 100 - 1e-6) / 100 : Math.ceil(x - 1e-6));
  const out = new Map<string, Record<string, number>>();
  for (const row of rows) {
    let remaining = row.wet;
    const m: Record<string, number> = {};
    for (const c of row.cells) {
      if (remaining <= 1e-6) break;
      const avail = left.get(c.classId) ?? 0;
      if (avail <= 0 || c.truckMonthT <= 0) continue;
      const n = Math.min(avail, need(remaining / c.truckMonthT));
      if (n > 0) {
        m[c.classId] = n;
        left.set(c.classId, avail - n);
        remaining -= n * c.truckMonthT;
      }
    }
    // ainda falta: usa o que sobrou de qualquer tipo que caiba na via (mesmo mais caro)
    if (remaining > 1e-6)
      for (const c of [...row.cells].sort((a, b) => b.truckMonthT - a.truckMonthT)) {
        const avail = left.get(c.classId) ?? 0;
        if (avail <= 0 || remaining <= 1e-6) continue;
        const n = Math.min(avail, need(remaining / c.truckMonthT));
        m[c.classId] = Math.round(((m[c.classId] ?? 0) + n) * 100) / 100;
        left.set(c.classId, avail - n);
        remaining -= n * c.truckMonthT;
      }
    out.set(row.r.id, m);
  }
  return out;
}

/** Frota mista automática: grava a composição e o total de caminhões em cada rota. Retorna null se nada mudou. */
export function syncMix(routes: Route[], premises: DetailedPremises): Route[] | null {
  if (!mixedOn(premises)) {
    // saiu da frota mista: limpa as composições
    if (!routes.some((r) => r.mix)) return null;
    return routes.map((r) => (r.mix ? { ...r, mix: undefined } : r));
  }
  const valid = new Set(fleetTypesOf(premises).map((t) => t.classId));
  if ((premises.mixMode ?? 'auto') === 'manual') {
    let changed = false;
    const next = routes.map((r) => {
      const m = Object.fromEntries(Object.entries(r.mix ?? {}).filter(([k, v]) => valid.has(k) && v > 0));
      const total = Object.values(m).reduce((a, b) => a + b, 0);
      if (JSON.stringify(m) === JSON.stringify(r.mix ?? {}) && total === r.truckCount && r.fleetMode === 'manual') return r;
      changed = true;
      return { ...r, mix: m, truckCount: total, fleetMode: 'manual' as const };
    });
    return changed ? next : null;
  }
  const alloc = autoMix(routes, premises);
  let changed = false;
  const next = routes.map((r) => {
    if (!r.active) return r.mix ? ((changed = true), { ...r, mix: undefined, truckCount: 0 }) : r;
    const m = alloc.get(r.id) ?? {};
    const total = Math.round(Object.values(m).reduce((a, b) => a + b, 0) * 100) / 100;
    if (JSON.stringify(m) === JSON.stringify(r.mix ?? {}) && total === r.truckCount) return r;
    changed = true;
    return { ...r, mix: m, truckCount: total, fleetMode: 'manual' as const };
  });
  return changed ? next : null;
}

/** Caminhões de cada tipo que a operação precisa: inteiros por rota ou, no modo estatístico, a soma das frações arredondada para cima. */
export function typeTotals(routes: Route[], premises: DetailedPremises) {
  const sum = new Map<string, number>();
  for (const r of routes) if (r.active) for (const [k, v] of Object.entries(r.mix ?? {})) sum.set(k, (sum.get(k) ?? 0) + v);
  return new Map([...sum].map(([k, v]) => [k, (premises.mixMode ?? 'auto') === 'estatistico' ? Math.max(0, Math.ceil(v - 1e-6)) : v]));
}
