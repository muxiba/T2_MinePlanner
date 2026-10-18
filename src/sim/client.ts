import type { WorkerRequest } from './worker';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (f: number, stage?: string) => void };
type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, progress, stage, result, error } = ev.data;
      const p = pending.get(id);
      if (!p) return;
      if (error) {
        pending.delete(id);
        p.reject(new Error(error));
      } else if (result !== undefined) {
        pending.delete(id);
        p.resolve(result);
      } else if (progress !== undefined) p.onProgress?.(progress, stage);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'Falha no processamento'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

/** Executa uma tarefa no Web Worker do simulador. */
export function runInWorker<T = any>(req: Req, onProgress?: (f: number, stage?: string) => void): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...req, id });
  });
}

/** Cancela tudo (ex.: o usuário saiu da tela). */
export function resetWorker() {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('Cancelado'));
  pending.clear();
}
