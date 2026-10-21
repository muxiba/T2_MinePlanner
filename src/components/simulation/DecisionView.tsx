import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Award, Download, FileText, Play } from 'lucide-react';
import type { SimModel } from '@/sim/types';
import type { DetailedPremises } from '@/types';
import { FLOW_LABELS, type CircuitCalc, type PeriodKind } from '@/sim/link';
import { calendarWorkDays, emptyPlan, type PeriodResult } from '@/sim/plan';
import { CASH_ITEMS, CRITERIA, economicLife, financeFor, DRIVER_CATS, cashFlow, costDrivers, defaultFinance, evaluate, explainDifference, rank, sensitivity, type Criterion, type Evaluation } from '@/sim/econ';
import { downloadMemo } from '@/sim/memo';
import { decisionMemo } from '@/sim/memoDecision';
import { runInWorker } from '@/sim/client';
import { Btn, Card, Progress, inputCls, n1, t0 } from './ui';

const brl0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const brl2 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mi = (n: number) => `R$ ${(n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Categorias de custo (paleta categórica, ordem fixa). */
const COST_CATS = [
  { key: 'capex', label: 'Equipamentos (compra − residual)', color: '#2a78d6' },
  { key: 'diesel', label: 'Diesel dos caminhões', color: '#eb6834' },
  { key: 'maintenance', label: 'Manutenção', color: '#1baf7a' },
  { key: 'tires', label: 'Pneus', color: '#eda100' },
  { key: 'labor', label: 'Mão de obra', color: '#e87ba4' },
  { key: 'loaders', label: 'Equipamento de carga', color: '#8a5cd6' },
  { key: 'overhead', label: 'Custos fixos', color: '#8a8984' },
] as const;

interface Props {
  model: SimModel;
  /** para o modo simples (circuitos da aba Circuito) */
  premises?: DetailedPremises;
  calc?: CircuitCalc[];
  romT?: number;
  /** período da aba Circuito (horizonte do modo simples) */
  resultsKey?: string | null;
  setResultsKey?: (k: string | null) => void;
  horizon?: { kind: PeriodKind; qty: number; days?: number; workDays: number; calendarDays: number; romT: number };
  results: PeriodResult[] | null;
  setResults: (r: PeriodResult[] | null) => void;
  onError: (m: string | null) => void;
}

const DecisionView: React.FC<Props> = ({ model, premises, calc, romT, horizon, resultsKey, setResultsKey, results, setResults, onError }) => {
  const plan = model.plan ?? emptyPlan();
  const fin = model.finance ?? defaultFinance(model.configs);
  const [criterion, setCriterion] = useState<Criterion>('equilibrado');
  const [busy, setBusy] = useState<{ f: number; stage?: string } | null>(null);
  const [pick, setPick] = useState<string | null>(null);

  const [basisMode, setBasisMode] = useState<'circuito' | 'plano'>(plan.movements.length > 0 ? 'plano' : 'circuito');
  const genericOk = !!calc?.length && (romT ?? 0) > 0 && model.routes.length > 0;
  const ready = basisMode === 'plano' ? plan.movements.length > 0 && model.routes.length > 0 : genericOk;
  const combos = useMemo(() => {
    if (!results) return [];
    const keys = [...new Set(results.map((r) => `${r.configId}|${r.scenarioId ?? ''}`))];
    return keys
      .map((k) => {
        const [configId, scenarioId] = k.split('|');
        const cfg = model.configs.find((c) => c.id === configId);
        return { results: results.filter((r) => r.configId === configId && (r.scenarioId ?? '') === scenarioId), configId, scenarioId, payloadT: cfg?.payloadT ?? 40 };
      })
      .filter((c) => model.configs.some((x) => x.id === c.configId));
  }, [results, model.configs]);
  const [compare, setCompare] = useState<'config' | 'todas'>('config');
  const allEvals = useMemo(() => combos.map((c) => evaluate(c.results, plan, fin, c.configId, c.payloadT, c.scenarioId)), [combos, plan, fin]);
  const scenIdsRun = useMemo(() => [...new Set(allEvals.map((e) => e.scenarioId))], [allEvals]);
  const refScenario = scenIdsRun.includes(model.scenarios[0]?.id) ? model.scenarios[0].id : scenIdsRun[0];
  /** por configuração: o pior caso de produção e a média de custo entre os cenários */
  const evals = useMemo(() => {
    if (compare === 'todas' || scenIdsRun.length < 2) return allEvals;
    const byCfg = new Map<string, Evaluation[]>();
    for (const e of allEvals) byCfg.set(e.configId, [...(byCfg.get(e.configId) ?? []), e]);
    return [...byCfg.entries()].map(([configId, list]) => {
      const ref = list.find((e) => e.scenarioId === refScenario) ?? list[0];
      const avg = (f: (e: Evaluation) => number) => list.reduce((a, e) => a + f(e), 0) / list.length;
      const npvs = list.map((e) => e.npv);
      return {
        ...ref,
        configId,
        scenarioId: '*',
        allOk: list.every((e) => e.allOk),
        minMargin: Math.min(...list.map((e) => e.minMargin)),
        peakTrucks: Math.max(...list.map((e) => e.peakTrucks)),
        people: Math.max(...list.map((e) => e.people)),
        capex: avg((e) => e.capex),
        npvCost: avg((e) => e.npvCost),
        costPerT: avg((e) => e.costPerT),
        npv: npvs.every((v) => v !== null) ? avg((e) => e.npv ?? 0) : null,
        replacements: Math.max(...list.map((e) => e.replacements)),
        range: [Math.min(...list.map((e) => e.costPerT)), Math.max(...list.map((e) => e.costPerT))] as [number, number],
      } as Evaluation & { range?: [number, number] };
    });
  }, [allEvals, compare, scenIdsRun.length, refScenario]);
  const ranked = useMemo(() => rank(evals, criterion), [evals, criterion]);
  const keyOf = (e: { configId: string; scenarioId: string }) => `${e.configId}|${e.scenarioId}`;
  const best = ranked[0];
  const chosen = ranked.find((e) => keyOf(e) === pick) ?? best;
  const sens = useMemo(
    () => {
      if (!chosen || !combos.length) return [];
      if (chosen.scenarioId !== '*') return sensitivity(combos, plan, fin, chosen, criterion);
      // por configuração: sensibilidade no cenário de referência
      const ref = combos.filter((c) => c.scenarioId === refScenario);
      return sensitivity(ref, plan, fin, { configId: chosen.configId, scenarioId: refScenario }, criterion).map((r) => ({
        ...r,
        winnerLow: r.winnerLow.replace(`|${refScenario}`, '|*'),
        winnerHigh: r.winnerHigh.replace(`|${refScenario}`, '|*'),
      }));
    },
    [chosen, combos, plan, fin, criterion],
  );
  const cfgName = (id: string) => model.configs.find((c) => c.id === id)?.name ?? id;
  const ecoAge = chosen ? economicLife(financeFor(fin, chosen.configId, model.configs.find((c) => c.id === chosen.configId)?.payloadT ?? 40))?.ageH ?? null : null;
  const scName = (id: string) => model.scenarios.find((s) => s.id === id)?.name ?? id;
  const optName = (e: { configId: string; scenarioId: string }) => (e.scenarioId !== '*' && scenIdsRun.length > 1 ? `${cfgName(e.configId)} · ${scName(e.scenarioId)}` : cfgName(e.configId));
  const withRevenue = fin.revenuePerT > 0;

  const buildMemo = () =>
    decisionMemo({ model, plan, fin, ranked, chosen: chosen!, criterion, sens, optName, compareNote: [compare === 'config' && scenIdsRun.length > 1 ? 'Cada configuração é avaliada em todos os cenários: precisa cumprir a meta no pior deles, e o custo é a média entre eles.' : '', basisMode === 'circuito' ? 'Modo simples: circuitos da aba Circuito com os períodos e o calendário do plano.' : ''].filter(Boolean).join(' ') || undefined });
  const [pdfBusy, setPdfBusy] = useState(false);
  const memoPdf = async () => {
    setPdfBusy(true);
    try {
      const { memoToPdf } = await import('@/sim/memoPdf');
      await memoToPdf(buildMemo(), 'memorial_resultados_decisao.pdf');
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfBusy(false);
    }
  };

  /**
   * Horizonte do modo simples = período da aba Circuito, dividido em anos (anos e quinquênios) ou meses.
   * A massa de cada ano = ROM do período ÷ nº de anos; se o Plano de lavra tiver o mesmo nº de períodos
   * com ROM definido (curva de produção), usa a curva.
   */
  const genericPeriods = () => {
    const h = horizon;
    const yearWork = calendarWorkDays(plan.calendar) || 300;
    if (!h) return plan.periods.map((p) => ({ label: p.label, workDays: p.workDays, romT: p.romT ?? 0 }));
    if (h.kind === 'ano' || h.kind === 'quinquenio') {
      const n = Math.max(1, Math.round(h.qty * (h.kind === 'quinquenio' ? 5 : 1)));
      const curve = plan.periods.length === n && plan.periods.every((p) => (p.romT ?? 0) > 0) ? plan.periods.map((p) => p.romT!) : null;
      return Array.from({ length: n }, (_, i) => ({ label: `Ano ${i + 1}`, workDays: yearWork, romT: curve ? curve[i] : h.romT / n }));
    }
    if (h.kind === 'mes' && h.qty > 1) {
      const n = Math.max(1, Math.round(h.qty));
      return Array.from({ length: n }, (_, i) => ({ label: `Mês ${i + 1}`, workDays: h.workDays / n, romT: h.romT / n }));
    }
    return [{ label: h.kind === 'mes' ? 'Mês 1' : `${Math.round(h.calendarDays)} dias`, workDays: h.workDays, romT: h.romT }];
  };
  const horizonKey = basisMode === 'circuito' ? JSON.stringify(genericPeriods().map((p) => [p.label, Math.round(p.romT)])) : JSON.stringify(plan.periods.map((p) => [p.label, p.workDays]));
  const stale = !!results && !!resultsKey && resultsKey !== horizonKey;
  const runAll = async () => {
    onError(null);
    setBusy({ f: 0 });
    try {
      const configIds = model.configs.map((c) => c.id);
      const scenarioIds = model.scenarios.map((s) => s.id);
      const res =
        basisMode === 'circuito'
          ? await runInWorker<PeriodResult[]>(
              {
                kind: 'genericPeriods',
                model,
                basis: {
                  ratio: Object.fromEntries((calc ?? []).map((c) => [c.circuitId, (romT ?? 0) > 0 ? c.tonnes / romT! : 0])),
                  material: Object.fromEntries((calc ?? []).map((c) => [c.circuitId, FLOW_LABELS[c.flow]])),
                },
                periods: genericPeriods(),
                configIds,
                scenarioIds,
                aging: true,
              },
              (f, stage) => setBusy({ f, stage }),
            )
          : await runInWorker<PeriodResult[]>({ kind: 'periods', model: { ...model, plan }, configIds, scenarioIds, aging: true }, (f, stage) => setBusy({ f, stage }));
      setResults(res);
      setResultsKey?.(horizonKey);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    const dec = (n: number, d = 0) => n.toFixed(d).replace('.', ',');
    const head = ['Posição', 'Configuração', 'Cenário', 'Atende a meta', 'Folga mínima', 'Pico de caminhões', 'Pessoas (pico)', 'Investimento (R$)', 'VPL dos custos (R$)', 'Custo nivelado (R$/t)', 'VPL (R$)', 'Trocas por vida útil', 'Toneladas'];
    const rows = ranked.map((e, i) => [String(i + 1), cfgName(e.configId), scName(e.scenarioId), e.allOk ? 'sim' : 'não', dec(e.minMargin * 100) + '%', String(e.peakTrucks), dec(e.people, 1), dec(e.capex), dec(e.npvCost), dec(e.costPerT, 2), e.npv === null ? '' : dec(e.npv), String(e.replacements), dec(e.tonnes)]);
    const per = chosen
      ? [[], ['Períodos da opção', optName(chosen)], ['Período', 'Caminhões', 'Frota total', 'Compras', 'Trocas', 'Idade média (h)', 'Toneladas', 'Diesel (L)', 'Custo (R$)', 'R$/t'], ...chosen.periods.map((p) => [p.label, String(p.trucks), String(p.fleetSize), String(p.bought), String(p.replaced), dec(p.avgAgeH), dec(p.tonnes), dec(p.dieselL), dec(p.total), dec(p.tonnes ? p.total / p.tonnes : 0, 2)])]
      : [];
    const csv = '﻿' + [head, ...rows, ...per].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decisao_frota.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const modeSwitch = (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-black/[0.07] bg-white p-4 text-sm">
      <span className="font-medium">Base da simulação</span>
      <div className="inline-flex rounded-lg border border-black/10 bg-[#F8F9FA] p-0.5 text-xs" role="tablist">
        {(['circuito', 'plano'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={basisMode === k} onClick={() => { setBasisMode(k); setResults(null); }} className={clsx('rounded-md px-3 py-1.5', basisMode === k ? 'bg-[#151619] text-white' : 'text-black/60')}>
            {k === 'circuito' ? 'Simples: circuitos + calendário' : 'Detalhado: plano de lavra por período'}
          </button>
        ))}
      </div>
      <span className="text-xs text-black/50">
        {basisMode === 'circuito'
          ? 'Usa as rotas e os circuitos da aba Circuito (carga e basculamento) e os períodos e o calendário do plano (estação chuvosa). A massa de cada período vem do ROM do período (Plano de lavra → Calendário e períodos, ou meta das premissas).'
          : 'Usa frentes, polígonos de lavra, pontos de basculamento e rotas de cada período do Plano de lavra.'}
      </span>
      <span className="w-full text-xs font-medium text-black/70">
        Horizonte do fluxo de caixa:{' '}
        {basisMode === 'circuito'
          ? (() => {
              const g = genericPeriods();
              return `${g.length} período(s) (${g[0]?.label}${g.length > 1 ? ` a ${g[g.length - 1].label}` : ''}), da duração em Circuito → Período simulado.`;
            })()
          : `${plan.periods.length} período(s) do Plano de lavra (${plan.periods[0]?.label ?? ''}${plan.periods.length > 1 ? ` a ${plan.periods[plan.periods.length - 1].label}` : ''}); mude em Plano de lavra → Calendário e períodos.`}
      </span>
      {stale && (
        <span className="w-full rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          O horizonte mudou depois da última simulação: os resultados abaixo são do horizonte anterior. Clique em “Simular de novo”.
        </span>
      )}
    </div>
  );

  if (!ready)
    return (
      <div className="space-y-4">
        {modeSwitch}
        <p className="rounded-xl border border-black/[0.07] bg-white p-5 text-sm text-black/55">
          {basisMode === 'plano'
            ? 'Para o modo detalhado, preencha o Plano de lavra (lugares e movimentações; pode ser um único período). Ou use o modo simples, que só precisa dos circuitos.'
            : 'Para o modo simples, importe ao menos uma rota na aba Circuito e confira a meta de ROM do período.'}
        </p>
      </div>
    );

  const missing = model.configs.length * model.scenarios.length - combos.length;
  const second = ranked[1];

  return (
    <div className="space-y-6">
      {modeSwitch}
      <Card
        title="Resultados e decisão"
        description="Compara todas as configurações de caminhão em todos os cenários, ao longo dos períodos do plano, por produção e por custo."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-black/55">
              Critério de escolha
              <select className={clsx(inputCls, 'mt-1 w-72')} value={criterion} onChange={(e) => setCriterion(e.target.value as Criterion)}>
                {CRITERIA.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </label>
            {scenIdsRun.length > 1 && (
              <label className="text-xs text-black/55">
                Comparar
                <select className={clsx(inputCls, 'mt-1 w-64')} value={compare} onChange={(e) => setCompare(e.target.value as 'config' | 'todas')}>
                  <option value="config">Configurações (todos os cenários)</option>
                  <option value="todas">Cada configuração × cenário</option>
                </select>
              </label>
            )}
            <Btn onClick={() => void runAll()} busy={busy !== null}>
              <Play size={15} /> {results ? 'Simular de novo' : 'Simular todas as opções'}
            </Btn>
            {ranked.length > 0 && (
              <Btn tone="light" onClick={exportCsv}>
                <Download size={15} /> Exportar (Excel)
              </Btn>
            )}
            {ranked.length > 0 && chosen && (
              <>
                <Btn tone="light" busy={pdfBusy} onClick={() => void memoPdf()}>
                  <FileText size={15} /> Memorial (PDF)
                </Btn>
                <Btn tone="light" onClick={() => downloadMemo(buildMemo(), 'memorial_resultados_decisao.html')}>
                  <FileText size={15} /> Memorial (HTML)
                </Btn>
              </>
            )}
          </div>
        }
      >
        <p className="text-sm text-black/55">
          {CRITERIA.find((c) => c.id === criterion)?.help}
          {compare === 'config' && scenIdsRun.length > 1 && ' Cada configuração é avaliada em todos os cenários: precisa cumprir a meta no pior deles, e o custo é a média entre eles.'}
        </p>
        {busy && <div className="mt-3"><Progress value={busy.f} label={busy.stage ?? 'Simulando…'} /></div>}
        {!results && !busy && <p className="mt-3 text-sm text-black/50">Clique em “Simular todas as opções”: {model.configs.length} configurações × {model.scenarios.length} cenários × {plan.periods.length} períodos, com o desgaste da frota.</p>}
        {results && missing > 0 && <p className="mt-3 text-xs text-amber-800">Faltam {missing} combinações de configuração × cenário nesta rodada. Clique em “Simular de novo” para comparar todas.</p>}
      </Card>

      {best && (
        <>
          {/* --------------------------- melhor opção --------------------------- */}
          <section className="rounded-2xl border border-emerald-600/30 bg-emerald-50/50 p-5">
            <div className="flex items-start gap-3">
              <Award className="mt-0.5 shrink-0 text-emerald-700" size={22} />
              <div className="min-w-0">
                <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">Melhor opção pelo critério escolhido</p>
                <h3 className="mt-1 text-xl font-semibold">{optName(best)}</h3>
                <ul className="mt-3 space-y-1.5 text-sm text-black/75">
                  <li>
                    {best.allOk ? 'Cumpre a meta em todos os períodos' : 'Não cumpre a meta em algum período'} ({best.minMargin >= 1.02 ? `folga mínima de ${pct(best.minMargin - 1)} sobre a meta` : best.minMargin >= 0.995 ? 'no período mais apertado, a frota fica no limite da meta' : `pior período ${pct(1 - best.minMargin)} abaixo da meta`}), com pico de <b>{best.peakTrucks} caminhões</b> e {n1(best.people)} pessoas na operação.
                  </li>
                  <li>
                    Custo nivelado de <b>{brl2(best.costPerT)}/t</b> (VPL dos custos {mi(best.npvCost)} para {t0(best.tonnes / 1e3)} mil t).
                    {withRevenue && best.npv !== null && <> VPL do transporte: <b>{mi(best.npv)}</b>.</>}
                  </li>
                  <li>Investimento em equipamentos de {mi(best.capex)}, com {best.replacements} trocas por fim de vida útil no horizonte.</li>
                  {second && (
                    <li>
                      Frente à 2ª colocada ({optName(second)}):{' '}
                      {withRevenue && best.npv !== null && second.npv !== null
                        ? <>VPL {mi(best.npv - second.npv)} maior.</>
                        : <>{brl2(second.costPerT - best.costPerT)}/t mais barata ({mi(second.npvCost - best.npvCost)} a menos em valor presente)</>}
                      {second.peakTrucks !== best.peakTrucks && <> e {Math.abs(second.peakTrucks - best.peakTrucks)} caminhão(ões) {second.peakTrucks > best.peakTrucks ? 'a menos' : 'a mais'} no pico</>}.
                    </li>
                  )}
                  {sens.some((s) => s.winnerLow !== keyOf(best) || s.winnerHigh !== keyOf(best)) ? (
                    <li className="text-amber-900">
                      Atenção: a escolha muda se{' '}
                      {sens.filter((s) => s.winnerLow !== keyOf(best) || s.winnerHigh !== keyOf(best)).map((s) => s.label.toLowerCase()).join(', ')} variar ±20%. Veja a sensibilidade abaixo.
                    </li>
                  ) : (
                    sens.length > 0 && <li>A escolha se mantém com ±20% em diesel, salários, manutenção, preço dos equipamentos, produção e taxa de desconto.</li>
                  )}
                </ul>
              </div>
            </div>
          </section>

          {/* --------------------------- ranking --------------------------- */}
          <Card title="Comparação das opções" description="Clique em uma linha para ver o detalhe, os custos por período e a sensibilidade daquela opção.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-black/[0.06] text-left text-xs text-black/45">
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-2 font-medium">Opção</th>
                    <th className="py-2 pr-2 font-medium">Meta</th>
                    <th className="py-2 pr-2 text-right font-medium">Pico de caminhões</th>
                    <th className="py-2 pr-2 text-right font-medium">Pessoas</th>
                    <th className="py-2 pr-2 text-right font-medium">Investimento</th>
                    <th className="py-2 pr-2 text-right font-medium">VPL dos custos</th>
                    <th className="py-2 pr-2 text-right font-medium">R$/t</th>
                    {ranked.some((e) => 'range' in e) && <th className="py-2 pr-2 text-right font-medium">Faixa nos cenários</th>}
                    {withRevenue && <th className="py-2 pr-2 text-right font-medium">VPL</th>}
                    <th className="py-2 text-right font-medium">Trocas</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((e, i) => (
                    <tr
                      key={keyOf(e)}
                      onClick={() => setPick(keyOf(e))}
                      className={clsx('cursor-pointer border-b border-black/[0.04]', keyOf(e) === keyOf(chosen) ? 'bg-black/[0.04]' : 'hover:bg-black/[0.02]')}
                    >
                      <td className="py-2 pr-2 font-semibold">{i + 1}</td>
                      <td className="py-2 pr-2 font-medium">{optName(e)}</td>
                      <td className={clsx('py-2 pr-2 text-xs', e.allOk ? 'text-emerald-700' : 'text-red-700')}>{e.allOk ? 'atende' : 'não atende'}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{e.peakTrucks}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{n1(e.people)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{mi(e.capex)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{mi(e.npvCost)}</td>
                      <td className="py-2 pr-2 text-right font-semibold tabular-nums">{brl2(e.costPerT)}</td>
                      {'range' in e && (
                        <td className="py-2 pr-2 text-right text-xs tabular-nums text-black/55">
                          {brl2((e as { range: [number, number] }).range[0])} a {brl2((e as { range: [number, number] }).range[1])}
                        </td>
                      )}
                      {withRevenue && <td className="py-2 pr-2 text-right tabular-nums">{e.npv !== null ? mi(e.npv) : '—'}</td>}
                      <td className="py-2 text-right tabular-nums">{e.replacements}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CostBars evals={ranked} name={optName} />
          </Card>

          {/* --------------------------- detalhe por período --------------------------- */}

          <div className="grid gap-6 xl:grid-cols-2">
            <Card title={`Vida útil e custos por período · ${optName(chosen)}`} description="Frota em operação, compras, trocas por vida útil, idade média e custo de cada período.">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-black/45">
                      <th className="py-1 pr-2 font-medium">Período</th>
                      <th className="py-1 pr-2 text-right font-medium">Operando</th>
                      <th className="py-1 pr-2 text-right font-medium">Frota</th>
                      <th className="py-1 pr-2 text-right font-medium">Compras</th>
                      <th className="py-1 pr-2 text-right font-medium">Trocas</th>
                      <th className="py-1 pr-2 text-right font-medium">Idade média</th>
                      <th className="py-1 pr-2 text-right font-medium">Custo</th>
                      <th className="py-1 pr-2 text-right font-medium">R$/t</th>
                      <th className="py-1 font-medium">Troca</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.periods.map((p) => (
                      <tr key={p.period} className="border-t border-black/5">
                        <td className="py-1 pr-2">{p.label}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{p.trucks}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{p.fleetSize}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{p.bought || ''}</td>
                        <td className={clsx('py-1 pr-2 text-right tabular-nums', p.replaced > 0 && 'font-semibold text-amber-800')}>{p.replaced || ''}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{t0(p.avgAgeH)} h</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{mi(p.total)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{p.tonnes ? brl2(p.total / p.tonnes) : '—'}</td>
                        <td className="py-1 text-xs">{ecoAge && p.avgAgeH + p.truckHours / Math.max(1, p.trucks) > ecoAge ? <span className="font-semibold whitespace-nowrap text-amber-800" title={`Passa da idade ideal de troca ({t0(ecoAge)} h)`}>trocar ({t0(ecoAge)} h)</span> : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-black/45">Os picos de custo coincidem com compras e trocas; a idade média faz a manutenção subir e a disponibilidade cair ao longo dos anos. “Passa da idade ideal”: a frota chega, no fim do período, a uma idade em que manter custa mais que trocar — veja Financeiro → Trocar o equipamento.</p>
            </Card>
            <Card title={`Sensibilidade · ${optName(chosen)}`} description={`Cada parâmetro variado ±20%, um de cada vez. Barras: ${withRevenue ? 'VPL' : 'custo nivelado (R$/t)'} resultante.`}>
              <Tornado rows={sens} base={withRevenue && chosen.npv !== null ? chosen.npv : chosen.costPerT} money={withRevenue} chosenKey={keyOf(chosen)} name={(k) => {
                const [c, s] = k.split('|');
                return optName({ configId: c, scenarioId: s });
              }} />
            </Card>
          </div>

          {/* --------------------------- o que move o custo --------------------------- */}
          <Card title="O que move o custo de cada opção" description="Custo por tonelada separado por item (sem desconto e antes do crédito da frota que sobra no fim), e por que cada opção custa mais ou menos que a melhor.">
            <Drivers ranked={ranked} name={optName} />
          </Card>

          {/* --------------------------- fluxo de caixa --------------------------- */}
          <Card title={`Fluxo de caixa detalhado · ${optName(chosen)}`} description="Por período, em R$ sem inflação. Saídas negativas. Clique em outra opção na comparação para ver o fluxo dela.">
            <CashFlowTable e={chosen} withRevenue={withRevenue} />
          </Card>

          {/* --------------------------- como a simulação chegou aqui --------------------------- */}
          <Card title="Como a simulação chegou a este resultado" description="As etapas, com os números deste estudo.">
            <Steps model={model} plan={plan} generic={basisMode === 'circuito'} chosen={chosen} evals={evals} criterion={criterion} />
          </Card>
        </>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Composição do custo por opção (R$/t, barras empilhadas)                     */
/* -------------------------------------------------------------------------- */

const CostBars: React.FC<{ evals: Evaluation[]; name: (e: Evaluation) => string }> = ({ evals, name }) => {
  const [hover, setHover] = useState<string | null>(null);
  const rows = evals.map((e) => {
    const parts = COST_CATS.map((c) => ({ ...c, v: e.periods.reduce((a, p) => a + (p[c.key] as number), 0) / Math.max(1, e.tonnes) }));
    return { e, parts, total: parts.reduce((a, p) => a + Math.max(0, p.v), 0) };
  });
  const max = Math.max(1e-9, ...rows.map((r) => r.total));
  return (
    <div className="mt-6">
      <p className="mb-1 text-sm font-medium">De onde vem o custo (R$ por tonelada, sem desconto e antes do crédito da frota que sobra no fim)</p>
      <p className="mb-2 text-xs text-black/50">Por isso é maior que o custo nivelado da tabela acima, que traz tudo a valor presente e desconta o valor residual da frota no fim do horizonte. Em horizontes curtos (ex.: 1 mês), a compra dos caminhões pesa muito por tonelada.</p>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-black/60">
        {COST_CATS.map((c) => (
          <span key={c.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={`${r.e.configId}|${r.e.scenarioId}`}>
            <div className="mb-1 flex justify-between text-sm">
              <span>{name(r.e)}</span>
              <span className="tabular-nums text-black/60">{r.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/t</span>
            </div>
            <div className="flex h-4 gap-[2px]" style={{ width: `${(r.total / max) * 100}%` }}>
              {r.parts.map((p) => {
                if (p.v <= 0) return null;
                const id = `${r.e.configId}|${r.e.scenarioId}|${p.key}`;
                return (
                  <div
                    key={p.key}
                    className="h-full first:rounded-l last:rounded-r"
                    style={{ width: `${(p.v / r.total) * 100}%`, background: p.color, opacity: hover && hover !== id ? 0.55 : 1 }}
                    onMouseEnter={() => setHover(id)}
                    onMouseLeave={() => setHover(null)}
                    title={`${p.label}: ${p.v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}/t`}
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

/* -------------------------------------------------------------------------- */
/* O que move o custo                                                          */
/* -------------------------------------------------------------------------- */

const Drivers: React.FC<{ ranked: Evaluation[]; name: (e: Evaluation) => string }> = ({ ranked, name }) => {
  const rows = ranked.map((e) => ({ e, d: costDrivers(e) }));
  const ref = rows[0];
  if (!ref) return null;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/45">
              <th className="py-1.5 pr-2 font-medium">Opção</th>
              {DRIVER_CATS.map((c) => (
                <th key={c.key} className="py-1.5 pr-2 text-right font-medium" title={c.why}>{c.label} (R$/t)</th>
              ))}
              <th className="py-1.5 pr-2 text-right font-medium">Total (R$/t)</th>
              <th className="py-1.5 pr-2 text-right font-medium">h de caminhão por mil t</th>
              <th className="py-1.5 text-right font-medium">Caminhões (média / pico)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ e, d }, i) => (
              <tr key={`${e.configId}|${e.scenarioId}`} className="border-b border-black/5">
                <td className="py-1.5 pr-2 font-medium">{name(e)}</td>
                {DRIVER_CATS.map((c) => {
                  const diff = i > 0 ? d.perT[c.key] - ref.d.perT[c.key] : 0;
                  return (
                    <td key={c.key} className="py-1.5 pr-2 text-right tabular-nums">
                      {brl2(d.perT[c.key])}
                      {i > 0 && Math.abs(diff) >= 0.01 && <span className={clsx('block text-[11px]', diff > 0 ? 'text-red-700' : 'text-emerald-700')}>{diff > 0 ? '+' : '−'}{brl2(Math.abs(diff))}</span>}
                    </td>
                  );
                })}
                <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{brl2(d.totalPerT)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{n1(d.truckHoursPerKt)}</td>
                <td className="py-1.5 text-right tabular-nums">{n1(d.avgTrucks)} / {d.peakTrucks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 1 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.slice(1, 5).map(({ e, d }) => (
            <div key={`${e.configId}|${e.scenarioId}`} className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm text-black/70">
              {explainDifference(d, ref.d, name(e), name(ref.e)).map((line, i) => (
                <p key={i} className={i === 0 ? 'font-medium text-black/85' : 'mt-0.5'}>{i > 0 && '• '}{line}</p>
              ))}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-black/45">
        Mais caminhões elevam compra e mão de obra; mais horas de caminhão por tonelada (ciclo longo, filas, caçamba menor) elevam diesel, manutenção e pneus; a vida útil define quantas trocas cabem no horizonte. Custos fixos são iguais para todas as opções.
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Fluxo de caixa                                                              */
/* -------------------------------------------------------------------------- */

const CashFlowTable: React.FC<{ e: Evaluation; withRevenue: boolean }> = ({ e, withRevenue }) => {
  const cf = cashFlow(e);
  const money = (v: number) => {
    const k = Math.round(v / 1e3);
    return <span className={clsx(k < 0 && 'text-red-700')}>{(k === 0 ? 0 : k).toLocaleString('pt-BR')}</span>;
  };
  const items = CASH_ITEMS.filter((c) => withRevenue || c.key !== 'revenue');
  const cell = 'py-1 pr-2 text-right tabular-nums whitespace-nowrap';
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 260 + (cf.rows.length + 2) * 90 }}>
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/45">
              <th className="sticky left-0 bg-white py-1.5 pr-2 font-medium">R$ mil</th>
              {cf.rows.map((r) => (
                <th key={r.label} className="py-1.5 pr-2 text-right font-medium">{r.label}</th>
              ))}
              <th className="py-1.5 pr-2 text-right font-medium">Residual final</th>
              <th className="py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.key} className="border-b border-black/5">
                <td className="sticky left-0 bg-white py-1 pr-2">{c.label}</td>
                {cf.rows.map((r) => (
                  <td key={r.label} className={cell}>{money(c.sign * r.values[c.key])}</td>
                ))}
                <td className={cell} />
                <td className={cell}>{money(c.sign * cf.totals[c.key])}</td>
              </tr>
            ))}
            <tr className="border-b border-black/5">
              <td className="sticky left-0 bg-white py-1 pr-2">Valor residual da frota restante</td>
              {cf.rows.map((r) => (
                <td key={r.label} className={cell} />
              ))}
              <td className={cell}>{money(cf.salvage.value)}</td>
              <td className={cell}>{money(cf.salvage.value)}</td>
            </tr>
            <tr className="border-t-2 border-black/30 font-semibold">
              <td className="sticky left-0 bg-white py-1 pr-2">Fluxo líquido</td>
              {cf.rows.map((r) => (
                <td key={r.label} className={cell}>{money(r.net)}</td>
              ))}
              <td className={cell}>{money(cf.salvage.value)}</td>
              <td className={cell}>{money(cf.totals.net)}</td>
            </tr>
            <tr className="text-black/55">
              <td className="sticky left-0 bg-white py-1 pr-2">Fator de desconto</td>
              {cf.rows.map((r) => (
                <td key={r.label} className={cell}>{r.pvFactor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
              ))}
              <td className={cell}>{e.endPvFactor.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
              <td className={cell} />
            </tr>
            <tr>
              <td className="sticky left-0 bg-white py-1 pr-2">Fluxo em valor presente</td>
              {cf.rows.map((r) => (
                <td key={r.label} className={cell}>{money(r.pvNet)}</td>
              ))}
              <td className={cell}>{money(cf.salvage.pv)}</td>
              <td className={clsx(cell, 'font-semibold')}>{money(cf.totals.pvNet)}</td>
            </tr>
            <tr>
              <td className="sticky left-0 bg-white py-1 pr-2">VP acumulado</td>
              {cf.rows.map((r) => (
                <td key={r.label} className={cell}>{money(r.cumPvNet)}</td>
              ))}
              <td className={cell}>{money(cf.totals.pvNet)}</td>
              <td className={cell} />
            </tr>
            <tr className="text-black/55">
              <td className="sticky left-0 bg-white py-1 pr-2">Custo por tonelada (R$/t, sem desconto; total já com o residual)</td>
              {cf.rows.map((r, i) => (
                <td key={r.label} className={cell}>{e.periods[i].tonnes ? brl2(r.cost / e.periods[i].tonnes) : '—'}</td>
              ))}
              <td className={cell} />
              <td className={cell}>{e.tonnes ? brl2(cf.totals.cost / e.tonnes) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-black/45">
        Fluxo em valor presente = fluxo ÷ (1 + taxa)^(anos até o meio do período). {withRevenue ? 'A soma é o VPL do transporte.' : 'Sem receita: a soma é o VPL dos custos (negativo).'} A frota que sobra no fim é creditada pelo valor depreciado.
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Tornado                                                                     */
/* -------------------------------------------------------------------------- */

const Tornado: React.FC<{ rows: ReturnType<typeof sensitivity>; base: number; money: boolean; chosenKey: string; name: (k: string) => string }> = ({ rows, base, money, chosenKey, name }) => {
  if (!rows.length) return null;
  const span = Math.max(1e-9, ...rows.map((r) => Math.max(Math.abs(r.low - base), Math.abs(r.high - base))));
  const fmt = (v: number) => (money ? mi(v) : brl2(v));
  const W = 100;
  const x = (v: number) => 50 + ((v - base) / span) * 45;
  return (
    <div>
      <div className="space-y-2">
        {rows.map((r) => {
          const a = x(Math.min(r.low, r.high));
          const b = x(Math.max(r.low, r.high));
          const flips = r.winnerLow !== chosenKey || r.winnerHigh !== chosenKey;
          return (
            <div key={r.key}>
              <div className="flex justify-between text-xs">
                <span className={clsx('font-medium', flips && 'text-amber-800')}>{r.label}{flips && ' · muda a escolha'}</span>
                <span className="tabular-nums text-black/55">−20%: {fmt(r.low)} · +20%: {fmt(r.high)}</span>
              </div>
              <div className="relative mt-1 h-4 rounded bg-black/[0.04]">
                <div className="absolute top-0 bottom-0 w-px bg-black/40" style={{ left: `${W / 2}%` }} />
                <div className="absolute top-0.5 bottom-0.5 rounded-sm" style={{ left: `${a}%`, width: `${Math.max(0.5, b - a)}%`, background: flips ? '#eb6834' : '#2a78d6' }} />
              </div>
              {flips && (
                <p className="mt-0.5 text-[11px] text-amber-900">
                  {r.winnerLow !== chosenKey && <>Com −20%, a melhor passa a ser {name(r.winnerLow)}. </>}
                  {r.winnerHigh !== chosenKey && <>Com +20%, a melhor passa a ser {name(r.winnerHigh)}.</>}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-black/45">
        Linha central = valor da opção ({fmt(base)}). Os parâmetros mais acima são os que mais pesam no resultado: vale a pena refinar esses números primeiro.
        A variação de produção é aproximada (horas e toneladas proporcionais, sem re-simular as filas).
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Etapas explicadas                                                           */
/* -------------------------------------------------------------------------- */

const Steps: React.FC<{ model: SimModel; plan: ReturnType<typeof emptyPlan>; generic: boolean; chosen: Evaluation; evals: Evaluation[]; criterion: Criterion }> = ({ model, plan, generic, chosen, evals, criterion }) => {
  const fin = model.finance ?? defaultFinance(model.configs);
  const sc = model.scenarios.find((s) => s.id === chosen.scenarioId);
  const cfg = model.configs.find((c) => c.id === chosen.configId);
  const tonnes = plan.movements.reduce((a, m) => a + m.tonnes.reduce((x, y) => x + y, 0), 0);
  const tf = fin.trucks[chosen.configId];
  const steps: { title: string; text: React.ReactNode }[] = [
    {
      title: 'Dados de entrada',
      text: (
        <>
          {generic
            ? <>Modo simples: {model.circuits.length} circuitos da aba Circuito (rota, carga e basculamento fixos) em {chosen.periods.length} período(s) ({chosen.periods[0]?.label}{chosen.periods.length > 1 ? ` a ${chosen.periods[chosen.periods.length - 1].label}` : ''}); a massa de cada período = ROM do período × participação de cada circuito, somando {t0(chosen.tonnes / 1e3)} mil t transportadas. Operação de {model.scenarios[0]?.hoursPerDay ?? 24} h por dia (premissas).</>
            : <>{model.routes.length} rotas formam a malha de vias; {plan.places.length} lugares de carga e descarga; {plan.movements.length} movimentações em {plan.periods.length} períodos, somando {t0(tonnes / 1e3)} mil t.</>}
          {!generic && <>Calendário de {calendarWorkDays(plan.calendar)} dias trabalháveis por ano e {plan.hoursPerDay} h de operação por dia.</>}
        </>
      ),
    },
    {
      title: 'Trajetos de cada período',
      text: generic ? <>No modo simples cada circuito usa a própria rota importada na aba Circuito, igual em todos os períodos. Distância, subidas e descidas viram tempo de viagem pela tabela de velocidade × rampa de cada caminhão. Para frentes e rotas que mudam por período, use o modo detalhado.</> : <>Para cada movimentação, o ponto de carga fica dentro da área da frente daquele período (ou no ponto fixo). O trajeto = acesso interno com rampa até {plan.rampMaxGrade}% + caminho mais curto pela malha + acesso no destino. Distância, subidas e descidas viram tempo de viagem pela tabela de velocidade × rampa de cada caminhão.</>,
    },
    {
      title: 'Ciclo, filas e quebras (simulação de eventos discretos)',
      text: (
        <>
          Cada caminhão é simulado viagem a viagem: fila e carga ({cfg ? `${cfg.payloadT} t` : ''}, por passes da caçamba), ida carregado, balança, fila e descarga, volta vazio. Quebras de caminhões e do equipamento de carga ocorrem ao acaso pela disponibilidade
          {sc ? ` (cenário “${sc.name}”: DF ${sc.truckDf}%, eficiência ${sc.efficiency}%, variabilidade ±${Math.round(sc.cv * 100)}%)` : ''}. Cada cálculo é repetido {Math.min(model.replications, 4)} vezes com sorteios diferentes.
        </>
      ),
    },
    {
      title: 'Frota de cada período',
      text: <>Em cada período, parte-se de uma estimativa e somam-se caminhões até cada movimentação cumprir a meta diária (toneladas ÷ dias trabalháveis). Se um caminhão a mais rende menos de 1,5%, o gargalo é a carga ou a descarga, e a movimentação é marcada. Depois, retira-se o que sobrou.</>,
    },
    {
      title: 'Vida útil e desgaste',
      text: (
        <>
          Cada caminhão acumula as horas trabalhadas. A disponibilidade cai {tf ? n1(tf.dfLossPer10kH) : '—'} p.p. a cada 10 mil h e a manutenção sobe {tf ? t0(tf.maintEscPct) : '—'}% a cada 10 mil h. Ao atingir a vida útil ({tf ? t0(tf.lifeH) : '—'} h), o caminhão é trocado por um novo, com crédito do valor residual. Nesta opção: {chosen.replacements} trocas.
        </>
      ),
    },
    {
      title: 'Custos e valor presente',
      text: (
        <>
          Custo de cada período = compras − valor residual + diesel ({brl2(fin.dieselPrice)}/L) + manutenção + pneus + mão de obra ({fin.shifts} turnos, fator de folguistas {n1(fin.reliefFactor)}) + equipamento de carga + custos fixos. Tudo trazido a valor presente a {n1(fin.discountRate)}% a.a.; a frota restante é creditada no fim.
          Custo nivelado = VPL dos custos ÷ VPL das toneladas.
        </>
      ),
    },
    {
      title: 'Escolha',
      text: <>{CRITERIA.find((c) => c.id === criterion)?.help} Foram comparadas {evals.length} opções (configurações × cenários).</>,
    },
    {
      title: 'Sensibilidade',
      text: <>Cada parâmetro econômico é variado ±20%, um de cada vez, para ver quanto o resultado muda e se a opção vencedora troca.</>,
    },
  ];
  return (
    <ol className="space-y-4">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#151619] text-xs font-semibold text-white">{i + 1}</span>
          <div>
            <p className="font-medium">{s.title}</p>
            <p className="mt-0.5 text-sm text-black/65">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
};

export default DecisionView;
