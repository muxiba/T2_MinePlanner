/**
 * Frota necessária (relatório consolidado): caminhões por tipo em cada movimentação, equipamentos de carga
 * por local, horas e custo do mês. Tudo sai das Premissas Fundamentais e do 2. Dimensionamento.
 */
import type { DetailedPremises, Route } from '../types';
import { KIND_LABELS, analyzeFleet, catalogOf, type LoaderNeed } from './fleet';
import { fleetTypesOf, hourlyCost, mixedOn } from './mix';

export interface ReportType {
  classId: string;
  name: string;
  count: number;
}

export interface ReportMovement {
  id: string;
  name: string;
  material: string;
  massWetT: number;
  massDryT: number;
  distance: number;
  cycleMin: number;
  types: ReportType[];
  neededExact: number;
  needed: number;
  allocated: number;
  ratio: number;
  /** horas efetivas de caminhão no mês (caminhões necessários × horas efetivas) */
  truckHours: number;
  costMonth: number;
  costPerT: number;
}

export interface FleetReport {
  mixed: boolean;
  movements: ReportMovement[];
  byType: { classId: string; name: string; required: number; available: number }[];
  loaders: LoaderNeed[];
  totals: { trucksRequired: number; trucksAvailable: number; truckHours: number; costMonth: number; massWetT: number; loadersRequired: number };
}

export function buildFleetReport(routes: Route[], premises: DetailedPremises): FleetReport {
  const fa = analyzeFleet(routes, premises);
  const cat = catalogOf(premises).trucks;
  const mixed = mixedOn(premises);
  const types = fleetTypesOf(premises);
  const nameOf = (id: string) => {
    const c = cat.find((x) => x.id === id) ?? types.find((t) => t.classId === id)?.cls;
    return c ? `${c.manufacturer ? `${c.manufacturer} ` : ''}${c.name}` : id;
  };
  const clsOf = (id: string) => cat.find((x) => x.id === id) ?? types.find((t) => t.classId === id)?.cls;
  const single = types[0];
  const movements: ReportMovement[] = fa.routes.map((a) => {
    const r = routes.find((x) => x.id === a.id)!;
    // por tipo: composição da frota mista ou o caminhão das premissas com os caminhões necessários
    const list: ReportType[] = a.mix?.length
      ? a.mix.map((m) => ({ classId: m.classId, name: m.name, count: m.count }))
      : [{ classId: single.classId, name: nameOf(single.classId), count: Math.max(0, a.trucksNeeded) }];
    const hEff = a.hours.effective;
    const costMonth = list.reduce((acc, t) => {
      const c = clsOf(t.classId);
      return acc + (c ? t.count * hourlyCost(c, premises) * hEff : 0);
    }, 0);
    const needed = Math.max(0, a.mix?.length ? list.reduce((s, t) => s + t.count, 0) : a.trucksNeeded);
    return {
      id: a.id,
      name: a.name,
      material: KIND_LABELS[a.kind].split(' (')[0],
      massWetT: a.targetWetT,
      massDryT: a.targetDryT,
      distance: r.distance,
      cycleMin: a.cycle.totalMin,
      types: list,
      neededExact: a.trucksNeededExact,
      needed,
      allocated: a.trucksAllocated,
      ratio: a.ratio,
      truckHours: needed * hEff,
      costMonth,
      costPerT: a.targetWetT > 0 ? costMonth / a.targetWetT : 0,
    };
  });
  const req = new Map<string, number>();
  for (const m of movements) for (const t of m.types) req.set(t.classId, (req.get(t.classId) ?? 0) + t.count);
  const byType = [...new Set([...types.map((t) => t.classId), ...req.keys()])].map((id) => ({
    classId: id,
    name: nameOf(id),
    required: req.get(id) ?? 0,
    available: mixed ? types.find((t) => t.classId === id)?.count ?? 0 : premises.truckCount || 0,
  }));
  return {
    mixed,
    movements,
    byType,
    loaders: fa.loaderNeeds,
    totals: {
      trucksRequired: movements.reduce((s, m) => s + m.needed, 0),
      trucksAvailable: premises.truckCount || 0,
      truckHours: movements.reduce((s, m) => s + m.truckHours, 0),
      costMonth: movements.reduce((s, m) => s + m.costMonth, 0),
      massWetT: movements.reduce((s, m) => s + m.massWetT, 0),
      loadersRequired: fa.loaderNeeds.reduce((s, l) => s + l.needed, 0),
    },
  };
}
