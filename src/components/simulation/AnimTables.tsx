import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { DOT_KINDS, type DotKind, type makeAnimator } from '@/sim/animation';
import { DOT_COLORS } from './MapCanvas';
import { n1, t0 } from './ui';

/**
 * Tabela dinâmica da animação: o que a animação já gerou até o instante mostrado
 * (produção por material, tempos de cada caminhão e uso dos equipamentos de carga).
 */

type Animator = ReturnType<typeof makeAnimator>;

const h1 = (min: number) => n1(min / 60);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

const AnimTables: React.FC<{ animator: Animator; from: number; t: number; info: { name: string; material: string }[] }> = ({ animator, from, t, info }) => {
  const [view, setView] = useState<'circuitos' | 'caminhoes'>('circuitos');
  // recalcula a cada minuto simulado
  const minute = Math.floor(t);
  const tot = useMemo(() => animator.totals(from, Math.max(from, minute)), [animator, from, minute]);
  const byMaterial = new Map<string, { tonnes: number; trips: number }>();
  tot.circuits.forEach((c) => {
    const m = info[c.circuit]?.material ?? 'Material';
    const v = byMaterial.get(m) ?? { tonnes: 0, trips: 0 };
    v.tonnes += c.tonnes;
    v.trips += c.trips;
    byMaterial.set(m, v);
  });
  const hours = tot.span / 60;

  return (
    <div className="space-y-3 rounded-xl border border-black/[0.07] bg-[#FAFBFB] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">
          O que a animação gerou até agora <span className="font-normal text-black/50">({n1(hours)} h de operação simuladas)</span>
        </p>
        <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5 text-xs" role="tablist">
          {(['circuitos', 'caminhoes'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={clsx('rounded-md px-3 py-1', view === k ? 'bg-[#151619] text-white' : 'text-black/60')}>
              {k === 'circuitos' ? 'Por circuito' : 'Por caminhão'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[...byMaterial.entries()].map(([m, v]) => (
          <div key={m} className="rounded-lg bg-white px-3 py-2 shadow-sm">
            <p className="truncate text-[10px] font-bold tracking-widest text-black/45 uppercase" title={m}>{m}</p>
            <p className="font-mono text-lg font-bold tabular-nums">{t0(v.tonnes)} t</p>
            <p className="text-[11px] text-black/50">{v.trips} viagens · {hours > 0 ? t0(v.tonnes / hours) : 0} t/h</p>
          </div>
        ))}
      </div>

      {view === 'circuitos' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/45">
                <th className="py-1.5 pr-2 font-medium">Circuito</th>
                <th className="py-1.5 pr-2 text-right font-medium">Caminhões</th>
                <th className="py-1.5 pr-2 text-right font-medium">Viagens</th>
                <th className="py-1.5 pr-2 text-right font-medium">Toneladas</th>
                <th className="py-1.5 pr-2 text-right font-medium">Ciclo médio</th>
                <th className="py-1.5 pr-2 text-right font-medium">Fila por viagem</th>
                <th className="py-1.5 pr-2 text-right font-medium">Carga ocupada</th>
                <th className="py-1.5 pr-2 text-right font-medium">Carga em manutenção</th>
                <th className="py-1.5 text-right font-medium">Carga sem caminhão</th>
              </tr>
            </thead>
            <tbody>
              {tot.circuits.map((c) => {
                const cap = c.loaderBusyMin + c.loaderRepairMin + c.loaderIdleMin;
                return (
                  <tr key={c.circuit} className="border-b border-black/5">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium">{info[c.circuit]?.name ?? `Circuito ${c.circuit + 1}`}</span>
                      <span className="block text-[11px] text-black/45">{info[c.circuit]?.material}</span>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{c.trucks}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{c.trips}</td>
                    <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{t0(c.tonnes)} t</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{c.trips ? `${n1(c.cycleMin)} min` : '—'}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{c.trips ? `${n1(c.queueMin)} min` : '—'}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{pct(c.loaderBusyMin, cap)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{h1(c.loaderRepairMin)} h</td>
                    <td className="py-1.5 text-right tabular-nums">{pct(c.loaderIdleMin, cap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 bg-[#FAFBFB]">
              <tr className="border-b border-black/10 text-left text-xs text-black/45">
                <th className="py-1.5 pr-2 font-medium">Caminhão</th>
                <th className="py-1.5 pr-2 font-medium">Agora</th>
                {DOT_KINDS.map((k) => (
                  <th key={k.id} className="py-1.5 pr-2 text-right font-medium" title={k.label}>
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: DOT_COLORS[k.id] }} />
                    {SHORT[k.id]}
                  </th>
                ))}
                <th className="py-1.5 pr-2 text-right font-medium">Utilização</th>
                <th className="py-1.5 pr-2 text-right font-medium">Viagens</th>
                <th className="py-1.5 text-right font-medium">Toneladas</th>
              </tr>
            </thead>
            <tbody>
              {tot.trucks.map((x) => {
                const total = Object.values(x.min).reduce((a, b) => a + b, 0);
                const prod = x.min.carregado + x.min.vazio + x.min.carregando + x.min.descarregando;
                return (
                  <tr key={x.truck} className="border-b border-black/5">
                    <td className="py-1.5 pr-2">
                      <span className="font-medium">Nº {x.truck + 1}</span>
                      <span className="block text-[11px] text-black/45">{info[x.circuit]?.name}</span>
                    </td>
                    <td className="py-1.5 pr-2">
                      {x.current && (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DOT_COLORS[x.current] }} />
                          {DOT_KINDS.find((k) => k.id === x.current)?.label}
                        </span>
                      )}
                    </td>
                    {DOT_KINDS.map((k) => (
                      <td key={k.id} className="py-1.5 pr-2 text-right tabular-nums">{h1(x.min[k.id])}</td>
                    ))}
                    <td className="py-1.5 pr-2 text-right tabular-nums">{pct(prod, total)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{x.trips}</td>
                    <td className="py-1.5 text-right tabular-nums">{t0(x.tonnes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-black/45">Horas em cada estado desde o início da animação. Utilização = horas em viagem, carga e descarga ÷ horas totais.</p>
        </div>
      )}
    </div>
  );
};

const SHORT: Record<DotKind, string> = {
  carregado: 'Carregado (h)',
  vazio: 'Vazio (h)',
  carregando: 'Carga (h)',
  descarregando: 'Descarga (h)',
  fila: 'Fila (h)',
  interferencia: 'Interf. (h)',
  turno: 'Turno (h)',
  refeicao: 'Refeição (h)',
  abastecimento: 'Abast. (h)',
  manutencao: 'Manut. (h)',
  ocioso: 'Sem uso (h)',
};

export default AnimTables;
