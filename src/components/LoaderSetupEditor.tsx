import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import type { DetailedPremises, FlowNode, LoaderClass, Route } from '@/types';
import { DEFAULT_LOOSE_DENSITY, analyzeFleet, catalogOf, effectiveLoaderId, loaderCycleSec, loaderLoading } from '@/engine/fleet';
import { fleetTypesOf } from '@/engine/mix';

/**
 * Equipamentos de carga: tempos de cada equipamento (carregar, giro, descarga, posicionamento),
 * caçambadas por tipo de caminhão e quantos equipamentos cada local (e cada movimentação) precisa.
 */

const box = 'rounded-lg border border-black/10 bg-white px-2 py-1 text-sm text-right font-mono';
const sel = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm';
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const pc = (n: number) => `${Math.round(n * 100)}%`;
const lname = (l: LoaderClass) => `${l.manufacturer ? `${l.manufacturer} – ` : ''}${l.name}`;

interface Props {
  premises: DetailedPremises;
  setPremises: (fn: (prev: DetailedPremises) => DetailedPremises) => void;
}

/** Escolha do equipamento de carga de um local: o padrão de Transporte / Frota, o tempo das premissas, silo ou um modelo do catálogo. */
export const LoaderSelect: React.FC<{ premises: DetailedPremises; value?: string; onChange: (v: string | undefined) => void; label: string; className?: string }> = ({ premises, value, onChange, label, className }) => {
  const cat = catalogOf(premises);
  const def = premises.defaultLoaderClassId;
  const defName = def === 'silo' ? 'silo / correia' : cat.loaders.find((l) => l.id === def)?.name;
  return (
    <select className={className ?? sel} value={value ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{def && defName ? `Padrão: ${defName}` : 'Tempo de carga das premissas'}</option>
      {(def || value === 'tempo') && <option value="tempo">Tempo de carga das premissas</option>}
      <option value="silo">Silo / correia (sem equipamento)</option>
      {cat.loaders.map((l) => <option key={l.id} value={l.id}>{lname(l)}</option>)}
    </select>
  );
};

const setLoader = (setPremises: Props['setPremises'], id: string, patch: Partial<LoaderClass>) =>
  setPremises((p) => {
    const c = catalogOf(p);
    return { ...p, equipmentCatalog: { ...c, loaders: c.loaders.map((l) => (l.id === id ? { ...l, ...patch } : l)) } };
  });

/** Campos operacionais de um equipamento (caçamba, enchimento, partes do ciclo, posicionamento, DF), em uma linha. */
const LoaderCells: React.FC<{ l: LoaderClass; premises: DetailedPremises; setPremises: Props['setPremises'] }> = ({ l, premises, setPremises }) => {
  const numIn = (k: keyof LoaderClass, step: number, placeholder?: string, w = 'w-16') => (
    <input
      type="number"
      step={step}
      min={0}
      className={`${box} ${w}`}
      value={(l[k] as number | undefined) ?? ''}
      placeholder={placeholder}
      aria-label={`${String(k)} de ${l.name}`}
      onChange={(e) => setLoader(setPremises, l.id, { [k]: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) } as Partial<LoaderClass>)}
    />
  );
  const parts = [l.digSec, l.swingLoadedSec, l.dumpSec, l.swingEmptySec].some((v) => v && v > 0);
  return (
    <>
      <td className="px-1 py-1 text-right">{numIn('bucketM3', 0.1)}</td>
      <td className="px-1 py-1 text-right">{numIn('fillFactor', 5, '90')}</td>
      <td className="px-1 py-1 text-right">{numIn('digSec', 1, '—')}</td>
      <td className="px-1 py-1 text-right">{numIn('swingLoadedSec', 1, '—')}</td>
      <td className="px-1 py-1 text-right">{numIn('dumpSec', 1, '—')}</td>
      <td className="px-1 py-1 text-right">{numIn('swingEmptySec', 1, '—')}</td>
      <td className="px-1 py-1 text-right">{parts ? <b className="font-mono">{t0(loaderCycleSec(l))}</b> : numIn('cycleSec', 1)}</td>
      <td className="px-1 py-1 text-right">{numIn('spotMin', 0.1, String(premises.loaderSpotMin ?? 0.5))}</td>
      <td className="px-1 py-1 text-right">{numIn('dfPct', 1, String(premises.dfMina ?? 85))}</td>
    </>
  );
};

const HEAD_CELLS = ['Caçamba (m³)', 'Enchimento (%)', 'Carregar (s)', 'Giro carregado (s)', 'Descarga (s)', 'Giro vazio (s)', 'Ciclo (s)', 'Posicionamento (min)', 'DF (%)'];

/** Equipamentos em uso (escolhidos em algum local ou como padrão). */
const usedLoaderIds = (premises: DetailedPremises) =>
  new Set([...(premises.nodes ?? []).map((n) => effectiveLoaderId(n, premises)), premises.defaultLoaderClassId].filter((x): x is string => !!x && x !== 'silo'));

/** Tempos de cada equipamento e caçambadas por tipo de caminhão. */
export const LoaderTimesEditor: React.FC<Props> = ({ premises, setPremises }) => {
  const cat = catalogOf(premises);
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : DEFAULT_LOOSE_DENSITY;
  const trucks = fleetTypesOf(premises);
  const usedIds = usedLoaderIds(premises);
  const list = [...cat.loaders].sort((a, b) => Number(usedIds.has(b.id)) - Number(usedIds.has(a.id)));
  const spot = premises.loaderSpotMin ?? 0.5;
  const add = () =>
    setPremises((p) => {
      const c = catalogOf(p);
      return { ...p, equipmentCatalog: { ...c, loaders: [...c.loaders, { id: `car-${Math.random().toString(36).slice(2, 8)}`, name: 'Novo equipamento de carga', manufacturer: '', bucketM3: 2, cycleSec: 22, fillFactor: 90, price: 1_500_000, lifeYears: 5, hoursPerYear: 5000, residualPct: 20, maintPerH: 95, maintEscPctYear: 8, dieselLph: 24 }] } };
    });
  const remove = (l: LoaderClass) => {
    if (!confirm(`Apagar “${l.name}” do catálogo?${usedIds.has(l.id) ? ' Os locais que usam este equipamento voltam para o padrão / tempo de carga das premissas.' : ''}`)) return;
    setPremises((p) => {
      const c = catalogOf(p);
      return {
        ...p,
        defaultLoaderClassId: p.defaultLoaderClassId === l.id ? undefined : p.defaultLoaderClassId,
        nodes: (p.nodes ?? []).map((n) => (n.loaderClassId === l.id ? { ...n, loaderClassId: undefined, loaderCount: undefined } : n)),
        equipmentCatalog: { ...c, loaders: c.loaders.filter((x) => x.id !== l.id) },
      };
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-black/55">
        Ciclo de uma caçambada = carregar (encher a caçamba) + giro carregado + descarga no caminhão + giro vazio. Se as partes ficarem vazias, vale o ciclo total. Tempo de carga do caminhão = posicionamento + caçambadas × ciclo; caçambadas = carga útil ÷ (caçamba × enchimento × densidade solta {n2(density)} t/m³), arredondado para cima.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="text-left text-[11px] text-black/45">
              <th className="px-1 py-1 font-medium">Equipamento</th>
              {HEAD_CELLS.map((h) => <th key={h} className="px-1 py-1 text-right font-medium">{h}</th>)}
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id} className="border-t border-black/5">
                <td className="px-1 py-1">
                  <div className="flex items-center gap-1.5">
                    <input className="w-56 rounded-lg border border-black/10 bg-white px-2 py-1 text-sm" value={l.name} aria-label="Nome do equipamento" onChange={(e) => setLoader(setPremises, l.id, { name: e.target.value })} />
                    {usedIds.has(l.id) && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">em uso</span>}
                  </div>
                </td>
                <LoaderCells l={l} premises={premises} setPremises={setPremises} />
                <td className="px-1 py-1 text-right">
                  <button type="button" onClick={() => remove(l)} className="rounded p-1 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Apagar ${l.name}`}><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5"><Plus size={14} /> Novo equipamento de carga</button>

      <div>
        <p className="mb-1 text-sm font-semibold text-black/70">Caçambadas e tempo de carga por caminhão</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-[11px] text-black/45">
                <th className="px-1 py-1 font-medium">Equipamento</th>
                {trucks.map((t) => (
                  <th key={t.classId} className="px-1 py-1 text-right font-medium">{t.cls.name}<br /><span className="font-normal">{t.cls.payloadT} t · caçambadas · min</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((l) => (
                <tr key={l.id} className="border-t border-black/5">
                  <td className="px-1 py-1">{lname(l)}</td>
                  {trucks.map((t) => {
                    const payload = t.cls.volumeM3 > 0 ? Math.min(t.cls.payloadT, t.cls.volumeM3 * density) : t.cls.payloadT;
                    const x = loaderLoading({ bucketM3: l.bucketM3, fillFactor: l.fillFactor ?? 90, cycleSec: loaderCycleSec(l) }, payload, density);
                    const min = x.loadMin + (l.spotMin ?? spot);
                    return (
                      <td key={t.classId} className={`px-1 py-1 text-right font-mono tabular-nums ${x.passesStatus === 'ok' ? '' : 'text-amber-700'}`}>
                        {x.passes} · {n1(min)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-black/45">Ideal de 3 a 6 caçambadas por caminhão; em âmbar fora disso (equipamento pequeno demais ou grande demais para o caminhão).</p>
      </div>
    </div>
  );
};

/** Equipamentos de carga por local e por movimentação: escolha, quantidade disponível e necessários. */
export const LoaderNeedsTable: React.FC<Props & { routes: Route[] }> = ({ premises, setPremises, routes }) => {
  const cat = catalogOf(premises);
  const fa = useMemo(() => analyzeFleet(routes, premises), [routes, premises]);
  const nodes = (premises.nodes ?? []).filter((n) => routes.some((r) => r.active && r.fromId === n.id));
  const setNode = (id: string, patch: Partial<FlowNode>) => setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const own = fa.loaderNeeds.filter((l) => l.source === 'rota');
  const [editing, setEditing] = useState<string | null>(null);
  if (!nodes.length && !own.length) return <p className="text-sm text-black/50">Crie as movimentações em 1. Premissas → Locais e movimentações.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-xs text-black/45">
            <th className="py-1.5 pr-2 font-medium">Local / movimentação</th>
            <th className="py-1.5 pr-2 font-medium">Equipamento de carga</th>
            <th className="py-1.5 pr-2 text-right font-medium">Caçambadas</th>
            <th className="py-1.5 pr-2 text-right font-medium">Carga (min)</th>
            <th className="py-1.5 pr-2 text-right font-medium">Caminhões / mês</th>
            <th className="py-1.5 pr-2 text-right font-medium">Horas de carga</th>
            <th className="py-1.5 pr-2 text-right font-medium">Necessários</th>
            <th className="py-1.5 pr-2 text-right font-medium">Disponíveis</th>
            <th className="py-1.5 text-right font-medium">Ocupação</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const eff = effectiveLoaderId(n, premises);
            const effL = eff && eff !== 'silo' ? cat.loaders.find((l) => l.id === eff) : undefined;
            const need = fa.loaderNeeds.find((l) => l.nodeId === n.id);
            const short = need && need.available !== null && need.available < need.needed;
            return (
              <React.Fragment key={n.id}>
                <tr className="border-t border-black/10 align-top">
                  <td className="py-1.5 pr-2 font-medium">{n.name}<span className="block text-[11px] font-normal text-black/45">local de carregamento</span></td>
                  <td className="py-1.5 pr-2">
<LoaderSelect premises={premises} value={n.loaderClassId} label={`Equipamento de carga em ${n.name}`} onChange={(v) => setNode(n.id, { loaderClassId: v })} />
                  </td>
                  {need ? (
                    <>
                      <td className={`py-1.5 pr-2 text-right font-mono tabular-nums ${need.passes > 6.5 || need.passes < 2.5 ? 'text-amber-700' : ''}`}>{n1(need.passes)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{n1(need.loadMin)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(need.trucksLoaded)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(need.busyH)}</td>
                      <td className="py-1.5 pr-2 text-right font-mono font-bold tabular-nums">{need.needed} <span className="font-normal text-black/40">({n2(need.neededExact)})</span></td>
                    </>
                  ) : (
                    <td colSpan={5} className="py-1.5 pr-2 text-xs text-black/45">{eff === 'silo' ? 'carga por silo/correia: sem equipamento a dimensionar' : 'tempo de carga das premissas: escolha um equipamento para dimensionar'}</td>
                  )}
                  <td className="py-1.5 pr-2 text-right">
                    {effL ? (
                      <input type="number" min={0} step={1} className={`${box} w-20 ${short ? 'border-red-300 text-red-700' : ''}`} value={n.loaderCount ?? ''} placeholder="calcular" aria-label={`Equipamentos disponíveis em ${n.name}`} onChange={(e) => setNode(n.id, { loaderCount: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} />
                    ) : <span className="text-black/30">—</span>}
                  </td>
                  <td className={`py-1.5 text-right font-mono tabular-nums ${need && need.utilization > 0.85 ? 'text-amber-700' : ''}`}>{need ? pc(need.utilization) : '—'}</td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {effL && (
                      <button type="button" onClick={() => setEditing(editing === n.id ? null : n.id)} className="rounded p-1 text-black/40 hover:bg-black/5" aria-label={`Editar ${effL.name}`} title="Editar os tempos deste equipamento">
                        {editing === n.id ? <X size={14} /> : <Pencil size={14} />}
                      </button>
                    )}
                    {((n.loaderClassId && n.loaderClassId !== 'tempo') || eff) && (
                      <button type="button" onClick={() => setNode(n.id, { loaderClassId: n.loaderClassId && n.loaderClassId !== 'tempo' && premises.defaultLoaderClassId ? undefined : 'tempo', loaderCount: undefined })} className="rounded p-1 text-black/40 hover:bg-red-50 hover:text-red-600" aria-label={`Remover equipamento de ${n.name}`} title={n.loaderClassId && n.loaderClassId !== 'tempo' && premises.defaultLoaderClassId ? 'Remover: volta para o equipamento padrão' : 'Remover: usa o tempo de carga das premissas'}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
                {editing === n.id && effL && (
                  <tr className="bg-black/[0.02]">
                    <td colSpan={10} className="px-2 py-2">
                      <p className="mb-1 text-xs text-black/55">Tempos de <b>{lname(effL)}</b> (vale para todos os locais que usam este equipamento):</p>
                      <div className="overflow-x-auto">
                        <table className="text-sm">
                          <thead>
                            <tr className="text-left text-[11px] text-black/45">{HEAD_CELLS.map((h) => <th key={h} className="px-1 py-1 text-right font-medium">{h}</th>)}</tr>
                          </thead>
                          <tbody>
                            <tr><LoaderCells l={effL} premises={premises} setPremises={setPremises} /></tr>
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
                {need?.perRoute && need.perRoute.length > 1 &&
                  need.perRoute.map((pr) => (
                    <tr key={pr.routeId} className="text-xs text-black/60">
                      <td className="py-1 pr-2 pl-4">↳ {pr.name}</td>
                      <td />
                      <td />
                      <td />
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">{t0(pr.trucksLoaded)}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">{t0(pr.busyH)}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">{n2(pr.neededExact)}</td>
                      <td />
                      <td />
                      <td />
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
          {own.map((l) => (
            <tr key={l.where} className="border-t border-black/10">
              <td className="py-1.5 pr-2 font-medium">{l.where}<span className="block text-[11px] font-normal text-black/45">equipamento próprio da rota</span></td>
              <td className="py-1.5 pr-2">{l.loaderName}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{n1(l.passes)}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{n1(l.loadMin)}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(l.trucksLoaded)}</td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{t0(l.busyH)}</td>
              <td className="py-1.5 pr-2 text-right font-mono font-bold tabular-nums">{l.needed} <span className="font-normal text-black/40">({n2(l.neededExact)})</span></td>
              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{l.available ?? '—'}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">{pc(l.utilization)}</td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-black/45">
        Necessários = horas de carga no mês (caminhões carregados × tempo de carga) ÷ horas efetivas de um equipamento (calendário × DF do equipamento × UF). Com mais de uma movimentação saindo do mesmo local, cada linha ↳ mostra a parte de cada fluxo. Ocupação acima de ~85% forma fila na carga; a simulação mede essa fila.
      </p>
    </div>
  );
};
