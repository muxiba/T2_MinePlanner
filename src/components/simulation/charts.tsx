import React, { useState } from 'react';
import type { SweepPoint } from '@/sim/des';
import type { TruckState } from '@/sim/types';

const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Produção (t/dia) × número de caminhões, com faixa de confiança e linha da meta. */
export const SweepChart: React.FC<{
  points: SweepPoint[];
  target: number;
  minFleet: number | null;
  saturation: number;
  scope?: 'sistema' | 'circuito';
}> = ({ points, target, minFleet, saturation, scope = 'sistema' }) => {
  const [hover, setHover] = useState<number | null>(null);
  const v = (p: SweepPoint) => p.value ?? p.stats.tpd;
  if (!points.length) return null;
  const W = 640;
  const H = 280;
  const m = { l: 56, r: 16, t: 16, b: 36 };
  const xs = points.map((p) => p.trucks);
  const raw = Math.max(target, ...points.map((p) => v(p).hi)) * 1.08 || 1;
  const mag = 10 ** Math.floor(Math.log10(raw / 5));
  const stepTick = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((st) => raw / st <= 6) ?? 10 * mag;
  const ymax = Math.ceil(raw / stepTick) * stepTick;
  const x = (n: number) => m.l + ((n - Math.min(...xs)) / Math.max(1, Math.max(...xs) - Math.min(...xs))) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / ymax) * (H - m.t - m.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.trucks)},${y(v(p).mean)}`).join(' ');
  const band =
    points.map((p, i) => `${i ? 'L' : 'M'}${x(p.trucks)},${y(v(p).hi)}`).join(' ') +
    ' ' +
    [...points].reverse().map((p) => `L${x(p.trucks)},${y(v(p).lo)}`).join(' ') +
    ' Z';
  const ticks = Array.from({ length: Math.round(ymax / stepTick) }, (_, i) => stepTick * (i + 1));
  const hp = hover !== null ? points[hover] : null;

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Produção diária por número de caminhões">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="#000" strokeOpacity={0.06} />
            <text x={m.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#6b6a65">
              {t0(v)}
            </text>
          </g>
        ))}
        <line x1={m.l} x2={W - m.r} y1={H - m.b} y2={H - m.b} stroke="#000" strokeOpacity={0.25} />
        {points.map((p) => (
          <text key={p.trucks} x={x(p.trucks)} y={H - m.b + 16} textAnchor="middle" fontSize={11} fill="#6b6a65">
            {p.trucks}
          </text>
        ))}
        <text x={(W + m.l) / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="#6b6a65">
          caminhões no circuito
        </text>
        <path d={band} fill="#2a78d6" fillOpacity={0.12} />
        {target > 0 && (
          <g>
            <line x1={m.l} x2={W - m.r} y1={y(target)} y2={y(target)} stroke="#151619" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={W - m.r} y={y(target) - 6} textAnchor="end" fontSize={11} fill="#151619" fontWeight={600}>
              meta {t0(target)} t/dia
            </text>
          </g>
        )}
        <path d={line} fill="none" stroke="#2a78d6" strokeWidth={2} />
        {points.map((p, i) => {
          const special = p.trucks === minFleet;
          return (
            <g key={p.trucks}>
              <circle
                cx={x(p.trucks)}
                cy={y(v(p).mean)}
                r={special ? 6 : 4}
                fill={special ? '#151619' : '#2a78d6'}
                stroke="#fff"
                strokeWidth={2}
              />
              <rect
                x={x(p.trucks) - 14}
                y={m.t}
                width={28}
                height={H - m.t - m.b}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
        {hp && <line x1={x(hp.trucks)} x2={x(hp.trucks)} y1={m.t} y2={H - m.b} stroke="#000" strokeOpacity={0.2} />}
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute rounded-lg bg-[#151619] px-3 py-2 text-xs text-white shadow-lg"
          style={{ left: `${(x(hp.trucks) / W) * 100}%`, top: 8, transform: 'translateX(-50%)' }}
        >
          <p className="font-semibold">{hp.trucks} caminhões</p>
          <p className="tabular-nums">
            {t0(v(hp).mean)} t/dia ({t0(v(hp).lo)}–{t0(v(hp).hi)})
          </p>
          <p className="tabular-nums text-white/70">
            fila na carga {n1(hp.stats.queueLoadMin.mean)} min · carga {Math.round(hp.stats.loaderUtil.mean * 100)}% ocupada
          </p>
        </div>
      )}
      <figcaption className="mt-2 text-xs text-black/50">
        {scope === 'circuito' && `Produção deste circuito, com os demais na frota cadastrada${target > 0 ? '; a linha tracejada é a meta deste circuito por dia trabalhado' : ''}. `}
        {minFleet ? `Frota mínima para a meta: ${minFleet} caminhões (ponto escuro). ` : target > 0 ? 'Nenhuma frota testada atinge a meta. ' : ''}
        A partir de {saturation} caminhões, cada caminhão a mais rende menos de 3%: o gargalo passa a ser a carga ou a descarga. Faixa azul:
        intervalo de 95% entre as repetições.
      </figcaption>
    </figure>
  );
};

/* Composição do ciclo: estados agrupados em 5 etapas (paleta categórica validada, ordem fixa). */
export const CYCLE_GROUPS: { key: string; label: string; color: string; states: TruckState[] }[] = [
  { key: 'fila', label: 'Filas', color: '#2a78d6', states: ['fila_carga', 'fila_balanca', 'fila_descarga'] },
  { key: 'carga', label: 'Carga', color: '#eb6834', states: ['carregando'] },
  { key: 'ida', label: 'Ida carregado', color: '#1baf7a', states: ['carregado'] },
  { key: 'desc', label: 'Pesagem, manobra e descarga', color: '#eda100', states: ['pesando', 'descarregando'] },
  { key: 'volta', label: 'Retorno vazio', color: '#e87ba4', states: ['vazio'] },
];

export const CycleBars: React.FC<{ rows: { label: string; cycle: Partial<Record<TruckState, number>> }[] }> = ({ rows }) => {
  const [hover, setHover] = useState<string | null>(null);
  const totals = rows.map((r) => CYCLE_GROUPS.reduce((a, g) => a + g.states.reduce((b, s) => b + (r.cycle[s] ?? 0), 0), 0));
  const max = Math.max(...totals, 1);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/60">
        {CYCLE_GROUPS.map((g) => (
          <span key={g.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />
            {g.label}
          </span>
        ))}
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.label}>
            <div className="mb-1 flex justify-between text-sm">
              <span className="font-medium">{r.label}</span>
              <span className="tabular-nums text-black/60">{n1(totals[i])} min por ciclo</span>
            </div>
            <div className="flex h-5 gap-[2px]" style={{ width: `${(totals[i] / max) * 100}%` }}>
              {CYCLE_GROUPS.map((g) => {
                const v = g.states.reduce((b, s) => b + (r.cycle[s] ?? 0), 0);
                if (v <= 0.01) return null;
                const id = `${r.label}-${g.key}`;
                return (
                  <div
                    key={g.key}
                    className="relative h-full first:rounded-l last:rounded-r"
                    style={{ width: `${(v / totals[i]) * 100}%`, background: g.color, opacity: hover && hover !== id ? 0.55 : 1 }}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    title={`${g.label}: ${n1(v)} min`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
