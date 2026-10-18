/**
 * Web Worker do simulador: roda simulações e lê DXFs grandes sem travar a tela.
 */
import { fleetSweep, replicate, simulate } from './des';
import { contoursFromFile, hillshade, terrainFromFaces } from './terrain';
import { buildNetwork, sizePeriod, type PeriodResult } from './plan';
import { demFromContours, demFromGrid } from './dem';
import { FleetLedger, agedDf, defaultFinance, financeFor } from './econ';
import { parseFrontsDxf, parseSolidDxf, scanLayers, type FrontParseOptions } from './planParse';
import type { SimModel } from './types';

export type WorkerRequest =
  | { id: number; kind: 'matrix'; model: SimModel; configIds: string[]; scenarioIds: string[] }
  | { id: number; kind: 'sweep'; model: SimModel; configId: string; scenarioId: string; circuitId: string; maxTrucks: number }
  | { id: number; kind: 'trace'; model: SimModel; configId: string; scenarioId: string; hours: number }
  | { id: number; kind: 'terrain'; file: File; mode: 'faces' | 'contours' }
  | { id: number; kind: 'dxfLayers'; file: File }
  | { id: number; kind: 'planFronts'; file: File; opts?: FrontParseOptions }
  | { id: number; kind: 'planSolid'; file: File; layers?: string[] }
  | { id: number; kind: 'periods'; model: SimModel; configIds: string[]; scenarioIds: string[]; periods?: number[]; aging?: boolean };

const post = (m: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.kind === 'matrix') {
      const cells: { configId: string; scenarioId: string; stats: ReturnType<typeof replicate> }[] = [];
      const total = req.configIds.length * req.scenarioIds.length;
      for (const configId of req.configIds) {
        for (const scenarioId of req.scenarioIds) {
          const config = req.model.configs.find((c) => c.id === configId)!;
          const scenario = req.model.scenarios.find((s) => s.id === scenarioId)!;
          cells.push({ configId, scenarioId, stats: replicate(req.model, { config, scenario }) });
          post({ id: req.id, progress: cells.length / total });
        }
      }
      post({ id: req.id, result: cells });
    } else if (req.kind === 'sweep') {
      const config = req.model.configs.find((c) => c.id === req.configId)!;
      const scenario = req.model.scenarios.find((s) => s.id === req.scenarioId)!;
      const res = fleetSweep(req.model, { config, scenario }, req.circuitId, req.maxTrucks, Math.min(req.model.replications, 5), (p) =>
        post({ id: req.id, progress: Math.min(0.95, p.trucks / req.maxTrucks) }),
      );
      post({ id: req.id, result: res });
    } else if (req.kind === 'trace') {
      const config = req.model.configs.find((c) => c.id === req.configId)!;
      const scenario = req.model.scenarios.find((s) => s.id === req.scenarioId)!;
      const days = Math.max(1, Math.ceil(req.hours / 24));
      const res = simulate(req.model, { config, scenario: { ...scenario, days }, seed: 1000, traceHours: req.hours });
      post({ id: req.id, result: res });
    } else if (req.kind === 'dxfLayers') {
      post({ id: req.id, result: await scanLayers(req.file, (f) => post({ id: req.id, progress: f })) });
    } else if (req.kind === 'planFronts') {
      post({ id: req.id, result: await parseFrontsDxf(req.file, (f) => post({ id: req.id, progress: f }), req.opts) });
    } else if (req.kind === 'planSolid') {
      const r = await parseSolidDxf(req.file, (f) => post({ id: req.id, progress: f }), req.layers);
      if (!r) return post({ id: req.id, error: `${req.file.name}${req.layers?.length ? ` (${req.layers.join(', ')})` : ''}: nenhuma face 3DFACE encontrada.` });
      post({ id: req.id, result: r });
    } else if (req.kind === 'periods') {
      const plan = req.model.plan!;
      const fin = req.model.finance ?? defaultFinance(req.model.configs);
      const list = req.periods ?? plan.periods.map((_, i) => i + 1);
      const net = buildNetwork(req.model.routes);
      const out: PeriodResult[] = [];
      const total = list.length * req.configIds.length * Math.max(1, req.scenarioIds.length);
      for (const configId of req.configIds) {
        const config = req.model.configs.find((c) => c.id === configId)!;
        for (const scenarioId of req.scenarioIds) {
          const scenario = req.model.scenarios.find((s) => s.id === scenarioId) ?? req.model.scenarios[0];
          const tf = financeFor(fin, configId, config.payloadT);
          const ledger = new FleetLedger(tf);
          let prevN = 0;
          for (const p of list) {
            const avgAgeH = req.aging === false ? 0 : ledger.previewAge(Math.max(1, prevN));
            const truckDf = req.aging === false ? scenario.truckDf : agedDf(scenario.truckDf, tf, avgAgeH);
            const r = sizePeriod(req.model, plan, p, config, { ...scenario, truckDf }, { net });
            ledger.step(r.trucks, r.hoursPerTruck);
            if (r.trucks > 0) prevN = r.trucks;
            out.push({ ...r, scenarioId: scenario.id, truckDf, avgAgeH });
            post({ id: req.id, progress: out.length / total, stage: `${config.name} · ${scenario.name} · ${plan.periods[p - 1]?.label ?? p}` });
          }
        }
      }
      post({ id: req.id, result: out });
    } else if (req.kind === 'terrain') {
      if (req.mode === 'faces') {
        const r = await terrainFromFaces(req.file, (f, stage) => post({ id: req.id, progress: f, stage }));
        if (!r) return post({ id: req.id, error: 'Nenhuma face 3DFACE encontrada no arquivo.' });
        const shade = hillshade(r.grid);
        const dem = demFromGrid(r.grid);
        const { z, ...meta } = r.grid;
        post({ id: req.id, result: { kind: 'grid', meta, z, shade, faces: r.faces, dem } }, [z.buffer, shade.buffer, dem.z.buffer]);
      } else {
        const c = await contoursFromFile(req.file, (f, stage) => post({ id: req.id, progress: f, stage }));
        if (!c) return post({ id: req.id, error: 'Nenhuma polilinha encontrada no arquivo.' });
        post({ id: req.id, progress: 0.98, stage: 'Montando a superfície 3D' });
        const dem = demFromContours(c);
        post({ id: req.id, result: { kind: 'contours', contours: c, dem } }, [dem.z.buffer]);
      }
    }
  } catch (e) {
    post({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
};
