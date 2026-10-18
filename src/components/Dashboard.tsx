import React, { useEffect, useMemo, useState } from 'react';
import { CalcReport } from './calc/CalcReport';
import { AlertTriangle, CheckCircle2, Download, Printer, RotateCcw, Trash2, Info } from 'lucide-react';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { DetailedPremises, Route } from '../types';
import { generatePortableHTML } from '../utils/export';
import { analyzeFleet, fmtTrucks, sumCalendarHours, type FleetAnalysis } from '@/engine/fleet';
import { t0, n1, n2, pc, Kpi, FlowBox, Arrow, HoursCascade, CycleBars, RouteTable, StageBar, Line2 } from './calc/parts';
import { KIND_LABELS } from '@/engine/fleet';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/**
 * Detalhes de cálculo: memória de cálculo do mês para gestores, do objetivo à frota.
 * Os números vêm do mesmo motor do Dimensionamento e do Resultado (engine/fleet);
 * o acompanhamento do mês vem dos lançamentos (results.dailyBreakdown).
 */

interface DashboardProps {
  results: any;
  premises: DetailedPremises;
  routes: Route[];
  analysis?: FleetAnalysis;
  productionLogs: Record<string, any[]>;
  setLogs: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  onReset?: () => void;
  onPremiseChange?: (newPremises: DetailedPremises) => void;
  companyName?: string;
  planName?: string;
}


const Dashboard: React.FC<DashboardProps> = ({ results, premises, routes, analysis: given, productionLogs, onReset, companyName, planName }) => {
  const a = useMemo(() => given ?? analyzeFleet(routes, premises), [given, routes, premises]);
  // nesta aba, imprimir (botão ou Ctrl+P) gera o relatório formatado, sem o menu do app
  useEffect(() => {
    document.body.classList.add('printing-report');
    return () => document.body.classList.remove('printing-report');
  }, []);
  const f = a.fleet;
  const bottleneck = a.bottleneck;
  const calMina = sumCalendarHours(premises, 'mina');
  const calPlanta = sumCalendarHours(premises, 'planta');
  const rom = a.routes.filter((r) => r.kind === 'rom');
  const romWet = rom.reduce((s, r) => s + r.targetWetT, 0);
  const prodDry = a.routes.filter((r) => r.kind === 'product').reduce((s, r) => s + r.targetDryT, 0);
  const tailDry = a.routes.filter((r) => r.kind === 'tailings').reduce((s, r) => s + r.targetDryT, 0);
  const plantStage = a.stages.find((s) => s.id === 'planta');
  const mineEff = rom[0]?.hours.effective ?? calMina * (premises.dfMina / 100) * (premises.ufMina / 100);

  const exportCSV = () => {
    const dec = (n: number, d = 2) => (n || 0).toFixed(d).replace('.', ',');
    const rows: (string | number)[][] = [
      ['Detalhes de cálculo', `${String(premises.month + 1).padStart(2, '0')}/${premises.year}`],
      [],
      ['Indicador', 'Valor'],
      ['Meta ROM (t seca/mês)', dec(a.romTargetDryT, 0)],
      ['Chega à planta (t seca/mês)', dec(a.romDeliverableDryT, 0)],
      ['Possível com a frota (t seca/mês)', dec(a.romPossibleDryT, 0)],
      ['Frota das premissas', f.premise],
      ['Caminhões nas rotas', dec(f.allocated)],
      ['Caminhões necessários', f.needed],
      ['Gargalo', bottleneck ? `${bottleneck.label} (${dec(bottleneck.ratio * 100, 1)}%)` : '-'],
      [],
      ['Etapa', 'Precisa (t/mês)', 'Capacidade (t/mês)', 'Atendimento (%)', 'Base'],
      ...a.stages.map((s) => [s.label, dec(s.needT, 0), dec(s.capacityT, 0), dec(s.ratio * 100, 1), s.basis]),
      [],
      ['Rota', 'Tipo', 'Meta úmida (t)', 'Carga (t)', 'Ciclo (min)', 't/h por caminhão', 'Horas efetivas', 't/mês por caminhão', 'Necessário (exato)', 'Necessário', 'Na rota', 'Atendimento (%)'],
      ...a.routes.map((r) => [r.name, KIND_LABELS[r.kind], dec(r.targetWetT, 0), dec(r.payloadT, 1), dec(r.cycle.totalMin), dec(r.truckRateTph), dec(r.hours.effective, 1), dec(r.truckMonthT, 0), dec(r.trucksNeededExact), r.trucksNeeded, dec(r.trucksAllocated), dec(r.ratio * 100, 1)]),
    ];
    const csv = '﻿' + rows.map((r) => r.join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `detalhes_calculo_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportHTML = () => {
    try {
      generatePortableHTML(premises, routes, productionLogs, results);
    } catch (error) {
      console.error('Erro ao gerar exportação HTML:', error);
      alert('Ocorreu um erro ao gerar o arquivo. Tente novamente.');
    }
  };

  return (
    <div className="space-y-6">
      <CalcReport analysis={a} premises={premises} results={results} companyName={companyName} planName={planName} />
      {/* ------------------------------ cabeçalho ------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-black/80">Detalhes de cálculo</h2>
          <p className="max-w-3xl text-sm text-black/50">
            Memória de cálculo do mês, do objetivo de produção até a frota. Os números são os mesmos do Dimensionamento de Frota e do Resultado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-4 py-2 text-sm font-semibold text-black/60 hover:bg-black/[0.02]">
            <Printer size={15} /> Imprimir / PDF
          </button>
          <button onClick={exportCSV} className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-4 py-2 text-sm font-semibold text-black/60 hover:bg-black/[0.02]">
            <Download size={15} /> Excel
          </button>
          <button onClick={exportHTML} className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-100">
            <Download size={15} /> Relatório portátil (.html)
          </button>
        </div>
      </div>

      {/* ------------------------------ veredito ------------------------------ */}
      <div className={`flex items-start gap-3 rounded-2xl border px-5 py-4 ${a.meetsTarget ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`} role="status">
        {a.meetsTarget ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <AlertTriangle size={20} className="mt-0.5 shrink-0" />}
        <p className="text-sm">
          {a.meetsTarget ? (
            <>
              <b>O plano atende a meta.</b> Chegam à planta {t0(a.romDeliverableDryT)} t de ROM no mês (meta {t0(a.romTargetDryT)} t), com {fmtTrucks(f.allocated)} dos {f.premise} caminhões nas rotas.
              {bottleneck ? ` A etapa mais justa é ${bottleneck.label.toLowerCase()}, com ${pc(bottleneck.ratio)} da necessidade.` : ''}
            </>
          ) : (
            <>
              <b>O plano não atende a meta.</b> Chegam {t0(a.romDeliverableDryT)} t de {t0(a.romTargetDryT)} t ({pc(a.romTargetDryT ? a.romDeliverableDryT / a.romTargetDryT : 0)}).
              {bottleneck ? ` O gargalo é ${bottleneck.label.toLowerCase()}: capacidade de ${t0(bottleneck.capacityT)} t para ${t0(bottleneck.needT)} t necessárias.` : ''}
            </>
          )}
        </p>
      </div>

      {/* ------------------------------ indicadores ------------------------------ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Meta de ROM" value={`${t0(a.romTargetDryT)} t`} sub="seca por mês (consumo da planta)" />
        <Kpi
          label="Chega à planta"
          value={`${t0(a.romDeliverableDryT)} t`}
          sub={`${pc(a.romTargetDryT ? a.romDeliverableDryT / a.romTargetDryT : 1)} da meta · possível ${t0(a.romPossibleDryT)} t`}
          tone={a.meetsTarget ? 'ok' : 'bad'}
        />
        <Kpi label="Caminhões" value={`${f.premise} / ${fmtTrucks(f.allocated)} / ${f.needed}`} sub={`frota / nas rotas / necessários (${n2(f.neededExact)} exatos)`} tone={f.allocated > f.premise + 1e-6 ? 'bad' : undefined} />
        <Kpi label="Etapa mais justa" value={bottleneck ? pc(bottleneck.ratio) : '—'} sub={bottleneck ? bottleneck.label : 'sem etapas'} tone={bottleneck && bottleneck.ratio < 0.999 ? 'bad' : 'ok'} />
      </div>

      {/* ------------------------------ 1. massas ------------------------------ */}
      <Section n={1} title="Do objetivo às massas transportadas" note={`Massa úmida = seca ${premises.moistureMode === 'base_umida' ? `÷ (1 − ${n1(premises.umidadeNatural)}%) × (1 + ${n1(premises.perdaMaterial)}%)` : `× (1 + ${n1(premises.umidadeNatural)}% umidade + ${n1(premises.perdaMaterial)}% perda)`}. Produto e rejeito saem do ROM pela recuperação mássica.`}>
        <div className="flex flex-wrap items-stretch gap-2">
          <FlowBox color="#059669" title="ROM na mina" main={`${t0(a.romTargetDryT)} t seca`} lines={[`${t0(romWet)} t úmidas transportadas`, `${n1(mineEff ? romWet / mineEff : 0)} t/h efetiva`]} />
          <Arrow />
          <FlowBox
            color="#334155"
            title="Planta"
            main={`${t0(plantStage?.capacityT ?? 0)} t de capacidade`}
            lines={[`${t0(premises.plantFeedRateTPH)} t/h × ${t0(a.planta.effective)} h efetivas`, plantStage ? `${pc(plantStage.ratio)} da alimentação necessária` : 'informe a taxa da planta']}
            warn={!!plantStage && plantStage.ratio < 0.999}
          />
          <Arrow />
          <div className="flex min-w-[200px] flex-1 flex-col gap-2">
            <FlowBox color="#2563eb" title={`Produto (${n1(premises.rmGlobal)}%)`} main={`${t0(prodDry)} t seca`} lines={['expedição']} />
            {premises.processType === 'umido' && <FlowBox color="#d97706" title={`Rejeito (${n1(premises.rejeitoTotal)}%)`} main={`${t0(tailDry)} t seca`} lines={['disposição']} />}
          </div>
        </div>
      </Section>

      {/* ------------------------------ 2. horas ------------------------------ */}
      <Section n={2} title="Horas disponíveis no mês" note="Horas efetivas = horas de calendário × DF (disponibilidade física) × UF (utilização). São as horas em que cada caminhão realmente transporta.">
        <div className="grid gap-6 md:grid-cols-2">
          <HoursCascade title="Mina (ROM e estéril)" cal={calMina} df={premises.dfMina} uf={premises.ufMina} />
          <HoursCascade title="Planta (produto e rejeito)" cal={calPlanta} df={premises.dfPlanta} uf={premises.ufPlanta} />
        </div>
      </Section>

      {/* ------------------------------ 3. ciclo ------------------------------ */}
      <Section n={3} title="Ciclo de cada caminhão" note="Ciclo = carga + viagem cheio + descarga + viagem vazio + pesagens + fila. Viagens por hora = 60 ÷ ciclo.">
        <CycleBars routes={a.routes} />
      </Section>

      {/* ------------------------------ 4. frota ------------------------------ */}
      <Section n={4} title="Frota necessária por rota" note="Caminhões necessários = meta úmida ÷ (carga útil × viagens por hora × horas efetivas). O número exato é arredondado para cima em cada rota.">
        <RouteTable routes={a.routes} totalNeeded={f.needed} totalExact={f.neededExact} totalAllocated={f.allocated} />
      </Section>

      {/* ------------------------------ 5. etapas ------------------------------ */}
      <Section n={5} title="Capacidade × necessidade por etapa" note="A produção que chega à planta é limitada pela etapa mais justa do caminho mina → planta. Acima de 100%, a etapa tem folga.">
        <div className="space-y-3">
          {a.stages.map((s) => (
            <StageBar key={s.id} label={s.label} need={s.needT} cap={s.capacityT} ratio={s.ratio} basis={s.basis} isBottleneck={bottleneck?.id === s.id} />
          ))}
          {!a.stages.length && <p className="text-sm text-black/50">Sem etapas para analisar: confira as metas e as rotas ativas.</p>}
        </div>
      </Section>

      {/* ------------------------------ 6. mês ------------------------------ */}
      <Section n={6} title="Acompanhamento do mês (lançamentos)" note="Planejado = meta diária das premissas. Realizado = ROM lançado em Lançamento Produção.">
        <MonthTracking results={results} target={premises.targetMonthlyROM} />
      </Section>

      {/* ------------------------------ 7. recomendações ------------------------------ */}
      {a.actions.length > 0 && (
        <Section n={7} title="O que fazer">
          <ol className="space-y-2">
            {a.actions.slice(0, 5).map((x, i) => (
              <li key={i} className="flex gap-3 rounded-xl bg-[#F8F9FA] px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#151619] text-xs font-bold text-white">{i + 1}</span>
                <div>
                  <p className="text-sm font-semibold text-black/80">{x.title}</p>
                  <p className="text-sm text-black/55">{x.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* ------------------------------ 8. e se ------------------------------ */}
      <WhatIf routes={routes} premises={premises} base={a} />

      {onReset && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-100 bg-white px-5 py-4 print:hidden">
          <p className="text-sm text-black/55">Apagar todos os lançamentos de produção do mês e voltar às premissas carregadas.</p>
          <button onClick={onReset} className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-100">
            <Trash2 size={15} /> Apagar lançamentos
          </button>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */

const Section: React.FC<{ n: number; title: string; note?: string; children: React.ReactNode }> = ({ n, title, note, children }) => (
  <section className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm print:break-inside-avoid print:shadow-none">
    <h3 className="mb-1 flex items-center gap-3 text-base font-bold text-black/80">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 font-mono text-sm text-emerald-700">{n}</span>
      {title}
    </h3>
    {note && <p className="mb-5 ml-10 text-xs text-black/50">{note}</p>}
    {!note && <div className="mb-4" />}
    {children}
  </section>
);

const MonthTracking: React.FC<{ results: any; target: number }> = ({ results, target }) => {
  const days: any[] = results?.dailyBreakdown ?? [];
  const weeks = useMemo(() => {
    const out: { label: string; plan: number; real: number; logged: number; n: number }[] = [];
    days.forEach((d, i) => {
      const w = Math.floor(i / 7);
      if (!out[w]) out[w] = { label: `Sem. ${w + 1}`, plan: 0, real: 0, logged: 0, n: 0 };
      out[w].plan += d.plannedMina || 0;
      out[w].n += 1;
      if (d.actualMina !== null) {
        out[w].real += d.actualMina;
        out[w].logged += 1;
      }
    });
    return out.map((w, i) => {
      const first = i * 7 + 1;
      return { ...w, label: `${w.label} (dias ${first}–${first + w.n - 1})` };
    });
  }, [days]);
  const logged = days.filter((d) => d.actualMina !== null);
  const planToDate = logged.reduce((s, d) => s + (d.plannedMina || 0), 0);
  const real = results?.totalActualProduction ?? 0;
  if (!days.length) return <p className="text-sm text-black/50">Sem calendário do mês.</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-1">
        <Line2 k="Realizado acumulado" v={`${t0(real)} t`} />
        <Line2 k="Planejado nos dias lançados" v={`${t0(planToDate)} t`} />
        <Line2 k="Aderência" v={planToDate ? pc(real / planToDate) : '—'} tone={planToDate && real < planToDate ? 'bad' : 'ok'} />
        <Line2 k="Dias lançados" v={`${logged.length} de ${days.length}`} />
        <Line2 k="Saldo da meta" v={`${t0(Math.max(0, target - real))} t`} />
        <Line2 k="Nova meta diária" v={`${t0(results?.requiredDailyProduction)} t/dia`} />
        {!logged.length && (
          <p className="flex items-start gap-2 pt-2 text-xs text-black/45">
            <Info size={13} className="mt-0.5 shrink-0" /> Ainda não há lançamentos. O gráfico mostra só o planejado.
          </p>
        )}
      </div>
      <div className="h-[240px] lg:col-span-2">
        <Bar
          data={{
            labels: weeks.map((w) => w.label),
            datasets: [
              { label: 'Planejado (t)', data: weeks.map((w) => Math.round(w.plan)), backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 6 },
              { label: 'Realizado (t)', data: weeks.map((w) => (w.logged ? Math.round(w.real) : null)) as (number | null)[], backgroundColor: '#059669', borderRadius: 6 },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: ${t0(c.parsed.y)}` } },
            },
            scales: { y: { beginAtZero: true, ticks: { callback: (v: any) => t0(Number(v)) } }, x: { grid: { display: false }, ticks: { font: { size: 10 } } } },
          }}
        />
      </div>
    </div>
  );
};

/** Simulação rápida que não altera o plano. */
const WhatIf: React.FC<{ routes: Route[]; premises: DetailedPremises; base: FleetAnalysis }> = ({ routes, premises, base }) => {
  const init = { target: premises.targetMonthlyROM, trucks: premises.truckCount, plant: premises.plantFeedRateTPH, dmt: 100 };
  const [v, setV] = useState(init);
  const changed = v.target !== init.target || v.trucks !== init.trucks || v.plant !== init.plant || v.dmt !== 100;
  const sim = useMemo(() => {
    const p = { ...premises, targetMonthlyROM: v.target, truckCount: v.trucks, plantFeedRateTPH: v.plant };
    const r = routes.map((x) => ({ ...x, distance: (x.distance || 0) * (v.dmt / 100) }));
    // distribui a frota simulada pelas rotas na proporção do necessário
    if (v.trucks === init.trucks) return analyzeFleet(r, p);
    const a0 = analyzeFleet(r, p);
    const need = a0.routes.reduce((s, x) => s + x.trucksNeededExact, 0) || 1;
    const scaled = r.map((x) => {
      const ar = a0.routes.find((y) => y.id === x.id);
      return ar ? { ...x, truckCount: (v.trucks * ar.trucksNeededExact) / need } : x;
    });
    return analyzeFleet(scaled, p);
  }, [v, routes, premises]);
  const delta = sim.romDeliverableDryT - base.romDeliverableDryT;
  return (
    <section className="rounded-3xl border border-black/5 bg-[#151619] p-6 text-white shadow-sm print:hidden">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">E se…? <span className="font-normal text-white/50">(não altera o plano)</span></h3>
          <p className="text-xs text-white/50">Mude meta, frota, capacidade da planta ou DMT e veja o efeito. Ao mudar a frota, ela é distribuída entre as rotas na proporção do necessário.</p>
        </div>
        <button onClick={() => setV(init)} disabled={!changed} className="flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40">
          <RotateCcw size={13} /> Voltar ao plano
        </button>
      </div>
      <div className="grid gap-6 md:grid-cols-4">
        <Slider label="Meta de ROM (t/mês)" value={v.target} min={Math.round(init.target * 0.5)} max={Math.round(init.target * 1.5) || 100000} step={1000} fmt={t0} onChange={(x) => setV({ ...v, target: x })} />
        <Slider label="Frota (caminhões)" value={v.trucks} min={1} max={Math.max(30, init.trucks * 2)} step={1} fmt={(x) => String(x)} onChange={(x) => setV({ ...v, trucks: x })} />
        <Slider label="Planta (t/h)" value={v.plant} min={Math.round(init.plant * 0.5)} max={Math.round(init.plant * 1.5) || 1000} step={5} fmt={t0} onChange={(x) => setV({ ...v, plant: x })} />
        <Slider label="DMT (% da atual)" value={v.dmt} min={50} max={150} step={5} fmt={(x) => `${x}%`} onChange={(x) => setV({ ...v, dmt: x })} />
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Dark label="Chega à planta" value={`${t0(sim.romDeliverableDryT)} t`} sub={changed ? `${delta >= 0 ? '+' : ''}${t0(delta)} t vs plano` : 'igual ao plano'} tone={sim.meetsTarget ? 'ok' : 'bad'} />
        <Dark label="Atende a meta?" value={sim.meetsTarget ? 'Sim' : 'Não'} sub={`${pc(sim.romTargetDryT ? sim.romDeliverableDryT / sim.romTargetDryT : 1)} da meta`} tone={sim.meetsTarget ? 'ok' : 'bad'} />
        <Dark label="Caminhões necessários" value={String(sim.fleet.needed)} sub={`${n2(sim.fleet.neededExact)} exatos`} />
        <Dark label="Etapa mais justa" value={sim.bottleneck ? pc(sim.bottleneck.ratio) : '—'} sub={sim.bottleneck?.label ?? ''} />
      </div>
    </section>
  );
};

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; fmt: (n: number) => string; onChange: (n: number) => void }> = ({ label, value, min, max, step, fmt, onChange }) => (
  <label className="block">
    <span className="flex justify-between text-[11px] font-semibold tracking-wide text-white/50 uppercase">
      {label} <b className="font-mono text-sm text-emerald-300 normal-case">{fmt(value)}</b>
    </span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-emerald-500" />
  </label>
);

const Dark: React.FC<{ label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }> = ({ label, value, sub, tone }) => (
  <div className="rounded-2xl bg-white/5 p-4">
    <p className="text-[10px] font-bold tracking-widest text-white/40 uppercase">{label}</p>
    <p className={`mt-1 font-mono text-xl font-bold ${tone === 'ok' ? 'text-emerald-400' : tone === 'bad' ? 'text-red-400' : 'text-white'}`}>{value}</p>
    {sub && <p className="text-[11px] text-white/45">{sub}</p>}
  </div>
);

export default Dashboard;
