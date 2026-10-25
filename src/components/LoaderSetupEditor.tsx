import React, { useMemo } from 'react';
import type { DetailedPremises, FlowNode, LoaderClass, Route } from '@/types';
import { DEFAULT_LOOSE_DENSITY, analyzeFleet, catalogOf, loaderCycleSec, loaderLoading } from '@/engine/fleet';
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

/** Tempos de cada equipamento e caçambadas por tipo de caminhão. */
export const LoaderTimesEditor: React.FC<Props> = ({ premises, setPremises }) => {
  const cat = catalogOf(premises);
  const density = premises.looseDensity && premises.looseDensity > 0 ? premises.looseDensity : DEFAULT_LOOSE_DENSITY;
  const trucks = fleetTypesOf(premises);
  const setL = (id: string, patch: Partial<LoaderClass>) =>
    setPremises((p) => {
      const c = catalogOf(p);
      return { ...p, equipmentCatalog: { ...c, loaders: c.loaders.map((l) => (l.id === id ? { ...l, ...patch } : l)) } };
    });
  const numIn = (l: LoaderClass, k: keyof LoaderClass, step: number, placeholder?: string, w = 'w-16') => (
    <input
      type="number"
      step={step}
      min={0}
      className={`${box} ${w}`}
      value={(l[k] as number | undefined) ?? ''}
      placeholder={placeholder}
      aria-label={`${String(k)} de ${l.name}`}
      onChange={(e) => setL(l.id, { [k]: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) } as Partial<LoaderClass>)}
    />
  );
  const usedIds = new Set((premises.nodes ?? []).map((n) => n.loaderClassId).filter(Boolean) as string[]);
  const list = [...cat.loaders].sort((a, b) => Number(usedIds.has(b.id)) - Number(usedIds.has(a.id)));
  const spot = premises.loaderSpotMin ?? 0.5;

  return (
    <div className="space-y-4">
      <p className="text-xs text-black/55">
        Ciclo de uma caçambada = carregar (encher a caçamba) + giro carregado + descarga no caminhão + giro vazio. Se as partes ficarem vazias, vale o ciclo total. Tempo de carga do caminhão = posicionamento + caçambadas × ciclo; caçambadas = carga útil ÷ (caçamba × enchimento × densidade solta {n2(density)} t/m³), arredondado para cima.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="text-left text-[11px] text-black/45">
              <th className="px-1 py-1 font-medium">Equipamento</th>
              <th className="px-1 py-1 text-right font-medium">Caçamba (m³)</th>
              <th className="px-1 py-1 text-right font-medium">Enchimento (%)</th>
              <th className="px-1 py-1 text-right font-medium">Carregar (s)</th>
              <th className="px-1 py-1 text-right font-medium">Giro carregado (s)</th>
              <th className="px-1 py-1 text-right font-medium">Descarga (s)</th>
              <th className="px-1 py-1 text-right font-medium">Giro vazio (s)</th>
              <th className="px-1 py-1 text-right font-medium">Ciclo (s)</th>
              <th className="px-1 py-1 text-right font-medium">Posicionamento (min)</th>
              <th className="px-1 py-1 text-right font-medium">DF (%)</th>
            </tr>
          </thead>
          <tbody>
            {list.map((l) => {
              const parts = [l.digSec, l.swingLoadedSec, l.dumpSec, l.swingEmptySec].some((v) => v && v > 0);
              return (
                <tr key={l.id} className="border-t border-black/5">
                  <td className="px-1 py-1">{lname(l)}{usedIds.has(l.id) && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">em uso</span>}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'bucketM3', 0.1)}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'fillFactor', 5, '90')}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'digSec', 1, '—')}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'swingLoadedSec', 1, '—')}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'dumpSec', 1, '—')}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'swingEmptySec', 1, '—')}</td>
                  <td className="px-1 py-1 text-right">{parts ? <b className="font-mono">{t0(loaderCycleSec(l))}</b> : numIn(l, 'cycleSec', 1)}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'spotMin', 0.1, String(spot))}</td>
                  <td className="px-1 py-1 text-right">{numIn(l, 'dfPct', 1, String(premises.dfMina ?? 85))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => {
            const need = fa.loaderNeeds.find((l) => l.nodeId === n.id);
            const short = need && need.available !== null && need.available < need.needed;
            return (
              <React.Fragment key={n.id}>
                <tr className="border-t border-black/10 align-top">
                  <td className="py-1.5 pr-2 font-medium">{n.name}<span className="block text-[11px] font-normal text-black/45">local de carregamento</span></td>
                  <td className="py-1.5 pr-2">
                    <select className={sel} value={n.loaderClassId ?? ''} aria-label={`Equipamento de carga em ${n.name}`} onChange={(e) => setNode(n.id, { loaderClassId: e.target.value || undefined })}>
                      <option value="">Tempo de carga das premissas</option>
                      <option value="silo">Silo / correia (sem equipamento)</option>
                      {cat.loaders.map((l) => <option key={l.id} value={l.id}>{lname(l)}</option>)}
                    </select>
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
                    <td colSpan={5} className="py-1.5 pr-2 text-xs text-black/45">{n.loaderClassId === 'silo' ? 'carga por silo/correia: sem equipamento a dimensionar' : 'escolha um equipamento para dimensionar'}</td>
                  )}
                  <td className="py-1.5 pr-2 text-right">
                    {n.loaderClassId && n.loaderClassId !== 'silo' ? (
                      <input type="number" min={0} step={1} className={`${box} w-20 ${short ? 'border-red-300 text-red-700' : ''}`} value={n.loaderCount ?? ''} placeholder="calcular" aria-label={`Equipamentos disponíveis em ${n.name}`} onChange={(e) => setNode(n.id, { loaderCount: e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))) })} />
                    ) : <span className="text-black/30">—</span>}
                  </td>
                  <td className={`py-1.5 text-right font-mono tabular-nums ${need && need.utilization > 0.85 ? 'text-amber-700' : ''}`}>{need ? pc(need.utilization) : '—'}</td>
                </tr>
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
