import React, { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DetailedPremises, FleetType, Route } from '@/types';
import { analyzeFleet, catalogOf } from '@/engine/fleet';
import { autoMix, fleetTypesOf, hourlyCost, mixedOn, typeOnRoute } from '@/engine/mix';
import { routeTargets } from '@/engine/fleet';

/**
 * Frota por tipo de caminhão (frota mista), nas Premissas Fundamentais.
 * O usuário informa quantos caminhões de cada modelo do catálogo tem; o sistema distribui pelas movimentações
 * (automático, pelo menor custo por tonelada e respeitando a via) ou o usuário define a composição de cada uma.
 */

const cell = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm';
const box = 'rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm text-right font-mono';
const fmtN = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const n2 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  premises: DetailedPremises;
  setPremises: (fn: (prev: DetailedPremises) => DetailedPremises) => void;
  routes: Route[];
  setRoutes: (fn: (prev: Route[]) => Route[]) => void;
}

const FleetTypesEditor: React.FC<Props> = ({ premises, setPremises, routes, setRoutes }) => {
  const cat = catalogOf(premises).trucks;
  const list = premises.fleetTypes ?? [];
  const mixed = mixedOn(premises);
  const mode = premises.mixMode ?? 'auto';
  const total = list.reduce((a, t) => a + Math.max(0, t.count || 0), 0);
  const label = (id: string) => {
    const c = cat.find((x) => x.id === id);
    return c ? `${c.manufacturer ? `${c.manufacturer} – ` : ''}${c.name}` : id;
  };

  const save = (next: FleetType[]) =>
    setPremises((p) => {
      const sum = next.reduce((a, t) => a + Math.max(0, t.count || 0), 0);
      const first = cat.find((c) => c.id === next[0]?.classId);
      // um tipo só: vira a classe e o número de caminhões das premissas (cálculo de sempre)
      if (next.length === 1 && first) return { ...p, fleetTypes: next, truckCount: sum, truckClassId: first.id, truckCapacity: first.payloadT, truckVolumeM3: first.volumeM3 };
      return { ...p, fleetTypes: next, truckCount: next.length ? sum : p.truckCount };
    });

  const start = () => {
    const base = cat.find((c) => c.id === premises.truckClassId) ?? cat[0];
    const other = cat.find((c) => c.id !== base?.id && (c.vehicle ?? 'mina') !== (base?.vehicle ?? 'mina')) ?? cat.find((c) => c.id !== base?.id);
    save([{ classId: base.id, count: premises.truckCount || 1 }, ...(other ? [{ classId: other.id, count: 1 }] : [])]);
  };

  const targets = useMemo(() => routeTargets(routes, premises), [routes, premises]);
  const analysis = useMemo(() => (mixed ? analyzeFleet(routes, premises) : null), [mixed, routes, premises]);
  const preview = useMemo(() => (mixed && mode !== 'manual' ? autoMix(routes, premises) : null), [mixed, mode, routes, premises]);
  const types = fleetTypesOf(premises);
  const used = new Map<string, number>();
  for (const r of routes) if (r.active) for (const [k, v] of Object.entries(r.mix ?? {})) used.set(k, (used.get(k) ?? 0) + v);

  const setMix = (rid: string, classId: string, n: number) => setRoutes((rs) => rs.map((r) => (r.id === rid ? { ...r, mix: { ...(r.mix ?? {}), [classId]: Math.max(0, n) } } : r)));

  return (
    <div className="space-y-3">
      <p className="text-xs text-black/55">
        Informe os caminhões que a operação tem, por modelo do catálogo. Com um tipo só, vale o caminhão acima. Com dois ou mais, cada movimentação recebe uma composição: o sistema escolhe pelo menor custo por tonelada
        (custo horário do modelo ÷ toneladas por hora naquela rota), sem pôr caminhão fora de estrada em estrada pública, ou você define a composição de cada movimentação.
      </p>
      {!list.length ? (
        <button type="button" onClick={start} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5">
          <Plus size={14} /> Usar frota mista (vários tipos de caminhão)
        </button>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-black/45">
                  <th className="px-1 py-1 font-medium">Modelo (catálogo)</th>
                  <th className="px-1 py-1 font-medium">Quantidade</th>
                  <th className="px-1 py-1 text-right font-medium">Carga útil (t)</th>
                  <th className="px-1 py-1 text-right font-medium">Tipo</th>
                  <th className="px-1 py-1 text-right font-medium">Custo por hora (R$)</th>
                  <th className="px-1 py-1 text-right font-medium">Em uso nas rotas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((t, i) => {
                  const c = cat.find((x) => x.id === t.classId);
                  return (
                    <tr key={i} className="border-t border-black/5">
                      <td className="px-1 py-1">
                        <select className={cell} value={t.classId} aria-label="Modelo" onChange={(e) => save(list.map((x, k) => (k === i ? { ...x, classId: e.target.value } : x)))}>
                          {cat.map((c2) => (
                            <option key={c2.id} value={c2.id}>{label(c2.id)}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1"><input type="number" min={0} className={`${box} w-24`} value={t.count} aria-label="Quantidade" onChange={(e) => save(list.map((x, k) => (k === i ? { ...x, count: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} /></td>
                      <td className="px-1 py-1 text-right tabular-nums">{c ? c.payloadT : '—'}</td>
                      <td className="px-1 py-1 text-right">{c?.vehicle === 'rodoviario' ? 'Rodoviário' : 'Fora de estrada'}</td>
                      <td className="px-1 py-1 text-right tabular-nums">{c ? t0(hourlyCost(c, premises)) : '—'}</td>
                      <td className={`px-1 py-1 text-right tabular-nums ${(used.get(t.classId) ?? 0) > t.count + 1e-6 ? 'font-semibold text-red-700' : ''}`}>{mixed ? `${fmtN(mode === 'estatistico' ? Math.max(0, Math.ceil((used.get(t.classId) ?? 0) - 1e-6)) : used.get(t.classId) ?? 0)} de ${t.count}` : '—'}</td>
                      <td className="px-1 py-1 text-right">
                        <button type="button" aria-label="Remover tipo" className="rounded p-1 text-black/40 hover:bg-red-50 hover:text-red-600" onClick={() => save(list.filter((_, k) => k !== i))}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/10 font-semibold">
                  <td className="px-1 py-1">Total da frota</td>
                  <td className="px-1 py-1 text-right tabular-nums">{total}</td>
                  <td colSpan={5} />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => save([...list, { classId: cat.find((c) => !list.some((t) => t.classId === c.id))?.id ?? cat[0].id, count: 1 }])} className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5">
              <Plus size={14} /> Adicionar tipo
            </button>
            <span className="ml-2 text-sm text-black/60">Distribuição pelas movimentações:</span>
            <select className="rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm" value={mode} aria-label="Modo de distribuição" onChange={(e) => setPremises((p) => ({ ...p, mixMode: e.target.value as 'auto' | 'manual' }))}>
              <option value="auto">Automática (menor custo por tonelada)</option>
              <option value="manual">Manual (eu defino por movimentação)</option>
              <option value="estatistico">Estatística (caminhões circulam entre as movimentações)</option>
            </select>
          </div>

          {mixed && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-black/45">
                    <th className="px-1 py-1 font-medium">Movimentação</th>
                    {types.map((t) => (
                      <th key={t.classId} className="px-1 py-1 text-right font-medium">{label(t.classId)}<br /><span className="font-normal">caminhões · R$/t</span></th>
                    ))}
                    <th className="px-1 py-1 text-right font-medium">Necessários (média)</th>
                    <th className="px-1 py-1 text-right font-medium">Capacidade / meta</th>
                  </tr>
                </thead>
                <tbody>
                  {routes.filter((r) => r.active).map((r) => {
                    const a = analysis?.routes.find((x) => x.id === r.id);
                    return (
                      <tr key={r.id} className="border-t border-black/5">
                        <td className="px-1 py-1">{r.name}{r.roadType === 'estrada' && <span className="block text-[11px] text-black/45">estrada pública: só rodoviários</span>}</td>
                        {types.map((t) => {
                          const blocked = r.roadType === 'estrada' && t.cls.vehicle !== 'rodoviario';
                          const perT = blocked ? null : typeOnRoute(r, premises, targets.get(r.id) || 0, t).costPerT;
                          const n = r.mix?.[t.classId] ?? 0;
                          return (
                            <td key={t.classId} className="px-1 py-1 text-right tabular-nums">
                              {blocked ? (
                                <span className="text-black/35">não entra</span>
                              ) : mode === 'manual' ? (
                                <input type="number" min={0} className={`${box} w-16`} value={n} aria-label={`${label(t.classId)} em ${r.name}`} onChange={(e) => setMix(r.id, t.classId, Math.round(Number(e.target.value) || 0))} />
                              ) : (
                                <b>{fmtN(preview?.get(r.id)?.[t.classId] ?? n)}</b>
                              )}
                              {perT !== null && Number.isFinite(perT) && <span className="ml-1 text-xs text-black/45">· {n2(perT)}</span>}
                            </td>
                          );
                        })}
                        <td className="px-1 py-1 text-right tabular-nums">{a ? n2(a.trucksNeededExact) : '—'}</td>
                        <td className={`px-1 py-1 text-right tabular-nums ${a && a.ratio < 1 ? 'font-semibold text-red-700' : ''}`}>{a ? `${t0(a.capacityWetT)} / ${t0(a.targetWetT)} t` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {mode === 'estatistico' && (
                <p className="mt-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  Estatística: os caminhões não ficam presos a uma rota. Cada movimentação recebe a fração de caminhão de que precisa (ex.: 2,4 caminhões), e a frota de cada tipo é a soma das frações arredondada para cima. Na simulação, use “Despacho dinâmico”: cada caminhão, ao terminar a viagem, vai para o circuito que está mais atrasado na meta.
                </p>
              )}
              <p className="mt-1 text-xs text-black/50">
                R$/t = custo por hora do modelo (propriedade, manutenção média na vida, diesel, pneus e operadores) ÷ toneladas por hora que ele faz nesta rota (carga útil própria e ciclo próprio). “Necessários (média)” usa a média ponderada dos tipos alocados.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default FleetTypesEditor;
