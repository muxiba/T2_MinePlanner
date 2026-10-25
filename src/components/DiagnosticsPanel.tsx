import React, { useMemo } from 'react';
import { AlertTriangle, Info, Wrench } from 'lucide-react';
import type { DetailedPremises, Route } from '@/types';
import { diagnose } from '@/engine/diagnostics';

/** Pente fino: o que impede as premissas de mudarem o resultado, com correção de um clique. */
export const DiagnosticsPanel: React.FC<{
  routes: Route[];
  premises: DetailedPremises;
  setRoutes: (r: Route[]) => void;
  setPremises: (fn: (p: DetailedPremises) => DetailedPremises) => void;
}> = ({ routes, premises, setRoutes, setPremises }) => {
  const list = useMemo(() => diagnose(routes, premises), [routes, premises]);
  if (!list.length) return null;
  const apply = (fix: NonNullable<(typeof list)[number]['fix']>) => {
    const r = fix(routes, premises);
    if (r.routes) setRoutes(r.routes);
    if (r.premises) setPremises(() => r.premises!);
  };
  const fixAll = () => {
    let rs = routes;
    let p = premises;
    for (const d of list) if (d.fix && d.level !== 'info') {
      const r = d.fix(rs, p);
      rs = r.routes ?? rs;
      p = r.premises ?? p;
    }
    if (rs !== routes) setRoutes(rs);
    if (p !== premises) setPremises(() => p);
  };
  return (
    <section className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-amber-700" />
          <h4 className="font-bold text-amber-900">Pente fino: o que pode travar o cálculo</h4>
        </div>
        {list.filter((d) => d.fix && d.level !== 'info').length > 1 && (
          <button onClick={fixAll} className="rounded-xl bg-[#151619] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black">Corrigir tudo</button>
        )}
      </div>
      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.id} className="flex flex-wrap items-start gap-3 rounded-2xl bg-white px-4 py-3">
            {d.level === 'info' ? <Info size={16} className="mt-0.5 shrink-0 text-sky-600" /> : <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${d.level === 'trava' ? 'text-red-600' : 'text-amber-600'}`} />}
            <div className="min-w-[220px] flex-1">
              <p className="text-sm font-semibold text-black/80">{d.title}</p>
              <p className="text-xs text-black/60">{d.detail}</p>
            </div>
            {d.fix && d.fixLabel && (
              <button onClick={() => apply(d.fix!)} className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/[0.03]">
                {d.fixLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};
