import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import type { DetailedPremises, FlowNode, NodeType, Route, RouteKind } from '@/types';
import { MATERIAL_LABELS, NODE_LABELS, materialsFrom, networkBalance } from '@/engine/network';
import { entryClassId, nodeLoaderEntries, routeKind, withFirstEntry } from '@/engine/fleet';
import { LoaderSelect } from './LoaderSetupEditor';
import { processPct } from '@/engine/process';

/**
 * Locais e movimentações (rede de fluxos), nas Premissas Fundamentais.
 * O usuário monta a operação real: frentes → plantas → estoques → expedição; plantas → baias → pilhas; frentes → PDE.
 * As massas saem do balanço; cada movimentação é uma rota do 2. Dimensionamento (consome frota).
 */

const cell = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm';
const num = `${cell} text-right font-mono`;
const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const NODE_TYPES = Object.keys(NODE_LABELS) as NodeType[];
const PASS_THROUGH: NodeType[] = ['estoque', 'expedicao', 'rejeito', 'esteril'];

interface Props {
  premises: DetailedPremises;
  setPremises: (fn: (prev: DetailedPremises) => DetailedPremises) => void;
  routes: Route[];
  setRoutes: (fn: (prev: Route[]) => Route[]) => void;
}

const NetworkEditor: React.FC<Props> = ({ premises, setPremises, routes, setRoutes }) => {
  const nodes = premises.nodes ?? [];
  const res = useMemo(() => networkBalance(routes, premises, routeKind), [routes, premises]);
  const nodeOf = (id?: string) => nodes.find((n) => n.id === id);
  const setNode = (id: string, patch: Partial<FlowNode>) => setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const setRoute = (id: string, patch: Partial<Route>) => setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const frentes = nodes.filter((n) => n.type === 'frente');
  const shareSum = frentes.reduce((a, n) => a + (n.romShare ?? 1), 0) || 1;
  const pp = processPct(premises);

  const tm = premises.flowMode === 'transporte';
  const tGroup = (t: NodeType) => (t === 'frente' ? 'origem' : t === 'estoque' ? 'passagem' : 'destino') as FlowNode['group'];
  const addNode = (type: NodeType) => setPremises((p) => ({ ...p, nodes: [...(p.nodes ?? []), { id: newId(type), name: `${NODE_LABELS[type]} ${(p.nodes ?? []).filter((n) => n.type === type).length + 1}`, type, ...(tm ? { group: tGroup(type) } : {}) }] }));
  const removeNode = (id: string) => {
    if (routes.some((r) => r.fromId === id || r.toId === id)) return alert('Este local tem movimentações. Apague ou mude as movimentações dele primeiro.');
    setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).filter((n) => n.id !== id) }));
  };
  const addRoute = () => {
    const from = nodes.find((n) => n.type === 'frente') ?? nodes[0];
    const kind: RouteKind = from ? materialsFrom(from.type)[0] : 'rom';
    const to = nodes.find((n) => n.id !== from?.id && (kind === 'rom' ? n.type === 'planta' : true));
    setRoutes((rs) => [
      ...rs,
      {
        id: newId('mov'),
        name: `${from?.name ?? 'Origem'} → ${to?.name ?? 'Destino'}`,
        kind,
        fromId: from?.id,
        toId: to?.id,
        active: true,
        truckCount: 0,
        truckCapacity: premises.truckCapacity,
        distance: 1000,
        cycleTime: 20,
        mechanicalAvailability: premises.dfMina,
        operationalEfficiency: 100,
        processType: premises.processType,
        fleetMode: 'inteiro',
      },
    ]);
  };
  const removeRoute = (r: Route) => {
    if (!confirm(`Apagar a movimentação “${r.name}”? Os caminhões dela voltam para a folga.`)) return;
    setRoutes((rs) => rs.filter((x) => x.id !== r.id));
  };
  const autoName = (r: Route, patch: Partial<Route>) => {
    const f = nodeOf(patch.fromId ?? r.fromId)?.name ?? '?';
    const t = nodeOf(patch.toId ?? r.toId)?.name ?? '?';
    const old = `${nodeOf(r.fromId)?.name ?? '?'} → ${nodeOf(r.toId)?.name ?? '?'}`;
    return r.name === old || r.name.includes('→') || r.name.includes('->') ? `${f} → ${t}` : r.name;
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-black/55">
        Monte a operação como ela é: de onde sai cada material, por onde passa e onde termina. Cada movimentação vira uma rota no 2. Dimensionamento e consome frota — inclusive as pernas intermediárias (planta → estoque → expedição, baia → pilha).
        As massas saem sozinhas do balanço: ROM das frentes pela participação de cada uma; na planta, produto = ROM × {pp.rm.toLocaleString('pt-BR')}% e rejeito = ROM × {pp.rej.toLocaleString('pt-BR')}%; nos estoques, sai o que entra (± variação de estoque). Digite uma massa só quando quiser fixá-la.
      </p>

      {/* ------------------------------ locais ------------------------------ */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-black/70">Locais</p>
          <div className="flex flex-wrap gap-1.5">
            {NODE_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => addNode(t)} className="inline-flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs font-semibold text-black/70 hover:bg-black/[0.03]">
                <Plus size={12} /> {NODE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="text-left text-[11px] text-black/45">
                <th className="px-1 py-1 font-medium">Nome</th>
                <th className="px-1 py-1 font-medium">Tipo</th>
                <th className="px-1 py-1 font-medium">Parte do ROM (peso)</th>
                <th className="px-1 py-1 font-medium">Estéril (t seca/mês)</th>
                <th className="px-1 py-1 font-medium">Variação de estoque (t/mês)</th>
                <th className="px-1 py-1 font-medium">Carregamento dos caminhões</th>
                <th className="px-1 py-1 font-medium">Equip. disponíveis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => {
                const hasOut = routes.some((r) => r.fromId === n.id);
                return (
                  <tr key={n.id} className="border-t border-black/5 align-top">
                    <td className="px-1 py-1"><input className={cell} value={n.name} aria-label="Nome do local" onChange={(e) => setNode(n.id, { name: e.target.value })} /></td>
                    <td className="px-1 py-1">
                      <select className={cell} value={n.type} aria-label="Tipo do local" onChange={(e) => setNode(n.id, { type: e.target.value as NodeType })}>
                        {NODE_TYPES.map((t) => <option key={t} value={t}>{NODE_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      {n.type === 'frente' ? (
                        <span className="flex items-center gap-1.5">
                          <input type="number" step={1} className={`${num} w-20`} value={n.romShare ?? 1} aria-label="Parte do ROM" onChange={(e) => setNode(n.id, { romShare: Math.max(0, Number(e.target.value) || 0) })} />
                          <span className="text-xs text-black/50 whitespace-nowrap">{Math.round(((n.romShare ?? 1) / shareSum) * 100)}% · {t0(((premises.targetMonthlyROM || 0) * (n.romShare ?? 1)) / shareSum)} t</span>
                        </span>
                      ) : <span className="text-xs text-black/30">—</span>}
                    </td>
                    <td className="px-1 py-1">
                      {n.type === 'frente' && premises.hasWasteRock ? (
                        <input type="number" step={1000} className={num} value={n.wasteT ?? ''} placeholder="divide a meta" aria-label="Estéril da frente" onChange={(e) => setNode(n.id, { wasteT: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
                      ) : <span className="text-xs text-black/30">—</span>}
                    </td>
                    <td className="px-1 py-1">
                      {PASS_THROUGH.includes(n.type) && hasOut ? (
                        <input type="number" step={1000} className={num} value={n.stockChangeT ?? ''} placeholder="0 = sai o que entra" aria-label="Variação de estoque" onChange={(e) => setNode(n.id, { stockChangeT: e.target.value === '' ? undefined : Number(e.target.value) })} />
                      ) : <span className="text-xs text-black/30">—</span>}
                    </td>
                    <td className="px-1 py-1">
                      {hasOut ? (
                        <LoaderSelect premises={premises} className={cell} value={nodeLoaderEntries(n)[0]?.classId} label="Carregamento" onChange={(v) => setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((x) => (x.id === n.id ? withFirstEntry(x, { classId: v }) : x)) }))} />
                      ) : <span className="text-xs text-black/30">sem saída de caminhões</span>}
                    </td>
                    <td className="px-1 py-1">
                      {hasOut && (entryClassId(nodeLoaderEntries(n)[0] ?? {}, premises) ?? 'silo') !== 'silo' ? (
                        <input type="number" min={0} step={1} className={`${num} w-20`} value={nodeLoaderEntries(n)[0]?.count ?? ''} placeholder="calcular" aria-label="Equipamentos disponíveis" onChange={(e) => { const c = e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))); setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((x) => (x.id === n.id ? withFirstEntry(x, { count: c }) : x)) })); }} />
                      ) : <span className="text-xs text-black/30">—</span>}
                    </td>
                    <td className="px-1 py-1">
                      <button type="button" onClick={() => removeNode(n.id)} className="rounded-lg p-1.5 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Apagar ${n.name}`}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-black/45">
          Parte do ROM: peso de cada frente na meta de ROM (60 e 40 = 60% e 40%). Variação de estoque: + forma estoque (sai menos do que entra), − consome estoque (sai mais). Carregamento: o equipamento que carrega os caminhões que saem do local — o 2. Dimensionamento calcula quantos são necessários.
        </p>
      </div>

      {/* --------------------------- movimentações --------------------------- */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-black/70">Movimentações (cada uma é uma rota e consome frota)</p>
          <button type="button" onClick={addRoute} className="inline-flex items-center gap-1.5 rounded-lg bg-[#151619] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black">
            <Plus size={14} /> Adicionar movimentação
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="text-left text-[11px] text-black/45">
                <th className="px-1 py-1 font-medium">Nome</th>
                <th className="px-1 py-1 font-medium">De</th>
                <th className="px-1 py-1 font-medium">Para</th>
                <th className="px-1 py-1 font-medium">Material</th>
                <th className="px-1 py-1 font-medium">Via</th>
                <th className="px-1 py-1 font-medium">DMT (m)</th>
                <th className="px-1 py-1 font-medium">Massa fixa (t seca)</th>
                <th className="px-1 py-1 font-medium">Peso</th>
                <th className="px-1 py-1 text-right font-medium">Massa no mês (t seca)</th>
                <th className="px-1 py-1 font-medium">Ativa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => {
                const from = nodeOf(r.fromId);
                const mats = from ? materialsFrom(from.type) : (['rom', 'product', 'tailings', 'waste'] as RouteKind[]);
                const k = routeKind(r);
                return (
                  <tr key={r.id} className={`border-t border-black/5 ${r.active ? '' : 'opacity-50'}`}>
                    <td className="px-1 py-1"><input className={cell} value={r.name} aria-label="Nome da movimentação" onChange={(e) => setRoute(r.id, { name: e.target.value })} /></td>
                    <td className="px-1 py-1">
                      <select className={cell} value={r.fromId ?? ''} aria-label="Origem" onChange={(e) => {
                        const f = nodeOf(e.target.value);
                        const ms = f ? materialsFrom(f.type) : mats;
                        const patch: Partial<Route> = { fromId: e.target.value, kind: ms.includes(k) ? k : ms[0], targetMass: undefined };
                        setRoute(r.id, { ...patch, name: autoName(r, patch) });
                      }}>
                        <option value="">— escolha —</option>
                        {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select className={cell} value={r.toId ?? ''} aria-label="Destino" onChange={(e) => { const patch = { toId: e.target.value }; setRoute(r.id, { ...patch, name: autoName(r, patch) }); }}>
                        <option value="">— escolha —</option>
                        {nodes.filter((n) => n.id !== r.fromId).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      {tm ? (
                        <input className={cell} value={r.materialName ?? ''} placeholder="minério…" aria-label="Material" onChange={(e) => setRoute(r.id, { materialName: e.target.value })} />
                      ) : (
                        <select className={cell} value={k} aria-label="Material" onChange={(e) => setRoute(r.id, { kind: e.target.value as RouteKind, targetMass: undefined })}>
                          {mats.map((m) => <option key={m} value={m}>{MATERIAL_LABELS[m]}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <select className={`${cell} w-28`} value={r.roadType ?? 'interna'} aria-label="Via" title="Estrada pública: só caminhões rodoviários do catálogo entram nesta movimentação (frota mista)" onChange={(e) => setRoute(r.id, { roadType: e.target.value as 'interna' | 'estrada' })}>
                        <option value="interna">Interna</option>
                        <option value="estrada">Estrada pública</option>
                      </select>
                    </td>
                    <td className="px-1 py-1"><input type="number" step={10} className={`${num} w-24`} value={r.distance} aria-label="DMT" onChange={(e) => setRoute(r.id, { distance: Math.max(0, Number(e.target.value) || 0) })} /></td>
                    <td className="px-1 py-1"><input type="number" step={1000} className={`${num} w-28`} value={r.targetMass ?? ''} placeholder={tm ? 'obrigatória' : 'pelo balanço'} aria-label="Massa fixa" onChange={(e) => setRoute(r.id, { targetMass: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></td>
                    <td className="px-1 py-1"><input type="number" step={0.5} min={0} className={`${num} w-16`} value={r.share ?? 1} disabled={!!r.targetMass} aria-label="Peso na divisão" onChange={(e) => setRoute(r.id, { share: Math.max(0, Number(e.target.value) || 0) })} /></td>
                    <td className="px-1 py-1 text-right font-mono font-semibold tabular-nums">{r.active ? t0(res.edges.get(r.id) ?? 0) : '—'}</td>
                    <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.active} aria-label="Movimentação ativa" onChange={(e) => setRoute(r.id, { active: e.target.checked })} /></td>
                    <td className="px-1 py-1"><button type="button" onClick={() => removeRoute(r)} className="rounded-lg p-1.5 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Apagar ${r.name}`}><Trash2 size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-black/45">
          Peso: várias movimentações do mesmo material saindo do mesmo local dividem a massa pelo peso (1 e 1 = metade para cada; 3 e 1 = 75% e 25%). Massa fixa: a movimentação leva exatamente essa massa; o saldo vai para as outras.
        </p>
      </div>

      {/* ------------------------------ balanço ------------------------------ */}
      <div>
        <p className="mb-2 text-sm font-semibold text-black/70">Balanço de massa por local (t seca/mês)</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-[11px] text-black/45">
                <th className="py-1 pr-2 font-medium">Local</th>
                <th className="py-1 pr-2 font-medium">Material</th>
                <th className="py-1 pr-2 text-right font-medium">Gerado</th>
                <th className="py-1 pr-2 text-right font-medium">Entra</th>
                <th className="py-1 pr-2 text-right font-medium">Sai</th>
                <th className="py-1 text-right font-medium">Fica no local</th>
              </tr>
            </thead>
            <tbody>
              {res.nodes.flatMap((b) =>
                (['rom', 'product', 'tailings', 'waste'] as RouteKind[])
                  .filter((m) => b.genT[m] > 0.5 || b.inT[m] > 0.5 || b.outT[m] > 0.5)
                  .map((m, i) => (
                    <tr key={`${b.node.id}-${m}`} className={i === 0 ? 'border-t border-black/5' : ''}>
                      <td className="py-1 pr-2 font-medium">{i === 0 ? <>{b.node.name} <span className="text-[11px] font-normal text-black/40">{NODE_LABELS[b.node.type]}</span></> : ''}</td>
                      <td className="py-1 pr-2 text-xs">{MATERIAL_LABELS[m]}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">{b.genT[m] > 0.5 ? t0(b.genT[m]) : ''}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">{b.inT[m] > 0.5 ? t0(b.inT[m]) : ''}</td>
                      <td className="py-1 pr-2 text-right font-mono tabular-nums">{b.outT[m] > 0.5 ? t0(b.outT[m]) : ''}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{Math.abs(b.keptT[m]) > 0.5 ? t0(b.keptT[m]) : ''}</td>
                    </tr>
                  )),
              )}
            </tbody>
          </table>
        </div>
        {res.issues.length ? (
          <ul className="mt-2 space-y-1">
            {res.issues.map((x, i) => (
              <li key={i} className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-xs ${x.level === 'erro' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {x.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800"><CheckCircle2 size={13} /> O balanço fecha: todo o material tem destino e as massas batem com as premissas.</p>
        )}
        <p className="mt-1 text-[11px] text-black/45">“Fica no local” é o que chega ao destino final (planta, expedição, pilhas) ou o estoque formado. ROM que entra nas plantas: {t0(res.romToPlants)} t.</p>
      </div>
    </div>
  );
};

export default NetworkEditor;
