/** Geração dos relatórios no navegador: monta os dados, desenha figuras e fórmulas e baixa o arquivo. */
import type { DetailedPremises, Route } from '@/types';
import type { ReportRun, SimModel } from '@/sim/types';
import { buildReportData, effectiveModel, type ReportOptions } from './data';
import { buildContent } from './content';

export type ReportKind = 'docx' | 'pptx' | 'xlsx';

const MIME: Record<ReportKind, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'relatorio';

export async function generateReport(kind: ReportKind, routes: Route[], premises: DetailedPremises, opts: ReportOptions, onStage?: (s: string) => void) {
  onStage?.('Montando os dados');
  const d = buildReportData(routes, premises, opts);
  const doc = buildContent(d);
  onStage?.('Desenhando gráficos e fórmulas');
  const { renderAll } = await import('./canvas');
  const figs = kind === 'docx' ? doc.figures : [...new Set([...doc.figures, 'cycleStatic', 'simTpd', 'cycleSim', 'fleets', 'sweep', 'cost', 'decisionPeriods', 'cycleRoutes'] as const)];
  const eqs = kind === 'xlsx' ? [] : [...new Set([...doc.equations, 'eq_meta', 'eq_hours', 'eq_frota', 'eq_prod', 'eq_custo', 'eq_nivel', 'eq_cap'] as const)];
  const images = await renderAll(d, figs, eqs);
  onStage?.('Gerando o arquivo');
  let bytes: Uint8Array;
  if (kind === 'docx') bytes = (await import('./docx')).buildDocx(d, images);
  else if (kind === 'pptx') bytes = (await import('./pptx')).buildPptx(d, images);
  else bytes = (await import('./xlsx')).buildXlsx(d, images);
  const name = `${slug(`${opts.client ? `${opts.client}_` : ''}${opts.title}`)}_${new Date().toISOString().slice(0, 10)}.${kind}`;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[kind] }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

/**
 * Rodada da aba Relatórios: matriz configuração × cenário (frota do modelo) e frota mínima
 * de cada configuração no cenário base, guardadas no plano.
 */
export async function runReportSimulations(routes: Route[], premises: DetailedPremises, configIds: string[], onProgress: (f: number, stage: string) => void): Promise<ReportRun> {
  const model = effectiveModel(premises, routes);
  if (!model || !model.circuits.length || !model.routes.length) throw new Error('Monte o modelo na aba Simulação (circuitos e trajetos) antes de rodar.');
  const { runInWorker } = await import('@/sim/client');
  const { circuitTargets, routeTargetsFor } = await loaders();
  const edges = routeTargetsFor(routes, premises);
  const sc0 = model.scenarios[0];
  type Cell = { configId: string; scenarioId: string; stats: import('@/sim/types').AggregateStats };
  onProgress(0, 'Matriz de cenários');
  const cells = await runInWorker<Cell[]>({ kind: 'matrix', model, configIds, scenarioIds: model.scenarios.map((s) => s.id) }, (f) => onProgress(f * 0.45, 'Matriz de cenários'));
  const trucks = model.circuits.reduce((a, c) => a + (c.trucks || 0), 0);
  const cname = (id: string) => model.configs.find((c) => c.id === id)?.name ?? id;
  const sname = (id: string) => model.scenarios.find((c) => c.id === id)?.name ?? id;
  const matrix = cells.map((x) => ({
    configId: x.configId,
    config: cname(x.configId),
    scenarioId: x.scenarioId,
    scenario: sname(x.scenarioId),
    trucks,
    tpd: x.stats.tpd.mean,
    lo: x.stats.tpd.lo,
    hi: x.stats.tpd.hi,
    cycleMin: x.stats.cycleMin.mean,
    queueLoadMin: x.stats.queueLoadMin.mean,
    queueDumpMin: x.stats.queueDumpMin.mean,
    loaderUtil: x.stats.loaderUtil.mean,
    dumpUtil: x.stats.dumpUtil.mean,
    costPerT: x.stats.costPerT.mean,
    cycle: x.stats.cycle,
  }));
  const minFleet: ReportRun['minFleet'] = [];
  for (let i = 0; i < configIds.length; i++) {
    const id = configIds[i];
    const cfg = model.configs.find((c) => c.id === id)!;
    const calc = circuitTargets({ ...model, configs: [cfg, ...model.configs.filter((c) => c.id !== id)] }, premises, edges);
    const targets = Object.fromEntries(calc.map((c) => [c.circuitId, c.workDays > 0 ? c.tonnes / c.workDays : 0]));
    const start = Object.fromEntries(calc.map((c) => [c.circuitId, Math.max(1, c.trucks)]));
    const stage = `Frota mínima de ${cfg.name}`;
    const rows = await runInWorker<{ circuitId: string; trucks: number; targetTpd: number; achievedTpd: number; cycleMin: number; saturated: boolean }[]>(
      { kind: 'sizeCircuits', model, configId: id, scenarioId: sc0.id, targets, start },
      (f) => onProgress(0.45 + ((i + f) / configIds.length) * 0.55, stage),
    );
    minFleet.push({
      configId: id,
      config: cfg.name,
      scenarioId: sc0.id,
      scenario: sc0.name,
      total: rows.reduce((a, r) => a + r.trucks, 0),
      circuits: rows.map((r) => ({ name: model.circuits.find((c) => c.id === r.circuitId)?.name ?? r.circuitId, trucks: r.trucks, targetTpd: r.targetTpd, achievedTpd: r.achievedTpd, cycleMin: r.cycleMin, saturated: r.saturated })),
    });
  }
  onProgress(1, 'Pronto');
  return { at: new Date().toISOString(), targetTpd: model.targetTpd || 0, matrix, minFleet };
}

async function loaders() {
  const link = await import('@/sim/link');
  const fleet = await import('@/engine/fleet');
  return { circuitTargets: link.circuitTargets, routeTargetsFor: (r: Route[], p: DetailedPremises) => (r.length ? fleet.routeTargets(r, p) : undefined) };
}

export type { ReportOptions };
export { buildReportData, effectiveModel };
export type { SimModel };
