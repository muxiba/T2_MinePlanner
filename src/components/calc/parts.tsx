import React from 'react';
import { ArrowRight } from 'lucide-react';
import { fmtTrucks, KIND_LABELS, type RouteAnalysis } from '@/engine/fleet';

/** Peças da memória de cálculo, usadas na tela e no relatório impresso. */

export const t0 = (n: number) => Math.round(n || 0).toLocaleString('pt-BR');
export const n1 = (n: number) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const n2 = (n: number) => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pc = (r: number) => `${Math.round((r || 0) * 100)}%`;

export const KIND_COLOR: Record<string, string> = { rom: '#059669', product: '#2563eb', tailings: '#d97706', waste: '#7c3aed' };

export const Kpi: React.FC<{ label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }> = ({ label, value, sub, tone }) => (
  <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
    <p className="text-[10px] font-bold tracking-widest text-black/40 uppercase">{label}</p>
    <p className={`mt-1 font-mono text-2xl font-bold ${tone === 'ok' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-black/80'}`}>{value}</p>
    {sub && <p className="text-[11px] text-black/45">{sub}</p>}
  </div>
);

export const FlowBox: React.FC<{ color: string; title: string; main: string; lines: string[]; warn?: boolean }> = ({ color, title, main, lines, warn }) => (
  <div className={`min-w-[200px] flex-1 rounded-2xl border p-4 ${warn ? 'border-red-200 bg-red-50' : 'border-black/5 bg-[#F8F9FA]'}`} style={{ borderLeft: `4px solid ${color}` }}>
    <p className="text-[10px] font-bold tracking-widest text-black/45 uppercase">{title}</p>
    <p className="font-mono text-lg font-bold text-black/80">{main}</p>
    {lines.map((l) => (
      <p key={l} className="text-xs text-black/50">{l}</p>
    ))}
  </div>
);

export const Arrow = () => (
  <div className="flex items-center text-black/25" aria-hidden>
    <ArrowRight size={20} />
  </div>
);

export const HoursCascade: React.FC<{ title: string; cal: number; df: number; uf: number }> = ({ title, cal, df, uf }) => {
  const afterDf = cal * (df / 100);
  const eff = afterDf * (uf / 100);
  const rows: [string, number, string][] = [
    ['Calendário', cal, ''],
    [`× DF ${n1(df)}%`, afterDf, `−${t0(cal - afterDf)} h em manutenção/indisponível`],
    [`× UF ${n1(uf)}%`, eff, `−${t0(afterDf - eff)} h paradas operacionais`],
  ];
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-black/70">{title}</p>
      <div className="space-y-2">
        {rows.map(([k, v, why], i) => (
          <div key={k}>
            <div className="mb-0.5 flex justify-between text-xs">
              <span className="text-black/60">{k}</span>
              <span className="font-mono font-semibold">{t0(v)} h</span>
            </div>
            <div className="h-2.5 rounded-full bg-black/[0.05]">
              <div className={`h-full rounded-full ${i === 2 ? 'bg-emerald-500' : 'bg-black/25'}`} style={{ width: `${cal ? (v / cal) * 100 : 0}%` }} />
            </div>
            {why && <p className="mt-0.5 text-[11px] text-black/40">{why}</p>}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-black/55">
        Horas efetivas: <b className="font-mono">{t0(eff)} h</b> ({pc(cal ? eff / cal : 0)} do calendário)
      </p>
    </div>
  );
};

export const CYCLE_PARTS: { key: 'loadMin' | 'travelLoadedMin' | 'dumpMin' | 'travelEmptyMin' | 'weighMin' | 'queueMin' | 'interferenceMin'; label: string; color: string }[] = [
  { key: 'loadMin', label: 'Carga', color: '#059669' },
  { key: 'travelLoadedMin', label: 'Ida cheio', color: '#2563eb' },
  { key: 'dumpMin', label: 'Descarga', color: '#d97706' },
  { key: 'travelEmptyMin', label: 'Volta vazio', color: '#93c5fd' },
  { key: 'weighMin', label: 'Pesagens', color: '#a8a29e' },
  { key: 'queueMin', label: 'Fila', color: '#dc2626' },
  { key: 'interferenceMin', label: 'Interferências', color: '#7c3aed' },
];

export const CycleBars: React.FC<{ routes: RouteAnalysis[] }> = ({ routes }) => {
  const max = Math.max(1, ...routes.map((r) => r.cycle.totalMin));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-black/55">
        {CYCLE_PARTS.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} /> {p.label}
          </span>
        ))}
      </div>
      <div className="space-y-3">
        {routes.map((r) => {
          const c = r.cycle;
          const informed = c.mode === 'informed';
          return (
            <div key={r.id} className="grid grid-cols-[minmax(120px,200px)_1fr_auto] items-center gap-3">
              <span className="truncate text-sm text-black/70" title={r.name}>{r.name}</span>
              <div className="flex h-5 overflow-hidden rounded-md bg-black/[0.04]" style={{ width: `${(c.totalMin / max) * 100}%` }}>
                {informed ? (
                  <div className="h-full w-full bg-black/25" title="Ciclo informado (cronometrado)" />
                ) : (
                  CYCLE_PARTS.map((p) =>
                    c[p.key] > 0 ? <div key={p.key} className="h-full" style={{ width: `${(c[p.key] / c.totalMin) * 100}%`, background: p.color }} title={`${p.label}: ${n1(c[p.key])} min`} /> : null,
                  )
                )}
              </div>
              <span className="text-right font-mono text-sm whitespace-nowrap">
                <b>{n1(c.totalMin)} min</b> <span className="text-black/45">· {n2(60 / c.totalMin)} viagens/h</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const RouteTable: React.FC<{ routes: RouteAnalysis[]; totalNeeded: number; totalExact: number; totalAllocated: number }> = ({ routes, totalNeeded, totalExact, totalAllocated }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[900px] text-sm">
      <thead>
        <tr className="border-b border-black/10 text-left text-[11px] text-black/45">
          <th className="py-2 pr-3 font-medium">Rota</th>
          <th className="px-2 py-2 text-right font-medium">Meta úmida</th>
          <th className="px-2 py-2 text-right font-medium">Carga útil</th>
          <th className="px-2 py-2 text-right font-medium">t/h por caminhão</th>
          <th className="px-2 py-2 text-right font-medium">Horas efetivas</th>
          <th className="px-2 py-2 text-right font-medium">t/mês por caminhão</th>
          <th className="px-2 py-2 text-right font-medium">Necessários</th>
          <th className="px-2 py-2 text-right font-medium">Na rota</th>
          <th className="py-2 pl-2 text-right font-medium">Atendimento</th>
        </tr>
      </thead>
      <tbody>
        {routes.map((r) => (
          <tr key={r.id} className="border-b border-black/5">
            <td className="py-2.5 pr-3">
              <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[r.kind] }} />
              <span className="font-medium text-black/80">{r.name}</span>
              <span className="block pl-4 text-[11px] text-black/40">{KIND_LABELS[r.kind]}</span>
            </td>
            <td className="px-2 py-2.5 text-right font-mono">{t0(r.targetWetT)} t</td>
            <td className="px-2 py-2.5 text-right font-mono">{n1(r.payloadT)} t</td>
            <td className="px-2 py-2.5 text-right font-mono">{n1(r.truckRateTph)}</td>
            <td className="px-2 py-2.5 text-right font-mono">{t0(r.hours.effective)} h</td>
            <td className="px-2 py-2.5 text-right font-mono">{t0(r.truckMonthT)} t</td>
            <td className="px-2 py-2.5 text-right font-mono">
              <b>{r.trucksNeeded}</b> <span className="text-black/40">({n2(r.trucksNeededExact)})</span>
            </td>
            <td className="px-2 py-2.5 text-right font-mono">{fmtTrucks(r.trucksAllocated)}</td>
            <td className={`py-2.5 pl-2 text-right font-mono font-semibold ${r.ratio >= 0.999 ? 'text-emerald-600' : 'text-red-600'}`}>{pc(r.ratio)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="text-sm">
          <td className="py-2.5 pr-3 font-semibold" colSpan={6}>Total</td>
          <td className="px-2 py-2.5 text-right font-mono">
            <b>{totalNeeded}</b> <span className="text-black/40">({n2(totalExact)})</span>
          </td>
          <td className="px-2 py-2.5 text-right font-mono font-semibold">{fmtTrucks(totalAllocated)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  </div>
);

export const StageBar: React.FC<{ label: string; need: number; cap: number; ratio: number; basis: string; isBottleneck: boolean }> = ({ label, need, cap, ratio, basis, isBottleneck }) => {
  const scale = Math.max(1.25, ratio * 1.05);
  return (
    <div className="grid grid-cols-[minmax(140px,220px)_1fr_auto] items-center gap-3">
      <span className="text-sm text-black/70">
        {label}
        {isBottleneck && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 uppercase">mais justa</span>}
      </span>
      <div className="relative h-5 rounded-md bg-black/[0.04]">
        <div className={`h-full rounded-md ${ratio >= 0.999 ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${Math.min(ratio / scale, 1) * 100}%` }} />
        <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-black/70" style={{ left: `${(1 / scale) * 100}%` }} title="100% da necessidade" />
      </div>
      <span className="text-right font-mono text-xs whitespace-nowrap">
        <b className={ratio >= 0.999 ? 'text-emerald-700' : 'text-red-600'}>{pc(ratio)}</b>
        <span className="text-black/45"> · {t0(cap)} de {t0(need)} t {basis}</span>
      </span>
    </div>
  );
};

export const Line2: React.FC<{ k: string; v: string; tone?: 'ok' | 'bad' }> = ({ k, v, tone }) => (
  <div className="flex items-baseline justify-between border-b border-black/5 py-1.5 text-sm last:border-b-0">
    <span className="text-black/55">{k}</span>
    <span className={`font-mono font-semibold ${tone === 'bad' ? 'text-red-600' : tone === 'ok' ? 'text-emerald-700' : ''}`}>{v}</span>
  </div>
);

