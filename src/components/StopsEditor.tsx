import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Route, RouteStop } from '@/types';

/** Paradas no trajeto de uma movimentação: pesagem, inspeção, abastecimento ou outra, com distância da origem, tempo e sentido. */

const KIND: Record<RouteStop['kind'], string> = { pesagem: 'Pesagem', inspecao: 'Inspeção', abastecimento: 'Abastecimento', outro: 'Outra (pedágio, portaria…)' };
const cell = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm';
const num = 'rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-right font-mono';

const StopsEditor: React.FC<{ route: Route; onChange: (stops: RouteStop[] | undefined) => void; compact?: boolean }> = ({ route, onChange, compact }) => {
  const list = route.stops ?? [];
  const set = (id: string, patch: Partial<RouteStop>) => onChange(list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const add = () =>
    onChange([...list, { id: `st-${Math.random().toString(36).slice(2, 8)}`, name: list.length ? `Parada ${list.length + 1}` : 'Balança', kind: list.length ? 'outro' : 'pesagem', distM: Math.round((route.distance || 0) / 2), stopMin: 1.5, dir: 'ambos', posts: 1 }]);
  const del = (id: string) => {
    const next = list.filter((s) => s.id !== id);
    onChange(next.length ? next : undefined);
  };
  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className={`w-full ${compact ? 'min-w-[560px]' : 'min-w-[720px]'} text-sm`}>
            <thead>
              <tr className="text-left text-[11px] text-black/45">
                <th className="px-1 py-1 font-medium">Parada</th>
                <th className="px-1 py-1 font-medium">Tipo</th>
                <th className="px-1 py-1 text-right font-medium">Distância da origem (m)</th>
                <th className="px-1 py-1 text-right font-medium">Tempo parado (min)</th>
                <th className="px-1 py-1 font-medium">Sentido</th>
                <th className="px-1 py-1 text-right font-medium">Postos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="border-t border-black/5">
                  <td className="px-1 py-1"><input className={cell} value={s.name} aria-label="Nome da parada" onChange={(e) => set(s.id, { name: e.target.value })} /></td>
                  <td className="px-1 py-1">
                    <select className={cell} value={s.kind} aria-label="Tipo da parada" onChange={(e) => set(s.id, { kind: e.target.value as RouteStop['kind'] })}>
                      {(Object.keys(KIND) as RouteStop['kind'][]).map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right">
                    <input type="number" min={0} max={route.distance || undefined} step={10} className={`${num} w-24 ${s.distM > (route.distance || 0) ? 'border-red-300' : ''}`} value={s.distM} aria-label="Distância da origem" onChange={(e) => set(s.id, { distM: Math.max(0, Number(e.target.value) || 0) })} />
                  </td>
                  <td className="px-1 py-1 text-right"><input type="number" min={0} step={0.1} className={`${num} w-20`} value={s.stopMin} aria-label="Tempo parado" onChange={(e) => set(s.id, { stopMin: Math.max(0, Number(e.target.value) || 0) })} /></td>
                  <td className="px-1 py-1">
                    <select className={cell} value={s.dir} aria-label="Sentido" onChange={(e) => set(s.id, { dir: e.target.value as RouteStop['dir'] })}>
                      <option value="ida">Na ida (carregado)</option>
                      <option value="volta">Na volta (vazio)</option>
                      <option value="ambos">Ida e volta</option>
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right"><input type="number" min={1} step={1} className={`${num} w-16`} value={s.posts ?? 1} aria-label="Postos" onChange={(e) => set(s.id, { posts: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></td>
                  <td className="px-1 py-1"><button type="button" onClick={() => del(s.id)} className="rounded p-1 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Apagar ${s.name}`}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-black/20 px-2.5 py-1 text-xs font-medium text-black/65 hover:bg-black/5">
        <Plus size={12} /> parada no trajeto
      </button>
      {list.length > 0 && <p className="text-[11px] text-black/45">O tempo parado entra no ciclo (uma vez por sentido). Na simulação, cada parada é um posto com fila no ponto do trajeto: com 1 posto, caminhões que chegam juntos esperam.</p>}
    </div>
  );
};

export default StopsEditor;
