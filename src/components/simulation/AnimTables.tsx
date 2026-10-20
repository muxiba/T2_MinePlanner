import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { DOT_KINDS, type DotKind, type makeAnimator } from '@/sim/animation';
import { DOT_COLORS } from './MapCanvas';
import { n1, t0 } from './ui';
import type { MonthCal } from '@/sim/plan';

/**
 * Tabela dinâmica da animação: o que a animação já gerou até o instante mostrado
 * (produção por material, tempos de cada caminhão e uso dos equipamentos de carga).
 */

type Animator = ReturnType<typeof makeAnimator>;

export interface AnimInfo {
  name: string;
  material: string;
  /** veículo do circuito: mina / fora de estrada ou rodoviário */
  vehicle?: 'mina' | 'rodoviario';
}

export interface AnimPeriod {
  label: string;
  calendarDays: number;
  workDays: number;
  /** calendário mensal do plano (para a perda nos meses chuvosos) */
  months?: MonthCal[];
}

const h1 = (min: number) => n1(min / 60);
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');

const AnimTables: React.FC<{ animator: Animator; from: number; t: number; info: AnimInfo[]; period?: AnimPeriod }> = ({ animator, from, t, info, period }) => {
  const [view, setView] = useState<'circuitos' | 'caminhoes' | 'matriz'>('circuitos');
  // recalcula a cada minuto simulado (em animações longas, a cada fração da duração, para não pesar)
  const q = Math.max(1, Math.round(animator.end / 3000));
  const minute = t >= animator.end ? animator.end : Math.floor(t / q) * q;
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
          {(['circuitos', 'caminhoes', 'matriz'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={clsx('rounded-md px-3 py-1', view === k ? 'bg-[#151619] text-white' : 'text-black/60')}>
              {k === 'circuitos' ? 'Por circuito' : k === 'caminhoes' ? 'Por caminhão' : 'Matriz do período'}
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

      {view === 'matriz' ? (
        <PeriodMatrix tot={tot} info={info} period={period} />
      ) : view === 'circuitos' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/45">
                <th className="py-1.5 pr-2 font-medium">Circuito</th>
                <th className="py-1.5 pr-2 font-medium">Veículo</th>
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
                    <td className="py-1.5 pr-2 text-xs">{info[c.circuit]?.vehicle === 'rodoviario' ? <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-800">rodoviário</span> : 'mina'}</td>
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

/* -------------------------------------------------------------------------- */
/* Matriz do período: o tempo e a produção da frota no período inteiro          */
/* -------------------------------------------------------------------------- */

type Totals = ReturnType<Animator['totals']>;

const ROWS: { id: string; label: string; kinds: DotKind[]; note: string; productive?: boolean; road?: boolean }[] = [
  { id: 'prod', label: 'Viagem, carga e descarga', kinds: ['carregado', 'vazio', 'carregando', 'descarregando'], note: 'tempo que produz', productive: true },
  { id: 'fila', label: 'Filas (carga, balança, descarga)', kinds: ['fila'], note: 'espera por recurso ocupado' },
  { id: 'interf', label: 'Interferências nas vias da mina', kinds: ['interferencia'], note: 'cruzamentos, apoio, equipamentos' },
  { id: 'interfRod', label: 'Interferências na estrada (rodoviários)', kinds: ['interferencia'], note: 'tráfego, travessias, pedágio', road: true },
  { id: 'turno', label: 'Troca de turno e inspeção', kinds: ['turno'], note: 'início de cada turno' },
  { id: 'refeicao', label: 'Refeição', kinds: ['refeicao'], note: 'no meio do turno, em revezamento' },
  { id: 'abast', label: 'Abastecimento e lubrificação', kinds: ['abastecimento'], note: '1 vez por dia' },
  { id: 'manut', label: 'Manutenção', kinds: ['manutencao'], note: 'quebras e reparos (DF)' },
  { id: 'ocioso', label: 'Fora do turno e outras perdas', kinds: ['ocioso'], note: 'horas sem operação e parte da UF' },
];

const PeriodMatrix: React.FC<{ tot: Totals; info: AnimInfo[]; period?: AnimPeriod }> = ({ tot, info, period }) => {
  const n = tot.trucks.length;
  const spanDays = tot.span / 1440;
  if (!n || spanDays <= 0) return <p className="text-sm text-black/50">Reproduza a animação para preencher a matriz.</p>;
  const isRoad = (ci: number) => info[ci]?.vehicle === 'rodoviario';
  // minutos da frota em cada linha durante a janela animada
  const minOf = (r: (typeof ROWS)[number]) =>
    tot.trucks.reduce((a, x) => {
      if (r.id === 'interf' && isRoad(x.circuit)) return a;
      if (r.id === 'interfRod' && !isRoad(x.circuit)) return a;
      return a + r.kinds.reduce((b, k) => b + x.min[k], 0);
    }, 0);
  const rows = ROWS.map((r) => ({ ...r, min: minOf(r) })).filter((r) => r.min > 0.5 || r.productive);
  const fleetMin = tot.span * n;
  const tonnes = tot.trucks.reduce((a, x) => a + x.tonnes, 0);
  const prodMin = rows.find((r) => r.productive)?.min ?? 0;
  const tPerDay = tonnes / spanDays;
  const tPerProdH = prodMin > 0 ? tonnes / (prodMin / 60) : 0;
  const cal = period?.calendarDays ?? spanDays;
  const work = Math.min(cal, period?.workDays ?? spanDays);
  const offDays = Math.max(0, cal - work);
  const calH = cal * 24 * n;
  const scale = (min: number) => (min / fleetMin) * work * 24 * n; // h da frota no período
  const months = period?.months;
  const dryRatio = months?.length ? Math.max(0, ...months.filter((m) => m.season === 'seco').map((m) => m.workDays / Math.max(1, m.days))) || 26 / 30 : 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-black/55">
        A animação simulou {n1(spanDays)} dia(s) de operação; a matriz projeta essas proporções para o período {period ? <b>{period.label}</b> : 'animado'}
        {period && <> ({n1(work)} dias trabalhados de {n1(cal)} corridos)</>}, com {n} caminhões. Assim se vê o cenário inteiro: o que produz, o que espera, o que para e o que se perde com chuva e folgas.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/45">
              <th className="py-1.5 pr-2 font-medium">Atividade</th>
              <th className="py-1.5 pr-2 text-right font-medium">% do calendário</th>
              <th className="py-1.5 pr-2 text-right font-medium">h por caminhão</th>
              <th className="py-1.5 pr-2 text-right font-medium">h da frota</th>
              <th className="py-1.5 pr-2 text-right font-medium">Equivale a (t)</th>
              <th className="py-1.5 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const h = scale(r.min);
              return (
                <tr key={r.id} className={clsx('border-b border-black/5', r.productive && 'font-semibold')}>
                  <td className="py-1.5 pr-2">{r.label}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{pct(h, calH)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{t0(h / n)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{t0(h)}</td>
                  <td className={clsx('py-1.5 pr-2 text-right tabular-nums', !r.productive && 'text-red-700')}>{r.productive ? t0(tPerDay * work) : `−${t0(h * tPerProdH)}`}</td>
                  <td className="py-1.5 text-xs text-black/50">{r.productive ? 'produção do período' : r.note}</td>
                </tr>
              );
            })}
            {offDays > 0.05 && (
              <tr className="border-b border-black/5">
                <td className="py-1.5 pr-2">Dias não trabalhados (chuva, folgas, feriados)</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{pct(offDays * 24 * n, calH)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t0(offDays * 24)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t0(offDays * 24 * n)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-red-700">−{t0(offDays * tPerDay)}</td>
                <td className="py-1.5 text-xs text-black/50">calendário do plano</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-black/30 font-semibold">
              <td className="py-1.5 pr-2">Calendário do período</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">100%</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{t0(cal * 24)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{t0(calH)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{t0(tPerDay * work)} t</td>
              <td className="py-1.5 text-xs font-normal text-black/50">{t0(tPerDay)} t por dia trabalhado</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-black/45">
        “Equivale a” = horas paradas × produção por hora produtiva de caminhão ({t0(tPerProdH)} t/h): quanto se produziria se aquele tempo fosse produtivo. Indica onde está o maior potencial de ganho; não é somável com a produção.
      </p>

      {months && months.length > 0 && (
        <div className="overflow-x-auto">
          <p className="mb-1 text-sm font-medium">Produção por mês do calendário (ritmo desta animação)</p>
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-xs text-black/45">
                <th className="py-1.5 pr-2 font-medium">Mês</th>
                <th className="py-1.5 pr-2 font-medium">Estação</th>
                <th className="py-1.5 pr-2 text-right font-medium">Dias</th>
                <th className="py-1.5 pr-2 text-right font-medium">Dias trabalhados</th>
                <th className="py-1.5 pr-2 text-right font-medium">Produção (t)</th>
                <th className="py-1.5 text-right font-medium">Perdida pela chuva (t)</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const lost = m.season === 'chuvoso' ? Math.max(0, m.days * dryRatio - m.workDays) * tPerDay : 0;
                return (
                  <tr key={m.month} className={clsx('border-b border-black/5', m.season === 'chuvoso' && 'bg-sky-50/50')}>
                    <td className="py-1 pr-2">{m.month}</td>
                    <td className="py-1 pr-2 text-xs">{m.season === 'chuvoso' ? 'chuvoso' : 'seco'}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{m.days}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{n1(m.workDays)}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{t0(m.workDays * tPerDay)}</td>
                    <td className="py-1 text-right tabular-nums text-red-700">{lost > 0.5 ? `−${t0(lost)}` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black/30 font-semibold">
                <td className="py-1.5 pr-2" colSpan={2}>Ano</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{months.reduce((a, m) => a + m.days, 0)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n1(months.reduce((a, m) => a + m.workDays, 0))}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t0(months.reduce((a, m) => a + m.workDays, 0) * tPerDay)}</td>
                <td className="py-1.5 text-right tabular-nums text-red-700">−{t0(months.reduce((a, m) => a + (m.season === 'chuvoso' ? Math.max(0, m.days * dryRatio - m.workDays) : 0), 0) * tPerDay)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-1 text-[11px] text-black/45">
            Perdida pela chuva = (dias do mês × {pct(dryRatio, 1)} de dias trabalhados de um mês seco − dias trabalhados) × {t0(tPerDay)} t por dia. Edite o calendário em Plano de lavra → Calendário; a mudança vale para toda a simulação.
          </p>
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
