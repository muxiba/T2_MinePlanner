/**
 * Conteúdo do relatório em blocos (independente do formato): títulos, parágrafos, tabelas,
 * caixas de memória de cálculo / dado do software / como ler, figuras e fórmulas.
 * O Word desenha estes blocos; a apresentação e o Excel usam os mesmos dados com layout próprio.
 */
import type { ReportConfig, ReportData } from './data';
import { INK, REC_FILL, brl, dateBR, fmt, lighten, mi, minutes, pct } from './theme';
import type { TruckState } from '@/sim/types';

export type FigureKey = 'cycleStatic' | 'cycleRoutes' | 'simTpd' | 'cycleSim' | 'fleets' | 'sweep' | 'cost' | 'decisionPeriods';
export type EqKey = 'eq_meta' | 'eq_hours' | 'eq_cycle' | 'eq_prod' | 'eq_frota' | 'eq_pmeta' | 'eq_custo' | 'eq_rpt' | 'eq_nivel' | 'eq_vpl' | 'eq_cap' | 'eq_ocup';

export interface TableBlock {
  t: 'table';
  head: string[];
  rows: string[][];
  widths?: number[];
  /** cor de fundo do cabeçalho por coluna */
  headColors?: (string | undefined)[];
  /** fundo por coluna (ex.: coluna da recomendada) */
  colFill?: Record<number, string>;
  /** fundo por linha */
  rowFill?: Record<number, string>;
  /** última linha em destaque (total) */
  total?: boolean;
  /** colunas alinhadas à esquerda (padrão: só a primeira) */
  leftCols?: number[];
  small?: boolean;
}

export type Block =
  | { t: 'h1'; text: string; eyebrow?: string }
  | { t: 'h2'; text: string }
  | { t: 'p'; text: string }
  | { t: 'small'; text: string }
  | { t: 'bullets'; items: string[]; numbered?: boolean }
  | TableBlock
  | { t: 'box'; kind: 'memo' | 'sw' | 'read' | 'note'; title?: string; lines: string[] }
  | { t: 'fig'; key: FigureKey; caption: string }
  | { t: 'eq'; key: EqKey }
  | { t: 'kpis'; items: { v: string; l: string }[] };

export interface ReportDoc {
  sections: Block[][];
  figures: FigureKey[];
  equations: EqKey[];
}

export const STATE_ORDER: TruckState[] = ['fila_carga', 'carregando', 'carregado', 'fila_balanca', 'pesando', 'fila_descarga', 'descarregando', 'vazio', 'interferencia', 'perdas', 'troca_turno', 'refeicao', 'abastecimento'];

export const cfgHeads = (cs: ReportConfig[]) => cs.map((c) => `${c.tag} · ${short(c.name)}`);
export const short = (s: string, n = 28) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const recCol = (d: ReportData, offset = 1) => {
  const i = d.configs.findIndex((c) => c === d.recommended);
  return i >= 0 ? { [i + offset]: REC_FILL } : {};
};
const headColors = (d: ReportData, before = 1, after = 0) => [...Array(before).fill(undefined), ...d.configs.map((c) => c.color), ...Array(after).fill(undefined)];

export function buildContent(d: ReportData): ReportDoc {
  const S: Block[][] = [];
  const figures = new Set<FigureKey>();
  const equations = new Set<EqKey>();
  const fig = (key: FigureKey, caption: string): Block => (figures.add(key), { t: 'fig', key, caption });
  const eq = (key: EqKey): Block => (equations.add(key), { t: 'eq', key });
  const cs = d.configs;
  const rec = d.recommended;
  const hasRun = cs.some((c) => c.base);
  const hasMin = cs.some((c) => c.minFleet);
  const h = d.hours;

  /* ------------------------------- resumo ------------------------------- */
  const resumo: Block[] = [{ t: 'h1', text: 'A resposta em uma página', eyebrow: 'Resumo executivo' }];
  if (rec) {
    resumo.push({ t: 'p', text: `**Recomendação: ${rec.tag} – ${rec.name}.** ${d.recommendedWhy.length ? `Motivos: ${d.recommendedWhy.join('; ')}.` : ''}` });
    resumo.push({
      t: 'table',
      head: ['Indicador', ...cfgHeads(cs)],
      headColors: headColors(d),
      colFill: recCol(d),
      rows: [
        ['Carga útil', ...cs.map((c) => `${fmt(c.payloadT, 1)} t`)],
        ['Ciclo pela conta estática', ...cs.map((c) => minutes(c.cycle.cycleMin))],
        ['Produção de 1 caminhão', ...cs.map((c) => `${fmt(c.tph, 1)} t/h`)],
        ['Frota pela conta estática', ...cs.map((c) => fmt(c.staticTrucks))],
        ...(hasMin ? [['Frota mínima simulada', ...cs.map((c) => (c.minFleet ? fmt(c.minFleet.total) : '—'))]] : []),
        ...(hasRun ? [['Produção simulada (cenário base)', ...cs.map((c) => (c.base ? `${fmt(c.base.tpd)} t/dia (${pct(c.base.tpd / d.sim.targetTpd)})` : '—'))]] : []),
        ...(hasRun ? [['Fila na descarga (simulação)', ...cs.map((c) => (c.base ? minutes(c.base.queueDumpMin) : '—'))]] : []),
        ['Ocupação da descarga na meta', ...cs.map((c) => (c.dump ? pct(c.dump.occupancy) : '—'))],
        ['Custo por tonelada', ...cs.map((c) => brl(c.cost.perT))],
        ...(cs.some((c) => c.price > 0) ? [['Investimento na frota', ...cs.map((c) => mi(c.cost.invest))]] : []),
        ...(d.decision ? [['Custo nivelado no horizonte (decisão)', ...cs.map((c) => (c.decision ? brl(c.decision.costPerT) : '—'))]] : []),
      ],
    });
    resumo.push({ t: 'box', kind: 'read', lines: [d.conclusion] });
  } else {
    resumo.push({ t: 'p', text: d.conclusion });
  }
  resumo.push({
    t: 'table',
    head: ['Dimensionamento (2. Dimensionamento)', 'Valor'],
    rows: [
      [d.labels.target, `${fmt(d.target.monthT)} t/mês`],
      ['Meta por dia de operação', `${fmt(d.target.dayT)} t/dia`],
      ['Caminhões necessários (conta estática)', fmt(d.statik.needed)],
      ['Caminhões nas premissas', fmt(d.statik.premiseFleet)],
      ['Atendimento do sistema', `${pct(d.statik.ratio, 1)}${d.statik.bottleneck ? ` · gargalo: ${d.statik.bottleneck}` : ''}`],
    ],
    widths: [0.6, 0.4],
  });
  S.push(resumo);

  /* ------------------------------- premissas ------------------------------- */
  const pr: Block[] = [{ t: 'h1', text: 'Premissas e meta', eyebrow: 'Passo 1' }];
  pr.push({ t: 'p', text: `A meta do mês é **${fmt(d.target.monthT)} t** (${d.labels.target.toLowerCase()}), em **${fmt(h.workDays, 1)} dias** de operação de **${fmt(h.hoursPerDay, 1)} h**. Mês de referência: ${d.periodLabel}.` });
  pr.push(eq('eq_meta'));
  pr.push({
    t: 'box',
    kind: 'memo',
    lines: [
      `Meta por dia = ${fmt(d.target.monthT)} t ÷ ${fmt(h.workDays, 1)} dias = **${fmt(d.target.dayT, 1)} t/dia**`,
      `Meta por hora de operação = ${fmt(d.target.dayT, 1)} ÷ ${fmt(h.hoursPerDay, 1)} h = **${fmt(d.target.dayT / Math.max(1, h.hoursPerDay), 1)} t/h**`,
      ...d.target.flows.map((f) => `${f.name}: ${fmt(f.t)} t ÷ ${fmt(h.workDays, 1)} = **${fmt(f.tpd, 1)} t/dia**`),
    ],
  });
  pr.push({ t: 'box', kind: 'sw', title: 'Premissas Fundamentais', lines: d.premises.map((p) => `${p.label}: **${p.raw !== undefined ? fmt(p.raw, Number.isInteger(p.raw) ? 0 : 1) : p.value}${p.unit ? ` ${p.unit}` : ''}**`) });
  pr.push({ t: 'h2', text: 'Horas efetivas de cada caminhão' });
  pr.push({ t: 'p', text: 'O caminhão roda nas horas de operação, menos o tempo em manutenção (DF, disponibilidade física) e as paradas da operação (UF, utilização): troca de turno, refeição, abastecimento.' });
  pr.push(eq('eq_hours'));
  pr.push({ t: 'box', kind: 'memo', lines: [`Horas efetivas = ${fmt(h.workDays, 1)} dias × ${fmt(h.hoursPerDay, 1)} h × ${pct(h.df)} × ${pct(h.uf)}${h.eo < 0.999 ? ` × ${pct(h.eo)} (EO)` : ''} = **${fmt(h.effectiveH, 1)} h** por caminhão no mês`] });
  S.push(pr);

  /* ------------------------- dimensionamento estático ------------------------ */
  const st: Block[] = [{ t: 'h1', text: 'Frota pela conta estática', eyebrow: 'Passo 2' }];
  st.push({ t: 'p', text: 'A conta estática (módulo 2. Dimensionamento) usa o ciclo médio de cada movimentação, com uma fila fixa. A frota de cada movimentação é a massa do mês dividida pelo que um caminhão transporta no mês, arredondada para cima.' });
  st.push(eq('eq_cycle'));
  st.push(eq('eq_prod'));
  st.push(eq('eq_frota'));
  const mv = d.statik.movements;
  st.push({
    t: 'table',
    head: ['Movimentação', 'Massa (t)', 'Carga (t)', 'Ciclo (min)', 't/h cam.', 't/mês cam.', 'Exato', 'Frota', 'Atende'],
    rows: [
      ...mv.map((m) => [m.name, fmt(m.massT), fmt(m.payloadT, 1), fmt(m.cycle.cycleMin, 1), fmt(m.tph, 2), fmt(m.truckMonthT), fmt(m.exact, 2), fmt(m.needed), pct(m.ratio, 1)]),
      ['Total', fmt(mv.reduce((a, m) => a + m.massT, 0)), '', '', '', '', fmt(mv.reduce((a, m) => a + m.exact, 0), 2), fmt(d.statik.needed), pct(d.statik.ratio, 1)],
    ],
    widths: [0.26, 0.1, 0.07, 0.08, 0.08, 0.1, 0.08, 0.08, 0.09],
    total: true,
    small: true,
  });
  st.push({
    t: 'box',
    kind: 'memo',
    lines: mv.flatMap((m) => [
      `**${m.name}** · ciclo = ${fmt(m.cycle.loadMin, 1)} + ${fmt(m.cycle.loadedMin, 1)} + ${fmt(m.cycle.weighMin, 1)} + ${fmt(m.cycle.dumpMin, 1)} + ${fmt(m.cycle.emptyMin, 1)} + ${fmt(m.cycle.queueMin, 1)}${m.cycle.otherMin > 0.05 ? ` + ${fmt(m.cycle.otherMin, 1)}` : ''} = **${fmt(m.cycle.cycleMin, 2)} min**`,
      `   produção = ${fmt(m.payloadT, 1)} × 60 ÷ ${fmt(m.cycle.cycleMin, 2)} = **${fmt(m.tph, 2)} t/h** · no mês = ${fmt(m.tph, 2)} × ${fmt(m.effectiveH, 1)} h = **${fmt(m.truckMonthT)} t** · frota = ${fmt(m.massT)} ÷ ${fmt(m.truckMonthT)} = ${fmt(m.exact, 2)} → **${fmt(m.needed)}**`,
    ]),
  });
  if (!cs.length && mv.length) st.push(fig('cycleRoutes', 'Composição do ciclo de cada movimentação (minutos), pela conta estática.'));
  st.push({ t: 'box', kind: 'read', lines: [`A conta estática pede **${fmt(d.statik.needed)} caminhões** (premissas: ${fmt(d.statik.premiseFleet)}). Ela trata a fila como um valor fixo; a simulação, nos passos seguintes, calcula a fila real quando vários caminhões chegam juntos.`] });
  S.push(st);

  if (cs.length) {
    /* --------------------------- configurações --------------------------- */
    const cf: Block[] = [{ t: 'h1', text: 'Configurações de caminhão comparadas', eyebrow: 'Passo 3' }];
    cf.push({ t: 'p', text: `Foram comparadas **${cs.length} configurações** no mesmo modelo de simulação (mesmo trajeto, pontos de carga e de descarga). Os tempos de viagem saem do perfil da via e da tabela de velocidade de cada caminhão.` });
    cf.push({
      t: 'table',
      head: ['Item', ...cfgHeads(cs)],
      headColors: headColors(d),
      colFill: recCol(d),
      rows: [
        ['Carga útil (t)', ...cs.map((c) => fmt(c.payloadT, 1))],
        ['Carga no ponto de carga (min)', ...cs.map((c) => fmt(c.cycle.loadMin, 2))],
        ['Viagem carregado (min)', ...cs.map((c) => fmt(c.cycle.loadedMin, 2))],
        ['Pesagem (min)', ...cs.map((c) => fmt(c.cycle.weighMin, 2))],
        ['Basculamento + manobra (min)', ...cs.map((c) => fmt(c.cycle.dumpMin, 2))],
        ['Viagem vazio (min)', ...cs.map((c) => fmt(c.cycle.emptyMin, 2))],
        ['Fila fixa e outras paradas (min)', ...cs.map((c) => fmt(c.cycle.queueMin + c.cycle.otherMin, 2))],
        ['Ciclo total (min)', ...cs.map((c) => fmt(c.cycle.cycleMin, 2))],
        ['Produção de 1 caminhão (t/h)', ...cs.map((c) => fmt(c.tph, 2))],
        ['Custo fixo (R$/h calendário)', ...cs.map((c) => fmt(c.costFixedPerH, 2))],
        ['Custo operacional (R$/h trabalhada)', ...cs.map((c) => fmt(c.costVarPerH, 2))],
        ...(cs.some((c) => c.price > 0) ? [['Preço de compra', ...cs.map((c) => mi(c.price, 2))]] : []),
      ],
    });
    cf.push(fig('cycleStatic', 'Composição do ciclo de cada configuração (minutos), pela conta estática.'));
    cf.push({ t: 'box', kind: 'memo', lines: cs.map((c) => `${c.tag}: ${fmt(c.payloadT, 1)} t × 60 ÷ ${fmt(c.cycle.cycleMin, 2)} min = **${fmt(c.tph, 2)} t/h**`) });
    cf.push({ t: 'h2', text: 'Frota estática de cada configuração' });
    cf.push({
      t: 'table',
      head: ['Circuito', ...cfgHeads(cs)],
      headColors: headColors(d),
      colFill: recCol(d),
      rows: [
        ...cs[0].circuits.map((cc, k) => [cc.name, ...cs.map((c) => `${fmt(c.circuits[k]?.exact, 2)} → ${fmt(c.circuits[k]?.trucks)}`)]),
        ['Total', ...cs.map((c) => fmt(c.staticTrucks))],
      ],
      total: true,
    });
    cf.push({
      t: 'box',
      kind: 'memo',
      lines: cs.flatMap((c) =>
        c.circuits.map((cc) => `${c.tag} · ${cc.name}: ${fmt(cc.needTph, 1)} t/h necessárias ÷ ${fmt(cc.tph, 2)} t/h por caminhão = ${fmt(cc.exact, 2)} → **${fmt(cc.trucks)}**`),
      ),
    });
    S.push(cf);

    /* ---------------------------- simulação ---------------------------- */
    const si: Block[] = [{ t: 'h1', text: 'Simulação de eventos discretos', eyebrow: 'Passo 4' }];
    si.push({
      t: 'p',
      text: `A simulação acompanha cada caminhão viagem a viagem: filas na carga, na pesagem e na descarga, quebras (DF) e paradas operacionais. Cada cenário roda ${fmt(d.sim.days)} dias, ${fmt(d.sim.replications)} vezes com sorteios diferentes, descartando as primeiras ${fmt(d.sim.warmupH)} h. O resultado vem com intervalo de confiança de 95%.`,
    });
    si.push({ t: 'table', head: ['Cenário', 'Condição'], rows: d.sim.scenarios.map((s) => [s.name, s.text]), widths: [0.35, 0.65], leftCols: [0, 1] });
    if (hasRun) {
      const scen = d.sim.scenarios.filter((s) => cs.some((c) => c.matrix.some((r) => r.scenarioId === s.id)));
      si.push({ t: 'p', text: `Meta do sistema: **${fmt(d.sim.targetTpd)} t/dia**. Frota simulada: a de cada circuito no modelo (${cs.map((c) => `${c.tag} ${fmt(c.base?.trucks)}`).join(', ')} caminhões).` });
      si.push(fig('simTpd', 'Produção média por dia em cada cenário, contra a meta. Fonte: rodada da aba Relatórios do T2 MinePlanner.'));
      si.push(eq('eq_pmeta'));
      si.push({ t: 'box', kind: 'memo', lines: cs.filter((c) => c.base).map((c) => `${c.tag}: ${fmt(c.base!.tpd)} ÷ ${fmt(d.sim.targetTpd)} = **${pct(c.base!.tpd / d.sim.targetTpd)}** da meta · ciclo simulado ${fmt(c.base!.cycleMin, 1)} min (estático ${fmt(c.cycle.cycleMin, 1)})`) });
      si.push({
        t: 'box',
        kind: 'sw',
        title: `matriz configuração × cenário${d.sim.runAt ? ` (${dateBR(d.sim.runAt)})` : ''}`,
        lines: [],
      });
      const rows: string[][] = [];
      const rowFill: Record<number, string> = {};
      for (const c of cs)
        for (const s of scen) {
          const r = c.matrix.find((x) => x.scenarioId === s.id);
          if (!r) continue;
          rowFill[rows.length] = lighten(c.color, 0.86);
          rows.push([`${c.tag}`, short(s.name, 24), fmt(r.tpd), `${fmt(r.lo)}–${fmt(r.hi)}`, pct(r.tpd / d.sim.targetTpd), fmt(r.cycleMin, 1), fmt(r.queueLoadMin, 1), fmt(r.queueDumpMin, 1), pct(r.dumpUtil), brl(r.costPerT)]);
        }
      si.push({ t: 'table', head: ['Conf.', 'Cenário', 't/dia', 'IC 95%', '% meta', 'Ciclo', 'Fila carga', 'Fila desc.', 'Ocup. desc.', 'R$/t'], rows, rowFill, small: true, widths: [0.07, 0.2, 0.09, 0.13, 0.08, 0.08, 0.08, 0.08, 0.09, 0.1] });
      si.push(fig('cycleSim', 'Onde o tempo do ciclo vai na simulação (cenário base, minutos por ciclo).'));
      const worst = cs.filter((c) => c.base).sort((a, b) => b.base!.queueDumpMin - a.base!.queueDumpMin)[0];
      const best = cs.filter((c) => c.base).sort((a, b) => b.base!.tpd - a.base!.tpd)[0];
      si.push({
        t: 'box',
        kind: 'read',
        lines: [
          best ? `Com a frota do modelo, **${best.tag}** é a que mais produz: ${fmt(best.base!.tpd)} t/dia (${pct(best.base!.tpd / d.sim.targetTpd)} da meta).` : '',
          worst && worst.base!.queueDumpMin > 3 ? `A maior fila na descarga é a de **${worst.tag}**: ${fmt(worst.base!.queueDumpMin, 1)} min por ciclo. Ocupação da descarga acima de 80–85% faz a fila crescer rápido.` : 'As filas na descarga ficam baixas em todas as configurações.',
        ].filter(Boolean),
      });
    } else {
      si.push({ t: 'box', kind: 'note', lines: ['A matriz de cenários ainda não foi rodada. Na aba Relatórios, use “Rodar simulações do relatório” para incluir produção simulada, filas e frota mínima.'] });
    }
    S.push(si);

    /* ---------------------------- frota mínima ---------------------------- */
    if (hasMin || d.sweep) {
      const fm: Block[] = [{ t: 'h1', text: 'Frota mínima simulada', eyebrow: 'Passo 5' }];
      fm.push({ t: 'p', text: 'A busca soma e retira caminhões em cada circuito até a produção simulada alcançar a meta do circuito com a menor frota. Quando a frota satura (cada caminhão a mais rende menos de 1,5%), a meta não fecha com aquela configuração.' });
      if (hasMin) {
        fm.push(fig('fleets', 'Frota necessária: conta estática contra a frota mínima simulada.'));
        fm.push({
          t: 'table',
          head: ['Circuito', ...cfgHeads(cs)],
          headColors: headColors(d),
          colFill: recCol(d),
          rows: [
            ...(cs.find((c) => c.minFleet)?.minFleet?.circuits ?? []).map((cc, k) => [cc.name, ...cs.map((c) => (c.minFleet?.circuits[k] ? `${fmt(c.minFleet.circuits[k].trucks)}${c.minFleet.circuits[k].saturated ? ' (satura)' : ''}` : '—'))]),
            ['Conta estática', ...cs.map((c) => fmt(c.staticTrucks))],
            ['Frota mínima simulada', ...cs.map((c) => (c.minFleet ? fmt(c.minFleet.total) : '—'))],
          ],
          total: true,
        });
        const ref = cs[0];
        fm.push({
          t: 'box',
          kind: 'memo',
          lines: cs
            .filter((c) => c.minFleet)
            .map((c) => `${c.tag}: ${fmt(c.minFleet!.total)} caminhões (estático ${fmt(c.staticTrucks)}, diferença ${fmt(c.minFleet!.total - c.staticTrucks)})${c !== ref && ref.minFleet ? ` · contra ${ref.tag}: ${fmt(c.minFleet!.total)} ÷ ${fmt(ref.minFleet.total)} − 1 = **${pct(c.minFleet!.total / ref.minFleet.total - 1)}**` : ''}`),
        });
      }
      if (d.sweep) {
        const sw = d.sweep;
        fm.push({ t: 'h2', text: `Curva da frota mínima – ${sw.config}${sw.circuit ? ` · ${sw.circuit}` : ''}` });
        fm.push(fig('sweep', `Produção × número de caminhões (${sw.scenario}). Fonte: busca da frota mínima do T2 MinePlanner.`));
        const last = sw.points[sw.points.length - 1];
        const k = sw.points.length;
        const gain = k >= 5 ? (sw.points[k - 1].tpd - sw.points[k - 5].tpd) / 4 : 0;
        fm.push({
          t: 'box',
          kind: 'memo',
          lines: [
            `Saturação em **${fmt(sw.saturation)} caminhões** (depois dela cada caminhão rende menos de 3% a mais).`,
            last ? `Com ${fmt(last.trucks)} caminhões: ${fmt(last.tpd)} t/dia = ${pct(sw.target > 0 ? last.tpd / sw.target : 0, 1)} da meta de ${fmt(sw.target)} t/dia.` : '',
            sw.minFleet ? `Frota mínima da busca: **${fmt(sw.minFleet)} caminhões**.` : gain > 0 && last && sw.target > last.tpd ? `Ganho médio dos últimos caminhões = ${fmt(gain)} t/dia; faltam ${fmt(sw.target - last.tpd)} t/dia ÷ ${fmt(gain)} = ${fmt((sw.target - last.tpd) / gain, 2)} caminhão → **${fmt(last.trucks + Math.ceil((sw.target - last.tpd) / gain))}**.` : '',
          ].filter(Boolean),
        });
      }
      S.push(fm);
    }

    /* ------------------------------- custos ------------------------------- */
    const co: Block[] = [{ t: 'h1', text: 'Custo por tonelada e investimento', eyebrow: hasMin || d.sweep ? 'Passo 6' : 'Passo 5' }];
    co.push({ t: 'p', text: `O custo usa a frota ${hasMin ? 'mínima simulada' : 'da conta estática'} de cada opção. O custo fixo (propriedade) corre todas as ${fmt(h.calendarH)} h do mês; o operacional só nas horas trabalhadas.` });
    co.push(eq('eq_custo'));
    co.push(eq('eq_rpt'));
    const prodH = cs[0]?.circuits[0]?.productiveH ?? h.effectiveH;
    const tonnes = cs[0] ? cs[0].circuits.reduce((a, c) => a + c.tonnes, 0) : 0;
    co.push({
      t: 'box',
      kind: 'memo',
      lines: [
        ...cs.map((c) => `${c.tag}: ${fmt(c.fleet)} × ${fmt(c.costFixedPerH, 2)} × ${fmt(h.calendarH)} h + ${fmt(c.fleet)} × ${fmt(prodH, 1)} h × ${fmt(c.costVarPerH, 2)} = ${brl(c.cost.total, 0)} → ÷ ${fmt(tonnes)} t = **${brl(c.cost.perT)}/t**`),
        ...(cs.some((c) => c.price > 0) ? [`Investimento = frota × preço: ${cs.map((c) => `${c.tag} ${fmt(c.fleet)} × ${mi(c.price, 2)} = **${mi(c.cost.invest)}**`).join(' · ')}`] : []),
      ],
    });
    co.push(fig('cost', 'Custo por tonelada de cada configuração.'));
    co.push({
      t: 'table',
      head: ['Item', ...cfgHeads(cs)],
      headColors: headColors(d),
      colFill: recCol(d),
      rows: [
        ['Frota usada', ...cs.map((c) => `${fmt(c.fleet)} (${c.fleetSource})`)],
        ['Custo fixo do mês', ...cs.map((c) => brl(c.cost.fixedMonth, 0))],
        ['Custo operacional do mês', ...cs.map((c) => brl(c.cost.varMonth, 0))],
        ['Custo total do mês', ...cs.map((c) => brl(c.cost.total, 0))],
        ...(cs.some((c) => c.price > 0) ? [['Investimento na frota', ...cs.map((c) => mi(c.cost.invest))]] : []),
        ['Custo por tonelada', ...cs.map((c) => brl(c.cost.perT))],
      ],
      total: true,
    });
    const cheapest = cs.slice().sort((a, b) => a.cost.perT - b.cost.perT)[0];
    co.push({ t: 'box', kind: 'read', lines: cs.filter((c) => c !== cheapest).map((c) => `${c.tag} custa ${pct(c.cost.perT / cheapest.cost.perT - 1, 1)} a mais por tonelada que ${cheapest.tag}.`) });
    S.push(co);

    /* ------------------------------ decisão ------------------------------ */
    if (d.decision) {
      const dc = d.decision;
      const de: Block[] = [{ t: 'h1', text: 'Decisão no horizonte do plano', eyebrow: 'Longo prazo' }];
      de.push({ t: 'p', text: `O módulo de decisão avalia ${fmt(dc.periods)} período(s) com ${fmt(dc.tonnes)} t, com desgaste, troca e valor residual da frota, a ${pct(dc.rate, 1)} ao ano. Critério: ${dc.criterion}.` });
      de.push(eq('eq_nivel'));
      de.push(eq('eq_vpl'));
      de.push({ t: 'box', kind: 'sw', title: `resultados e decisão${dc.at ? ` (${dateBR(dc.at)})` : ''}`, lines: [] });
      de.push({
        t: 'table',
        head: ['Opção', 'Atende', 'Pico', 'Investimento', 'VPL dos custos', 'Custo nivelado', 'Trocas'],
        rows: dc.rows.map((r) => [r.name, r.allOk ? 'sim' : 'não', fmt(r.peakTrucks), mi(r.capex), mi(r.npvCost), `${brl(r.costPerT)}/t`, fmt(r.replacements)]),
        rowFill: Object.fromEntries(dc.rows.map((r, i) => [i, r.id === dc.chosenId ? REC_FILL : undefined]).filter((x) => x[1])) as Record<number, string>,
        widths: [0.32, 0.08, 0.08, 0.13, 0.14, 0.14, 0.11],
        small: true,
      });
      de.push({ t: 'box', kind: 'memo', lines: dc.rows.map((r) => `${short(r.name, 40)}: ${mi(r.npvCost, 2)} ÷ ${fmt(r.npvTonnes / 1e6, 3)} Mt (VPL das toneladas) = **${brl(r.costPerT)}/t**`) });
      if (dc.chosenPeriods.length) {
        de.push(fig('decisionPeriods', 'Custo de cada período da opção escolhida (compras e trocas aparecem como picos).'));
        de.push({
          t: 'table',
          head: ['Período', 'Caminhões', 'Compras', 'Trocas', 'Toneladas', 'Custo', 'R$/t'],
          rows: dc.chosenPeriods.map((p) => [p.label, fmt(p.trucks), fmt(p.bought), fmt(p.replaced), fmt(p.tonnes), mi(p.total), brl(p.tonnes > 0 ? p.total / p.tonnes : 0)]),
          small: true,
        });
      }
      if (dc.sens.length)
        de.push({ t: 'table', head: ['Sensibilidade (±20%)', 'Valor com −20%', 'Valor com +20%', 'Muda a escolha?'], rows: dc.sens.map((s) => [s.label, fmt(s.low, 2), fmt(s.high, 2), s.changes ? 'sim' : 'não']), widths: [0.4, 0.2, 0.2, 0.2] });
      if (dc.rows.some((r) => !r.allOk)) de.push({ t: 'box', kind: 'read', lines: ['Alguma opção marca “não atende”: confira no Plano de lavra os postos de carga, os pontos de descarga e a pesagem de cada movimentação — um gargalo de cadastro limita todas as opções e só o ranking relativo continua válido.'] });
      S.push(de);
    }

    /* ---------------------------- restrições ---------------------------- */
    const re: Block[] = [{ t: 'h1', text: 'Capacidade da descarga', eyebrow: 'Restrições' }];
    re.push({ t: 'p', text: 'A ocupação da descarga mostra quanto do tempo os pontos de descarga ficam ocupados para atender a meta. Até uns 70% quase não há fila; acima de 80–85% qualquer chegada fora de hora gera fila longa.' });
    re.push(eq('eq_cap'));
    re.push(eq('eq_ocup'));
    re.push({
      t: 'box',
      kind: 'memo',
      lines: cs
        .filter((c) => c.dump)
        .map((c) => `${c.tag} · ${c.dump!.destination}: ${fmt(c.dump!.stations)} × ${fmt(c.payloadT, 1)} × 60 ÷ ${fmt(c.dumpMin + c.maneuverMin, 1)} = **${fmt(c.dump!.capacityTph)} t/h** · ocupação ${fmt(c.dump!.needTph)} ÷ ${fmt(c.dump!.capacityTph)} = **${pct(c.dump!.occupancy)}** · com 1 ponto só: ${fmt(c.dump!.capacityOne)} t/h`),
    });
    S.push(re);
  }

  /* ------------------------------ conclusão ------------------------------ */
  const cl: Block[] = [{ t: 'h1', text: 'A escolha e por quê', eyebrow: 'Conclusão' }];
  cl.push({ t: 'p', text: d.conclusion });
  if (rec && cs.length > 1) {
    const best = (f: (c: ReportConfig) => number, low = true) => {
      const v = cs.map(f);
      const m = low ? Math.min(...v) : Math.max(...v);
      return cs.filter((c, i) => Math.abs(v[i] - m) <= Math.abs(m) * 0.01).map((c) => c.tag).join(' e ');
    };
    cl.push({
      t: 'table',
      head: ['Critério', ...cfgHeads(cs), 'Melhor'],
      headColors: [undefined, ...cs.map((c) => c.color), INK],
      colFill: recCol(d),
      rows: [
        ['Caminhões necessários', ...cs.map((c) => fmt(c.fleet)), best((c) => c.fleet)],
        ['Custo por tonelada', ...cs.map((c) => brl(c.cost.perT)), best((c) => c.cost.perT)],
        ...(hasRun ? [['Produção simulada', ...cs.map((c) => (c.base ? `${fmt(c.base.tpd)} t/dia` : '—')), best((c) => c.base?.tpd ?? 0, false)]] : []),
        ...(hasRun ? [['Fila na descarga', ...cs.map((c) => (c.base ? minutes(c.base.queueDumpMin) : '—')), best((c) => c.base?.queueDumpMin ?? 0)]] : []),
        ['Ocupação da descarga', ...cs.map((c) => (c.dump ? pct(c.dump.occupancy) : '—')), best((c) => c.dump?.occupancy ?? 0)],
        ...(cs.some((c) => c.price > 0) ? [['Investimento', ...cs.map((c) => mi(c.cost.invest)), best((c) => c.cost.invest)]] : []),
        ...(d.decision ? [['Custo nivelado no horizonte', ...cs.map((c) => (c.decision ? brl(c.decision.costPerT) : '—')), best((c) => c.decision?.costPerT ?? Infinity)]] : []),
      ],
    });
  }
  if (d.notes.length) {
    cl.push({ t: 'h2', text: 'Condições, restrições e próximos passos' });
    cl.push({ t: 'bullets', items: d.notes });
  }
  cl.push({ t: 'small', text: `Relatório gerado pelo T2 MinePlanner em ${dateBR(d.generatedAt)}. Caixas laranja: memória de cálculo · verdes: dados do software · azuis: como ler.` });
  S.push(cl);

  return { sections: S, figures: [...figures], equations: [...equations] };
}

