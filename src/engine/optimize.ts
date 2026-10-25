/**
 * Cenários de frota: exata (frações), inteira por fluxo (arredonda cada rota para cima) e otimizada
 * (caminhões e equipamentos de carga com ocupação baixa cobrem outro fluxo: as sobras fracionárias
 * são agrupadas em unidades compartilhadas, por tipo de caminhão / modelo de equipamento).
 */
import type { DetailedPremises, Route } from '../types';
import { analyzeFleet, catalogOf } from './fleet';
import { fleetTypesOf } from './mix';

export interface SharedUnit {
  kind: 'caminhao' | 'carga';
  model: string;
  /** fluxos atendidos e a fração de cada um */
  parts: { name: string; frac: number }[];
  load: number;
}

export interface ScenarioRow {
  model: string;
  exact: number;
  perFlow: number;
  optimized: number;
  available: number | null;
}

export interface FleetScenarios {
  trucks: ScenarioRow[];
  loaders: ScenarioRow[];
  shared: SharedUnit[];
  /** caminhões dedicados por fluxo no cenário otimizado */
  dedicated: { route: string; model: string; count: number }[];
  totals: { trucks: { exact: number; perFlow: number; optimized: number }; loaders: { exact: number; perFlow: number; optimized: number } };
}

/**
 * Agrupa as sobras (< 1) em unidades inteiras: o equipamento divide o tempo entre fluxos, então uma sobra pode
 * ser dividida entre duas unidades (maior primeiro, enchendo cada unidade até a ocupação máxima).
 */
function pack(items: { name: string; frac: number }[], max = 1): { parts: { name: string; frac: number }[]; load: number }[] {
  const bins: { parts: { name: string; frac: number }[]; load: number }[] = [];
  const cap = Math.min(1, Math.max(0.5, max));
  for (const it of [...items].filter((x) => x.frac > 1e-4).sort((a, b) => b.frac - a.frac)) {
    let left = it.frac;
    // cabe inteiro numa unidade já aberta?
    const fit = bins.find((b) => b.load + left <= cap + 1e-9);
    if (fit) {
      fit.parts.push({ name: it.name, frac: left });
      fit.load += left;
      continue;
    }
    // senão completa a última unidade aberta e o resto abre outra
    const last = bins[bins.length - 1];
    if (last && cap - last.load > 0.05 && left > cap - last.load) {
      const take = cap - last.load;
      last.parts.push({ name: it.name, frac: take });
      last.load += take;
      left -= take;
    }
    while (left > 1e-4) {
      const take = Math.min(cap, left);
      bins.push({ parts: [{ name: it.name, frac: take }], load: take });
      left -= take;
    }
  }
  return bins;
}

export function fleetScenarios(routes: Route[], premises: DetailedPremises): FleetScenarios {
  const max = (premises.shareMaxPct ?? 100) / 100;
  const fa = analyzeFleet(routes, premises);
  const cat = catalogOf(premises).trucks;
  const types = fleetTypesOf(premises);
  const nameOf = (id: string) => cat.find((c) => c.id === id)?.name ?? types.find((t) => t.classId === id)?.cls.name ?? id;
  // necessidade exata de cada fluxo por tipo de caminhão
  const need: { route: string; type: string; exact: number }[] = [];
  for (const a of fa.routes) {
    if (a.mix?.length) {
      // cada tipo da composição reduzido na mesma proporção até a capacidade igualar a meta
      const cap = a.mix.reduce((s, m) => s + m.capacityWetT, 0);
      const k = cap > 0 ? a.targetWetT / cap : 0;
      for (const m of a.mix) if (m.count > 0) need.push({ route: a.name, type: m.classId, exact: m.count * k });
    } else need.push({ route: a.name, type: types[0]?.classId ?? 'caminhao', exact: a.trucksNeededExact });
  }
  const trucks: ScenarioRow[] = [];
  const shared: SharedUnit[] = [];
  const dedicated: FleetScenarios['dedicated'] = [];
  for (const t of [...new Set(need.map((x) => x.type))]) {
    const list = need.filter((x) => x.type === t);
    const exact = list.reduce((s, x) => s + x.exact, 0);
    const perFlow = list.reduce((s, x) => s + Math.ceil(x.exact - 1e-6), 0);
    const ded = list.map((x) => ({ route: x.route, count: Math.floor(x.exact + 1e-6) }));
    const bins = pack(list.map((x) => ({ name: x.route, frac: x.exact - Math.floor(x.exact + 1e-6) })), max);
    for (const d of ded) if (d.count > 0) dedicated.push({ route: d.route, model: nameOf(t), count: d.count });
    for (const b of bins) shared.push({ kind: 'caminhao', model: nameOf(t), parts: b.parts, load: b.load });
    const avail = types.find((x) => x.classId === t)?.count ?? null;
    trucks.push({ model: nameOf(t), exact, perFlow, optimized: ded.reduce((s, d) => s + d.count, 0) + bins.length, available: avail });
  }
  // equipamentos de carga: por local e modelo (equipamento não troca de local)
  const loaders: ScenarioRow[] = [];
  const byModel = new Map<string, ScenarioRow>();
  const byLocal = new Map<string, typeof fa.loaderNeeds>();
  for (const l of fa.loaderNeeds) {
    const key = `${l.nodeId ?? l.where}|${l.loaderName}`;
    byLocal.set(key, [...(byLocal.get(key) ?? []), l]);
  }
  for (const [, list] of byLocal) {
    const model = list[0].loaderName;
    const row = byModel.get(model) ?? { model, exact: 0, perFlow: 0, optimized: 0, available: null };
    row.exact += list.reduce((s, l) => s + l.neededExact, 0);
    row.perFlow += list.reduce((s, l) => s + l.needed, 0);
    const label = (l: (typeof list)[number]) => (l.role === 'alimentacao' ? `${l.where} · alimentar` : (l.perRoute ?? []).map((p) => p.name).join(' + ') || `${l.where} · carga`);
    const full = list.reduce((s, l) => s + Math.floor(l.neededExact + 1e-6), 0);
    const bins = pack(list.map((l) => ({ name: label(l), frac: l.neededExact - Math.floor(l.neededExact + 1e-6) })), max);
    // um local com uso nenhum ainda precisa de 1 equipamento por uso com horas
    const opt = Math.max(full + bins.length, list.some((l) => l.busyH > 0) ? 1 : 0);
    row.optimized += opt;
    for (const b of bins) if (b.parts.length > 1) shared.push({ kind: 'carga', model, parts: b.parts, load: b.load });
    const av = list.reduce<number | null>((s, l) => (l.available === null ? s : (s ?? 0) + l.available), null);
    if (av !== null) row.available = (row.available ?? 0) + av;
    byModel.set(model, row);
  }
  loaders.push(...byModel.values());
  const sum = (rows: ScenarioRow[]) => ({ exact: rows.reduce((s, r) => s + r.exact, 0), perFlow: rows.reduce((s, r) => s + r.perFlow, 0), optimized: rows.reduce((s, r) => s + r.optimized, 0) });
  return { trucks, loaders, shared, dedicated, totals: { trucks: sum(trucks), loaders: sum(loaders) } };
}
