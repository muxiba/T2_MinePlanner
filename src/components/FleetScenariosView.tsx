import React, { useMemo } from 'react';
import type { DetailedPremises, Route } from '@/types';
import { fleetScenarios, type ScenarioRow } from '@/engine/optimize';

const n2 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const i0 = (n: number) => String(Math.round(n) || 0);

/** Três cenários lado a lado: frota exata, inteira por fluxo e otimizada (sobras compartilhadas entre fluxos). */
export const FleetScenariosView: React.FC<{ routes: Route[]; premises: DetailedPremises; onApplyExact?: () => void; compact?: boolean; setPremises?: (fn: (p: DetailedPremises) => DetailedPremises) => void }> = ({ routes, premises, onApplyExact, compact, setPremises }) => {
  const s = useMemo(() => fleetScenarios(routes, premises), [routes, premises]);
  if (!s.trucks.length && !s.loaders.length) return null;
  const saveT = s.totals.trucks.perFlow - s.totals.trucks.optimized;
  const saveL = s.totals.loaders.perFlow - s.totals.loaders.optimized;
  const table = (title: string, rows: ScenarioRow[], tot: { exact: number; perFlow: number; optimized: number }) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="text-left text-[10px] font-bold tracking-widest text-black/40 uppercase">
            <th className="py-1.5 pr-2">{title}</th>
            <th className="px-2 text-right">Exata</th>
            <th className="px-2 text-right">Inteiro por fluxo</th>
            <th className="px-2 text-right">Otimizada</th>
            <th className="pl-2 text-right">Disponível</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.model} className="border-t border-black/5">
              <td className="py-1.5 pr-2 font-sans">{r.model}</td>
              <td className="px-2 text-right">{n2(r.exact)}</td>
              <td className="px-2 text-right">{i0(r.perFlow)}</td>
              <td className="px-2 text-right font-bold text-emerald-700">{i0(r.optimized)}</td>
              <td className={`pl-2 text-right ${r.available !== null && r.available < r.optimized ? 'text-red-600' : 'text-black/50'}`}>{r.available === null ? '—' : i0(r.available)}</td>
            </tr>
          ))}
          {rows.length > 1 && (
            <tr className="border-t border-black/10 font-bold">
              <td className="py-1.5 pr-2 font-sans">Total</td>
              <td className="px-2 text-right">{n2(tot.exact)}</td>
              <td className="px-2 text-right">{i0(tot.perFlow)}</td>
              <td className="px-2 text-right text-emerald-700">{i0(tot.optimized)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
  const trucksShared = s.shared.filter((u) => u.kind === 'caminhao' && u.parts.length > 1);
  const loadShared = s.shared.filter((u) => u.kind === 'carga');
  return (
    <div className="space-y-4">
      {!compact && (
        <p className="text-xs text-black/55">
          <b>Exata</b>: a frota quebrada que bate a meta. <b>Inteiro por fluxo</b>: cada fluxo com caminhões e equipamentos só dele, arredondados para cima. <b>Otimizada</b>: os caminhões e equipamentos com ocupação baixa cobrem outro fluxo (mesmo tipo de caminhão; equipamento de carga no mesmo local), em números inteiros.
        </p>
      )}
      {setPremises && (
        <label className="flex flex-wrap items-center gap-2 text-xs text-black/60">
          Ocupação máxima de um equipamento compartilhado
          <input type="number" min={50} max={100} step={5} className="w-20 rounded-lg border border-black/10 bg-[#F8F9FA] px-2 py-1 text-right font-mono" value={premises.shareMaxPct ?? 100} onChange={(e) => setPremises((p) => ({ ...p, shareMaxPct: e.target.value === '' ? undefined : Math.min(100, Math.max(50, Number(e.target.value))) }))} />
          % (deixa folga para o deslocamento entre fluxos)
        </label>
      )}
      {s.trucks.length > 0 && table('Caminhões', s.trucks, s.totals.trucks)}
      {s.loaders.length > 0 && table('Equipamentos de carga', s.loaders, s.totals.loaders)}
      {(saveT > 0 || saveL > 0) && (
        <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          A otimização economiza {saveT > 0 ? `${saveT} caminhão(ões)` : ''}{saveT > 0 && saveL > 0 ? ' e ' : ''}{saveL > 0 ? `${saveL} equipamento(s) de carga` : ''} em relação a um equipamento inteiro por fluxo.
        </p>
      )}
      {!compact && (trucksShared.length > 0 || loadShared.length > 0) && (
        <div className="space-y-1 text-sm">
          <p className="text-[10px] font-bold tracking-widest text-black/40 uppercase">Equipamentos compartilhados no cenário otimizado</p>
          {[...trucksShared, ...loadShared].map((u, i) => (
            <p key={i} className="text-black/70">
              1 {u.kind === 'caminhao' ? 'caminhão' : 'equipamento'} <b>{u.model}</b> ({Math.round(u.load * 100)}% ocupado): {u.parts.map((p) => `${p.name} (${n2(p.frac)})`).join(' + ')}
            </p>
          ))}
        </div>
      )}
      {onApplyExact && (
        <button onClick={onApplyExact} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
          Trabalhar com a frota otimizada (rotas com frota exata, caminhões compartilhados)
        </button>
      )}
    </div>
  );
};
