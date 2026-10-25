import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import type { DetailedPremises, FlowNode, LoadUse, LoaderClass, Route } from '@/types';
import { DEFAULT_LOOSE_DENSITY, analyzeFleet, catalogOf, entryClassId, loadOwner, loadUseKeys, loadUseOf, loaderCycleSec, loaderLoading, nodeLoaderEntries, routeTargets, useClassId } from '@/engine/fleet';
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
  new Set(
    [
      ...(premises.nodes ?? []).flatMap((n) => [...Object.values(n.loadUses ?? {}).map((u) => useClassId(u, premises)), ...nodeLoaderEntries(n).map((e) => entryClassId(e, premises))]),
      premises.defaultLoaderClassId,
    ].filter((x): x is string => !!x && x !== 'silo'),
  );

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
        nodes: (p.nodes ?? []).map((n) => ({
          ...(n.loaderClassId === l.id ? { ...n, loaderClassId: undefined, loaderCount: undefined } : n),
          ...(n.loaders ? { loaders: n.loaders.map((e) => (e.classId === l.id ? { ...e, classId: undefined, count: undefined } : e)) } : {}),
        })),
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

const GROUP_ORDER: Record<string, number> = { origem: 0, mina: 1, transbordo: 2, passagem: 3, planta: 4, produto: 5, rejeito: 6, esteril: 7, destino: 8 };

/**
 * Equipamentos de carga por local e por fluxo, na ordem da rede: em cada local, “Alimentar” (planta e transbordo)
 * e uma linha por movimentação que sai dele. Cada linha tem equipamento próprio, usa o mesmo de outra linha
 * do local (as horas se somam), o tempo das premissas ou silo / correia.
 */
export const LoaderNeedsTable: React.FC<Props & { routes: Route[] }> = ({ premises, setPremises, routes }) => {
  const cat = catalogOf(premises);
  const fa = useMemo(() => analyzeFleet(routes, premises), [routes, premises]);
  const masses = useMemo(() => routeTargets(routes, premises), [routes, premises]);
  const [editing, setEditing] = useState<string | null>(null);
  const all = premises.nodes ?? [];
  const nodes = all
    .filter((n) => loadUseKeys(n, routes).length && (routes.some((r) => r.active && r.fromId === n.id) || routes.some((r) => r.active && r.toId === n.id)))
    .map((n, i) => ({ n, i, g: GROUP_ORDER[(n.transfer && n.type === 'estoque' && n.group !== 'passagem' ? 'transbordo' : n.group && GROUP_ORDER[n.group] !== undefined ? n.group : n.type === 'frente' ? 'mina' : n.type === 'planta' ? 'planta' : n.type === 'expedicao' ? 'produto' : n.type === 'rejeito' ? 'rejeito' : n.type === 'esteril' ? 'esteril' : 'mina')] ?? 9 }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map((x) => x.n);
  const own = fa.loaderNeeds.filter((l) => l.source === 'rota');
  if (!nodes.length && !own.length) return <p className="text-sm text-black/50">Nenhuma movimentação ativa. Crie as movimentações em 1. Premissas → Locais e movimentações{premises.flowMode === 'transporte' ? ' (ou na tabela de movimentações de transporte em Processo e massas)' : ''}.</p>;
  const nameCount = new Map<string, number>();
  for (const n of nodes) nameCount.set(n.name, (nameCount.get(n.name) ?? 0) + 1);
  const seen = new Map<string, number>();

  const setUse = (n: FlowNode, key: string, patch: Partial<LoadUse>) =>
    setPremises((p) => ({
      ...p,
      nodes: (p.nodes ?? []).map((x) => {
        if (x.id !== n.id) return x;
        // grava todos os usos atuais (inclusive os que vinham do formato antigo) e aplica a mudança
        const keys = loadUseKeys(x, routes);
        const uses: Record<string, LoadUse> = {};
        for (const k of keys) uses[k] = loadUseOf(x, k, keys);
        uses[key] = { ...uses[key], ...patch };
        if (patch.mode && patch.mode !== 'share') delete uses[key].shareWith;
        return { ...x, loadUses: uses, loaders: undefined, loaderClassId: undefined, loaderCount: undefined };
      }),
    }));
  const useLabel = (key: string) => (key === 'feed' ? 'Alimentar' : `Carga → ${all.find((x) => x.id === routes.find((r) => r.id === key)?.toId)?.name ?? routes.find((r) => r.id === key)?.name ?? ''}`);
  const matOf = (key: string) => {
    const r = routes.find((x) => x.id === key);
    return r ? (r.materialName || ({ rom: 'ROM', product: 'produto', tailings: 'rejeito', waste: 'estéril / descarte' } as Record<string, string>)[r.kind ?? 'rom']) : '';
  };
  const totals = new Map<string, { needed: number; available: number; anyAvail: boolean }>();
  for (const l of fa.loaderNeeds) {
    const t = totals.get(l.loaderName) ?? { needed: 0, available: 0, anyAvail: false };
    t.needed += l.needed;
    if (l.available !== null) {
      t.available += l.available;
      t.anyAvail = true;
    }
    totals.set(l.loaderName, t);
  }

  return (
    <div className="space-y-3">
      {nodes.map((n) => {
        const keys = loadUseKeys(n, routes);
        const k = (seen.get(n.name) ?? 0) + 1;
        seen.set(n.name, k);
        const dup = (nameCount.get(n.name) ?? 0) > 1;
        const bal = fa.loaderNeeds.filter((l) => l.nodeId === n.id);
        const inT = routes.filter((r) => r.active && r.toId === n.id).reduce((a, r) => a + (masses.get(r.id) ?? 0), 0);
        const outT = routes.filter((r) => r.active && r.fromId === n.id).reduce((a, r) => a + (masses.get(r.id) ?? 0), 0);
        const head = inT > 0.5 ? `recebe ${t0(inT)} t` : outT > 0.5 ? `gera ${t0(outT)} t` : '';
        return (
          <div key={n.id} className={`rounded-xl border p-3 ${n.transfer ? 'border-amber-200 bg-amber-50/30' : 'border-black/[0.08] bg-white'}`}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-black/80">
                {n.name}
                {dup && <span className="ml-1 text-xs font-normal text-black/45">({n.type === 'frente' ? 'frente' : 'local'} {k})</span>}
                {n.transfer && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">transbordo{n.transfer.discardPct ? ` · descarte ${n.transfer.discardPct}%` : ''}</span>}
              </p>
              <span className="text-xs text-black/50">{head}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-black/45">
                    <th className="py-1 pr-2 font-medium">Uso</th>
                    <th className="py-1 pr-2 font-medium">Como é atendido</th>
                    <th className="py-1 pr-2 font-medium">Equipamento</th>
                    <th className="py-1 pr-2 text-right font-medium">Disponíveis</th>
                    <th className="py-1 pr-2 text-right font-medium">Caçambadas</th>
                    <th className="py-1 pr-2 text-right font-medium">Carga / produção</th>
                    <th className="py-1 pr-2 text-right font-medium">Horas</th>
                    <th className="py-1 pr-2 text-right font-medium">Necessários</th>
                    <th className="py-1 text-right font-medium">Ocupação</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => {
                    const u = loadUseOf(n, key, keys);
                    const owner = loadOwner(n, key, keys);
                    const need = bal.find((l) => l.entryId === owner.key);
                    const part = need?.perRoute?.find((p) => p.routeId === key);
                    const lid = useClassId(owner.use, premises);
                    const effL = lid && lid !== 'silo' ? cat.loaders.find((l) => l.id === lid) : undefined;
                    const ownRows = keys.filter((x) => x !== key && loadUseOf(n, x, keys).mode === 'own');
                    const ek = `${n.id}:${key}`;
                    const isOwner = u.mode === 'own';
                    return (
                      <React.Fragment key={key}>
                        <tr className="border-t border-black/5 align-middle">
                          <td className="py-1.5 pr-2">
                            <span className="font-medium">{useLabel(key)}</span>
                            <span className="block text-[11px] text-black/45">{key === 'feed' ? (n.type === 'planta' ? 'pátio → alimentador da planta (sem caminhão)' : 'pátio → planta móvel (sem caminhão)') : `${matOf(key)} · ${t0(masses.get(key) ?? 0)} t`}</span>
                          </td>
                          <td className="py-1.5 pr-2">
                            <select
                              className={sel}
                              value={u.mode === 'share' ? `share:${u.shareWith}` : u.mode}
                              aria-label={`Como é atendido: ${useLabel(key)} em ${n.name}`}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v.startsWith('share:')) setUse(n, key, { mode: 'share', shareWith: v.slice(6) });
                                else setUse(n, key, { mode: v as LoadUse['mode'] });
                              }}
                            >
                              <option value="own">Equipamento próprio</option>
                              {ownRows.map((x) => <option key={x} value={`share:${x}`}>Usa o mesmo de “{useLabel(x)}”</option>)}
                              {key !== 'feed' && <option value="tempo">Tempo de carga das premissas</option>}
                              <option value="silo">{key === 'feed' ? 'Sem equipamento (correia / silo)' : 'Silo / correia (sem equipamento)'}</option>
                            </select>
                          </td>
                          <td className="py-1.5 pr-2">
                            {isOwner ? (
                              <LoaderSelect premises={premises} value={u.classId} label={`Equipamento: ${useLabel(key)} em ${n.name}`} onChange={(v) => setUse(n, key, { classId: v === 'tempo' || v === 'silo' ? undefined : v, ...(v === 'tempo' || v === 'silo' ? { mode: v } : {}) })} />
                            ) : u.mode === 'share' ? (
                              <span className="text-xs text-black/55">{effL ? lname(effL) : '—'} <i className="text-black/40">(mesmo de “{useLabel(owner.key)}”)</i></span>
                            ) : (
                              <span className="text-xs text-black/40">—</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2 text-right">
                            {isOwner && effL ? (
                              <input type="number" min={0} step={1} className={`${box} w-20 ${need && need.available !== null && need.available < need.needed ? 'border-red-300 text-red-700' : ''}`} value={u.count ?? ''} placeholder="calcular" aria-label={`Disponíveis: ${useLabel(key)} em ${n.name}`} onChange={(e) => setUse(n, key, { count: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} />
                            ) : <span className="text-black/30">—</span>}
                          </td>
                          {need && effL ? (
                            <>
                              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{key === 'feed' ? '—' : n1(need.passes)}</td>
                              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{key === 'feed' ? `${t0(need.feedTph ?? 0)} t/h` : `${n1(need.loadMin)} min`}</td>
                              <td className="whitespace-nowrap py-1.5 pr-2 text-right font-mono tabular-nums">{t0(part?.busyH ?? 0)} h{!isOwner && <span className="block text-[10px] text-black/40">soma no mesmo</span>}</td>
                              <td className="py-1.5 pr-2 text-right font-mono tabular-nums">{isOwner ? <><b>{need.needed}</b> <span className="text-black/40">({n2(need.neededExact)})</span></> : <span className="text-black/45">+{n2(part?.neededExact ?? 0)}</span>}</td>
                              <td className={`py-1.5 text-right font-mono tabular-nums ${isOwner && need.utilization > 0.85 ? 'text-amber-700' : ''}`}>{isOwner ? pc(need.utilization) : ''}</td>
                            </>
                          ) : (
                            <td colSpan={5} className="py-1.5 pr-2 text-xs text-black/45">
                              {u.mode === 'silo' ? (key === 'feed' ? 'alimentação sem equipamento a dimensionar' : 'carga por silo / correia') : u.mode === 'tempo' || !lid ? 'tempo de carga das premissas' : ''}
                            </td>
                          )}
                          <td className="py-1.5 pl-2 text-right">
                            {isOwner && effL && (
                              <button type="button" onClick={() => setEditing(editing === ek ? null : ek)} className="rounded p-1 text-black/40 hover:bg-black/5" aria-label={`Editar ${effL.name}`} title="Editar os tempos deste equipamento">
                                {editing === ek ? <X size={14} /> : <Pencil size={14} />}
                              </button>
                            )}
                          </td>
                        </tr>
                        {editing === ek && effL && (
                          <tr className="bg-black/[0.02]">
                            <td colSpan={10} className="px-2 py-2">
                              <p className="mb-1 text-xs text-black/55">Tempos de <b>{lname(effL)}</b> (vale para todos os usos com este modelo):</p>
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
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {own.length > 0 && (
        <div className="rounded-xl border border-black/[0.08] bg-white p-3 text-sm">
          <p className="mb-1 font-semibold text-black/70">Rotas com equipamento próprio (2. Dimensionamento)</p>
          {own.map((l) => <p key={l.where} className="text-xs text-black/60">{l.where}: {l.loaderName} — {l.needed} necessário(s), ocupação {pc(l.utilization)}</p>)}
        </div>
      )}

      {totals.size > 0 && (
        <div className="rounded-xl bg-black/[0.03] p-3">
          <p className="mb-1 text-sm font-semibold text-black/70">Equipamentos de carga na operação</p>
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="text-left text-[11px] text-black/45">
                <th className="py-1 font-medium">Modelo</th>
                <th className="py-1 text-right font-medium">Necessários</th>
                <th className="py-1 text-right font-medium">Disponíveis</th>
              </tr>
            </thead>
            <tbody>
              {[...totals].map(([name, t]) => (
                <tr key={name} className="border-t border-black/5">
                  <td className="py-1">{name}</td>
                  <td className="py-1 text-right font-mono font-bold">{t.needed}</td>
                  <td className={`py-1 text-right font-mono ${t.anyAvail && t.available < t.needed ? 'font-bold text-red-700' : ''}`}>{t.anyAvail ? t.available : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-black/45">
        Cada linha é um uso de carga do local: alimentar a planta (ou a planta móvel do transbordo) e carregar os caminhões de cada movimentação que sai dele. Escolha equipamento próprio (tipo e quantidade), “usa o mesmo de” outra linha (as horas se somam no mesmo equipamento), o tempo de carga das premissas ou silo / correia.
        Necessários = horas de uso no mês ÷ horas efetivas de um equipamento (calendário × DF × UF). Carregar: caminhões × tempo de carga. Alimentar: massa que chega ÷ produção do equipamento (caçamba × enchimento × densidade × 3.600 ÷ ciclo).
      </p>
    </div>
  );
};

/** Resumo dos usos de carga de um local (desenho e tabela da rede); a edição fica em Carga e ciclo. */
export const LoadUsesSummary: React.FC<{ premises: DetailedPremises; node: FlowNode; routes: Route[] }> = ({ premises, node, routes }) => {
  const cat = catalogOf(premises);
  const keys = loadUseKeys(node, routes);
  if (!keys.length) return <span className="text-xs text-black/30">sem uso de carga</span>;
  const label = (key: string) => (key === 'feed' ? 'Alimentar' : `Carga → ${(premises.nodes ?? []).find((x) => x.id === routes.find((r) => r.id === key)?.toId)?.name ?? ''}`);
  return (
    <ul className="space-y-0.5 text-xs text-black/65">
      {keys.map((k) => {
        const u = loadUseOf(node, k, keys);
        const o = loadOwner(node, k, keys);
        const id = useClassId(o.use, premises);
        const l = id && id !== 'silo' ? cat.loaders.find((x) => x.id === id) : undefined;
        const txt = u.mode === 'share' ? `mesmo de “${label(o.key)}”${l ? ` (${l.name})` : ''}` : u.mode === 'tempo' || (!id && u.mode === 'own') ? 'tempo de carga das premissas' : id === 'silo' ? (k === 'feed' ? 'sem equipamento' : 'silo / correia') : `${l?.name ?? id}${o.use.count !== undefined ? ` × ${o.use.count}` : ''}`;
        return <li key={k}><b className="font-medium">{label(k)}</b>: {txt}</li>;
      })}
      <li className="text-[11px] text-black/40">editar em Premissas → Carga e ciclo</li>
    </ul>
  );
};
