/**
 * Web Worker do simulador: roda simulações e lê DXFs grandes sem travar a tela.
 */
import { fleetSweep, replicate, simulate } from './des';
import { contoursFromFile, hillshade, terrainFromFaces } from './terrain';
import type { SimModel } from './types';

export type WorkerRequest =
  | { id: number; kind: 'matrix'; model: SimModel; configIds: string[]; scenarioIds: string[] }
  | { id: number; kind: 'sweep'; model: SimModel; configId: string; scenarioId: string; circuitId: string; maxTrucks: number }
  | { id: number; kind: 'trace'; model: SimModel; configId: string; scenarioId: string; hours: number }
  | { id: number; kind: 'terrain'; file: File; mode: 'faces' | 'contours' };

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
    } else if (req.kind === 'terrain') {
      if (req.mode === 'faces') {
        const r = await terrainFromFaces(req.file, (f, stage) => post({ id: req.id, progress: f, stage }));
        if (!r) return post({ id: req.id, error: 'Nenhuma face 3DFACE encontrada no arquivo.' });
        const shade = hillshade(r.grid);
        const { z, ...meta } = r.grid;
        post({ id: req.id, result: { kind: 'grid', meta, z, shade, faces: r.faces } }, [z.buffer, shade.buffer]);
      } else {
        const c = await contoursFromFile(req.file, (f, stage) => post({ id: req.id, progress: f, stage }));
        if (!c) return post({ id: req.id, error: 'Nenhuma polilinha encontrada no arquivo.' });
        post({ id: req.id, result: { kind: 'contours', contours: c } });
      }
    }
  } catch (e) {
    post({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
};
