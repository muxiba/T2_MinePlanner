import React, { useMemo, useState } from 'react';
import StopsEditor from './StopsEditor';
import GeoImport from './GeoImport';
import { Plus, Trash2 } from 'lucide-react';
import type { DetailedPremises, FlowNode, Route } from '@/types';
import { analyzeFleet, routeTargets } from '@/engine/fleet';

/**
 * Modo só transporte: as movimentações em tabela — nome, origem, destino, material, massa, DMT, via e tempos.
 * Origem e destino são digitados pelo nome; um nome novo cria o local no desenho.
 */

const cell = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm';
const num = 'rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-right font-mono';
const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

interface Props {
  premises: DetailedPremises;
  setPremises: (fn: (prev: DetailedPremises) => DetailedPremises) => void;
  routes: Route[];
  setRoutes: (fn: (prev: Route[]) => Route[]) => void;
}

const TransportTable: React.FC<Props> = ({ premises, setPremises, routes, setRoutes }) => {
  const nodes = premises.nodes ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const periods = (premises.simulation?.plan?.periods ?? []).map((p) => p.label);
  const fa = useMemo(() => analyzeFleet(routes, premises), [routes, premises]);
  const masses = useMemo(() => routeTargets(routes, premises), [routes, premises]);
  const nameOf = (id?: string) => nodes.find((n) => n.id === id)?.name ?? '';
  const setRoute = (id: string, patch: Partial<Route>) => setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const origins = nodes.filter((n) => n.group === 'origem' || n.group === 'passagem');
  const dests = nodes.filter((n) => n.group === 'passagem' || n.group === 'destino');

  /** local pelo nome: o existente (dos grupos aceitos) ou um novo no grupo indicado */
  const placeFor = (name: string, accept: FlowNode['group'][], group: 'origem' | 'destino'): { id: string; created?: FlowNode } => {
    const nm = name.trim();
    const found = nodes.find((n) => n.name.trim().toLowerCase() === nm.toLowerCase() && accept.includes(n.group));
    if (found) return { id: found.id };
    const n: FlowNode = { id: newId(group === 'origem' ? 'orig' : 'dest'), name: nm, type: group === 'origem' ? 'frente' : 'expedicao', group };
    return { id: n.id, created: n };
  };
  const autoName = (r: Route, from: string, to: string) => (!r.name || r.name.includes('→') ? `${from} → ${to}` : r.name);
  const setEnd = (r: Route, side: 'from' | 'to', name: string) => {
    if (!name.trim()) return;
    const curId = side === 'from' ? r.fromId : r.toId;
    const onlyHere = !!curId && routes.filter((x) => x.fromId === curId || x.toId === curId).length === 1;
    const taken = nodes.some((n) => n.id !== curId && n.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (onlyHere && !taken) {
      // o local só é usado aqui: renomeia em vez de criar outro
      setPremises((pr) => ({ ...pr, nodes: (pr.nodes ?? []).map((n) => (n.id === curId ? { ...n, name: name.trim() } : n)) }));
      const from = side === 'from' ? name.trim() : nameOf(r.fromId);
      const to = side === 'to' ? name.trim() : nameOf(r.toId);
      setRoute(r.id, { name: autoName(r, from, to) });
      return;
    }
    const p = side === 'from' ? placeFor(name, ['origem', 'passagem'], 'origem') : placeFor(name, ['passagem', 'destino'], 'destino');
    if (p.created) setPremises((pr) => ({ ...pr, nodes: [...(pr.nodes ?? []), p.created!] }));
    const from = side === 'from' ? name.trim() : nameOf(r.fromId);
    const to = side === 'to' ? name.trim() : nameOf(r.toId);
    setRoute(r.id, side === 'from' ? { fromId: p.id, name: autoName(r, from, to) } : { toId: p.id, name: autoName(r, from, to) });
  };
  const add = () => {
    const k = routes.length + 1;
    const o: FlowNode = { id: newId('orig'), name: `Origem ${k}`, type: 'frente', group: 'origem' };
    const d: FlowNode = { id: newId('dest'), name: `Destino ${k}`, type: 'expedicao', group: 'destino' };
    setPremises((p) => ({ ...p, nodes: [...(p.nodes ?? []), o, d] }));
    setRoutes((rs) => [
      ...rs,
      { ...(rs[0] ?? {}), id: newId('mov'), name: `${o.name} → ${d.name}`, kind: 'rom', materialName: 'Minério', fromId: o.id, toId: d.id, active: true, truckCount: 0, truckCapacity: premises.truckCapacity, distance: 1000, cycleTime: 20, mechanicalAvailability: premises.dfMina, operationalEfficiency: 100, processType: premises.processType, fleetMode: 'inteiro', targetMass: undefined, share: undefined, mix: undefined, loader: undefined, loadMin: undefined, dumpMin: undefined } as Route,
    ]);
  };
  const del = (r: Route) => {
    if (!confirm(`Apagar a movimentação “${r.name}”?`)) return;
    setRoutes((rs) => rs.filter((x) => x.id !== r.id));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-black/70">Movimentações de transporte</p>
        <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-lg bg-[#151619] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black">
          <Plus size={14} /> Adicionar movimentação
        </button>
      </div>
      <datalist id="tt-origens">{origins.map((n) => <option key={n.id} value={n.name} />)}</datalist>
      <datalist id="tt-destinos">{dests.map((n) => <option key={n.id} value={n.name} />)}</datalist>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1250px] text-sm">
          <thead>
            <tr className="text-left text-[11px] text-black/45">
              <th className="px-1 py-1 font-medium">Nome</th>
              <th className="px-1 py-1 font-medium">Origem</th>
              <th className="px-1 py-1 font-medium">Destino</th>
              <th className="px-1 py-1 font-medium">Material</th>
              <th className="px-1 py-1 text-right font-medium">Massa (t seca/mês)</th>
              <th className="px-1 py-1 text-right font-medium">DMT (m)</th>
              <th className="px-1 py-1 font-medium">Via</th>
              <th className="px-1 py-1 text-right font-medium">Carga (min)</th>
              <th className="px-1 py-1 text-right font-medium">Descarga (min)</th>
              <th className="px-1 py-1 font-medium">Paradas / mapa</th>
              <th className="px-1 py-1 text-right font-medium">Ciclo (min)</th>
              <th className="px-1 py-1 text-right font-medium">Caminhões</th>
              <th className="px-1 py-1 font-medium">Ativa</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => {
              const a = fa.routes.find((x) => x.id === r.id);
              return (
                <React.Fragment key={r.id}>
                <tr className={`border-t border-black/5 ${r.active ? '' : 'opacity-50'}`}>
                  <td className="px-1 py-1"><input className={cell} value={r.name} aria-label="Nome da movimentação" onChange={(e) => setRoute(r.id, { name: e.target.value })} /></td>
                  <td className="px-1 py-1"><input key={`${r.id}-f-${r.fromId}`} className={cell} list="tt-origens" defaultValue={nameOf(r.fromId)} aria-label="Origem" onBlur={(e) => e.target.value !== nameOf(r.fromId) && setEnd(r, 'from', e.target.value)} /></td>
                  <td className="px-1 py-1"><input key={`${r.id}-t-${r.toId}`} className={cell} list="tt-destinos" defaultValue={nameOf(r.toId)} aria-label="Destino" onBlur={(e) => e.target.value !== nameOf(r.toId) && setEnd(r, 'to', e.target.value)} /></td>
                  <td className="px-1 py-1"><input className={cell} value={r.materialName ?? ''} placeholder="minério…" aria-label="Material" onChange={(e) => setRoute(r.id, { materialName: e.target.value })} /></td>
                  <td className="px-1 py-1 text-right"><input type="number" step={1000} min={0} className={`${num} w-32 ${!(masses.get(r.id) ?? 0) ? 'border-red-300' : ''}`} value={r.targetMass ?? ''} placeholder={(masses.get(r.id) ?? 0) > 0 ? `${t0(masses.get(r.id)!)} (meta)` : 'obrigatória'} aria-label="Massa do mês" onChange={(e) => setRoute(r.id, { targetMass: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></td>
                  <td className="px-1 py-1 text-right"><input type="number" step={10} min={0} className={`${num} w-24`} value={r.distance} aria-label="DMT" onChange={(e) => setRoute(r.id, { distance: Math.max(0, Number(e.target.value) || 0) })} /></td>
                  <td className="px-1 py-1">
                    <select className={`${cell} w-28`} value={r.roadType ?? 'interna'} aria-label="Via" onChange={(e) => setRoute(r.id, { roadType: e.target.value as 'interna' | 'estrada' })}>
                      <option value="interna">Interna</option>
                      <option value="estrada">Estrada pública</option>
                    </select>
                  </td>
                  <td className="px-1 py-1 text-right"><input type="number" step={0.1} min={0} className={`${num} w-20`} value={r.loadMin ?? ''} placeholder={a ? n1(a.cycle.loadMin) : String(premises.loadingTime)} title="Vazio = o equipamento do local ou o tempo de carga das premissas" aria-label="Tempo de carga" onChange={(e) => setRoute(r.id, { loadMin: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></td>
                  <td className="px-1 py-1 text-right"><input type="number" step={0.1} min={0} className={`${num} w-20`} value={r.dumpMin ?? ''} placeholder={String(premises.dumpingTime)} title="Vazio = o tempo de basculamento das premissas" aria-label="Tempo de descarga" onChange={(e) => setRoute(r.id, { dumpMin: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></td>
                  <td className="px-1 py-1">
                    <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="whitespace-nowrap rounded-lg border border-black/10 px-2 py-1 text-xs hover:bg-black/5">
                      {r.stops?.length ? `${r.stops.length} parada(s) · ${n1(r.stops.reduce((s2, x) => s2 + x.stopMin * (x.dir === 'ambos' ? 2 : 1), 0))} min` : '+ parada'}{r.geo?.length ? ' · DXF' : ' · + DXF'}
                    </button>
                  </td>
                  <td className="px-1 py-1 text-right font-mono tabular-nums">{a ? n1(a.cycle.totalMin) : '—'}</td>
                  <td className="px-1 py-1 text-right font-mono tabular-nums">{a ? `${t0(a.trucksAllocated)} (${n1(a.trucksNeededExact)})` : '—'}</td>
                  <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.active} aria-label="Movimentação ativa" onChange={(e) => setRoute(r.id, { active: e.target.checked })} /></td>
                  <td className="px-1 py-1"><button type="button" onClick={() => del(r)} className="rounded-lg p-1.5 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Apagar ${r.name}`}><Trash2 size={14} /></button></td>
                </tr>
                {open === r.id && (
                  <tr className="bg-black/[0.02]">
                    <td colSpan={14} className="px-2 py-2">
                      <p className="mb-1 text-xs text-black/55">Paradas no trajeto de <b>{r.name}</b> (DMT {t0(r.distance)} m):</p>
                      <StopsEditor route={r} onChange={(stops) => setRoute(r.id, { stops })} />
                      <p className="mb-1 mt-3 text-xs text-black/55">Mapa (DXF) de origem, destino e trajeto:</p>
                      <GeoImport route={r} periods={periods} onChange={(nr) => setRoutes((rs) => rs.map((x) => (x.id === r.id ? nr : x)))} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-black/10 font-semibold">
              <td className="px-1 py-1" colSpan={4}>Total</td>
              <td className="px-1 py-1 text-right font-mono tabular-nums">{t0(routes.filter((r) => r.active).reduce((s, r) => s + (masses.get(r.id) ?? 0), 0))}</td>
              <td colSpan={9} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-black/45">
        Origem e destino: digite o nome (um nome novo cria o local no desenho) ou escolha um existente. Massa em t seca por mês; a umidade das premissas converte para a massa úmida transportada. Carga e descarga vazias usam o equipamento do local (Carga e ciclo) ou os tempos das premissas; o ciclo soma também ida e volta pelo DMT e velocidades, pesagem, fila e interferências.
      </p>
    </div>
  );
};

export default TransportTable;
