/** Memorial de cálculo dos resultados do circuito (aba Circuito → Resultados). */
import type { DetailedPremises } from '@/types';
import type { AggregateStats, SimModel, TruckState } from './types';
import type { SweepPoint } from './des';
import { configFor, limitsOf, travelTimes } from './des';
import { FLOW_LABELS, flowShares, linkOn, periodText, wetFactor, type CircuitCalc, type circuitPeriod } from './link';
import { fixedLossMinPerDay, lossesOf, ufFromLosses } from '@/engine/losses';
import { SICRO_REF } from './references';
import { bars, f0, f1, f2, fbrl2, formula, fp, kv, memoDocument, note, p, t, table, ul, type MemoSection } from './memo';

export interface CircuitMemoInput {
  model: SimModel;
  premises: DetailedPremises;
  calc: CircuitCalc[];
  per: ReturnType<typeof circuitPeriod>;
  matrix: { configId: string; scenarioId: string; stats: AggregateStats }[] | null;
  sel: { configId: string; scenarioId: string };
  sweep: { points: SweepPoint[]; minFleet: number | null; saturation: number; scope: 'sistema' | 'circuito'; target?: number; circuitName?: string } | null;
  studyName?: string;
}

const STATE_GROUPS: { label: string; states: TruckState[]; color: string }[] = [
  { label: 'Viagem, carga, descarga e pesagem', states: ['carregado', 'vazio', 'carregando', 'descarregando', 'pesando'], color: '#059669' },
  { label: 'Filas', states: ['fila_carga', 'fila_balanca', 'fila_descarga'], color: '#eb6834' },
  { label: 'Interferências na via', states: ['interferencia'], color: '#e87ba4' },
  { label: 'Troca de turno e inspeção', states: ['troca_turno'], color: '#5b6b7f' },
  { label: 'Refeição', states: ['refeicao'], color: '#b38f00' },
  { label: 'Abastecimento e lubrificação', states: ['abastecimento'], color: '#0e7490' },
  { label: 'Perdas operacionais (UF)', states: ['perdas'], color: '#a8a29e' },
  { label: 'Manutenção', states: ['manutencao'], color: '#d12f2f' },
  { label: 'Fora do turno', states: ['fora_turno'], color: '#94a3b8' },
];

export function circuitMemo(x: CircuitMemoInput): string {
  const { model, premises: P, calc, per, matrix, sel, sweep } = x;
  const linked = linkOn(model);
  const sc = model.scenarios.find((s) => s.id === sel.scenarioId) ?? model.scenarios[0];
  const cfg = model.configs.find((c) => c.id === sel.configId) ?? model.configs[0];
  const k = wetFactor(P);
  const sh = flowShares(P);
  const L = lossesOf(P);
  const name = (id: string) => model.circuits.find((c) => c.id === id)?.name ?? id;
  const periodLabel = periodText(per.kind, per.qty, model.period?.days);
  const sections: MemoSection[] = [];

  /* 1 ------------------------------------------------------------------ */
  sections.push({
    title: 'Objetivo e escopo',
    body:
      p(`Dimensionar a frota de transporte dos circuitos cadastrados para o período de <b>${t(periodLabel)}</b> (${f1(per.workDays)} dias trabalhados de ${f1(per.calendarDays)} dias corridos), comparando ${model.configs.length} configuração(ões) de caminhão em ${model.scenarios.length} cenário(s) operacional(is).`) +
      p(`O cálculo é feito de duas formas que se conferem: (a) <b>cálculo analítico</b> do ciclo médio, igual ao Dimensionamento das premissas; (b) <b>simulação de eventos discretos</b>, que reproduz viagem a viagem as filas, as quebras e as paradas, e mostra o efeito da variabilidade que a conta média não enxerga.`) +
      kv([
        ['Meta de ROM no período (t seca)', f0(per.romT)],
        ['Origem da meta', per.suggested ? 'Premissas Fundamentais (meta mensal × duração do período)' : 'digitada no período'],
        ['Circuitos', String(model.circuits.length)],
        ['Ligado às Premissas Fundamentais', linked ? 'sim (DF, UF, horas, tempos e caminhão vêm das premissas)' : 'não (valores digitados na simulação)'],
      ]),
  });

  /* 2 ------------------------------------------------------------------ */
  sections.push({
    title: 'Premissas utilizadas',
    body:
      kv([
        ['Horas de operação por dia', `${f1(sc?.hoursPerDay ?? 24)} h`],
        ['Disponibilidade física dos caminhões (DF)', `${f1(sc?.truckDf ?? 0)}%`],
        ['Utilização física (UF)', `${f1(linked ? P.ufMina : sc?.efficiency ?? 0)}%${P.losses?.enabled ? ' — calculada pelas perdas detalhadas' : ''}`],
        ['Umidade natural + perda de material', `${f1(P.umidadeNatural || 0)}% + ${f1(P.perdaMaterial || 0)}% → fator úmido ${f2(k)}`],
        ['Processo', P.processType === 'seco' ? 'seco (sem rejeito: todo o ROM vira produto)' : 'úmido'],
        ['Recuperação mássica global (RM)', `${f1(sh.rm * 100)}%`],
        ['Rejeito total', `${f1(sh.rej * 100)}%`],
        ['Estéril (relação estéril/ROM)', sh.rem > 0 ? f2(sh.rem) : 'não há'],
        ['Fila média por viagem (analítico)', `${f1(linked ? P.queueMin || 0 : 0)} min`],
        ['Limite de velocidade (carregado / vazio)', `${f0(limitsOf(model).loaded)} / ${f0(limitsOf(model).empty)} km/h (cada configuração pode ter o seu)`],
        ['Resistência ao rolamento', `${f1(model.rollingResistance)}%`],
        ['Reparo médio do caminhão (MTTR)', `${f1(model.truckMttrH)} h`],
        ['Repetições por cenário', String(model.replications)],
        ['Aquecimento descartado', `${f1(model.warmupH)} h`],
      ]) +
      (P.losses?.enabled
        ? `<h3>Perdas operacionais detalhadas</h3>` +
          (() => {
            const d = fixedLossMinPerDay(P);
            return (
              table(
                ['Perda', 'Premissa', 'min por caminhão por dia'],
                [
                  ['Troca de turno e inspeção', `${f0(L.shiftChangeMin)} min × ${f0(L.shifts)} turnos`, f0(d.shiftChange)],
                  ['Refeição', `${f0(L.mealMin)} min × ${f0(L.shifts)} turnos`, f0(d.meal)],
                  ['Abastecimento e lubrificação', `${f0(L.fuelMin)} min por dia`, f0(d.fuel)],
                  ['Outras paradas', `${f0(L.otherMinPerShift)} min × ${f0(L.shifts)} turnos`, f0(d.other)],
                ],
                { foot: ['Total', '', f0(d.total)] },
              ) +
              formula([`<b>UF</b> = 1 − perdas fixas ÷ minutos do dia = 1 − ${f0(d.total)} ÷ ${f0((P.contractedHoursMina || 24) * 60)} = <b>${f1(ufFromLosses(P))}%</b>`, `Interferências na via: <b>${f1(L.interferenceMin)} min por viagem</b> (somadas ao ciclo; na simulação, sorteadas na ida e na volta)`])
            );
          })()
        : note('Perdas detalhadas desligadas: a UF das premissas cobre todas as paradas de forma agregada.')),
  });

  /* 3 ------------------------------------------------------------------ */
  sections.push({
    title: 'Metas de cada circuito',
    body:
      formula([
        `<b>Produto</b> = ROM × RM = ROM × ${f1(sh.rm * 100)}%`,
        `<b>Rejeito filtrado</b> = ROM × rejeito total = ROM × ${f1(sh.rej * 100)}%`,
        `<b>Estéril</b> = ROM × relação estéril/ROM = ROM × ${f2(sh.rem)}`,
        `<b>Massa transportada (úmida)</b> = massa seca × (1 + umidade + perda) = seca × ${f2(k)}`,
        `Vários circuitos no mesmo fluxo: meta do fluxo × peso do circuito ÷ soma dos pesos`,
      ]) +
      table(
        ['Circuito', 'Fluxo', 'Participação', 'Meta (t seca)', 'Transportado (t úmida)', 't úmida por dia trab.'],
        calc.map((c) => [t(name(c.circuitId)), t(FLOW_LABELS[c.flow]), fp(c.sharePct), `${f0(c.tonnesDry)}${c.overridden ? ' *' : ''}`, f0(c.tonnes), f0(c.workDays > 0 ? c.tonnes / c.workDays : 0)]),
        { foot: ['Total', '', '', f0(calc.reduce((a, c) => a + c.tonnesDry, 0)), f0(calc.reduce((a, c) => a + c.tonnes, 0)), ''] },
      ) +
      note(`* meta digitada pelo analista no circuito. O total transportado (úmido) é maior que a meta seca porque inclui a água e a perda de material: ${f0(per.romT)} t seca × ${f2(k)} = ${f0(per.romT * k)} t úmida de ROM.`),
  });

  /* 4 ------------------------------------------------------------------ */
  const cfg0 = model.configs[0];
  sections.push({
    title: 'Ciclo e frota pelo cálculo analítico',
    body:
      formula([
        `<b>Horas produtivas</b> = dias trabalhados × horas/dia × DF × UF`,
        `<b>Ciclo</b> = carga + ida carregado + volta vazio + manobra e basculamento + pesagem + fila + interferência`,
        `<b>Ida e volta</b>: a rota é dividida em trechos de 20 m; em cada trecho, rampa efetiva = rampa + rolamento → velocidade pela tabela do caminhão (limitada pelo limite da via) → tempo = distância ÷ velocidade`,
        `<b>t/h por caminhão</b> = carga útil × 60 ÷ ciclo`,
        `<b>Caminhões</b> = (t úmida ÷ horas produtivas) ÷ t/h por caminhão, arredondado para cima`,
      ]) +
      table(
        ['Circuito', 'Config.', 'Carga (min)', 'Ida (min)', 'Volta (min)', 'Desc. (min)', 'Pes. (min)', 'Fila (min)', 'Interf. (min)', 'Ciclo (min)', 'Carga útil (t)', 't/h por cam.', 'Necessário (t/h)', 'Caminhões'],
        calc.map((c) => {
          const ci = model.circuits.find((z) => z.id === c.circuitId);
          const used = ci && cfg0 ? configFor(model, ci, cfg0) : cfg0;
          return [t(name(c.circuitId)), `<span title="${t(used?.name ?? '')}">${t(used?.id ?? '')}</span>`, f1(c.loadMin), f1(c.loadedMin), f1(c.emptyMin), f1(c.dumpMin), f1(c.weighMin), f1(c.queueMin), f1(c.interferenceMin), f1(c.cycleMin), f1(c.payloadT), f1(c.perTruckTph), f1(c.needTph), `${f2(c.trucksExact)} → <b>${c.trucks}</b>`];
        }),
        { foot: ['Total', '', '', '', '', '', '', '', '', '', '', '', '', String(calc.reduce((a, c) => a + c.trucks, 0))] },
      ) +
      note(`Config. = configuração de caminhão usada no cálculo (${t(model.configs.map((c) => `${c.id}: ${c.name}`).join('; '))}).`) +
      (calc[0] ? note(`Horas produtivas no período: ${f1(calc[0].workDays)} dias × ${f1(sc?.hoursPerDay ?? 24)} h × ${f1(sc?.truckDf ?? 0)}% × ${f1(linked ? P.ufMina : sc?.efficiency ?? 0)}% = <b>${f0(calc[0].productiveH)} h</b> por caminhão.`) : ''),
  });

  /* 5 ------------------------------------------------------------------ */
  sections.push({
    title: 'Metodologia da simulação de eventos discretos',
    body:
      p('Cada caminhão é acompanhado minuto a minuto. O relógio salta de evento em evento (chegada na carga, fim da carga, chegada na balança, fim da descarga…), sempre pelo próximo evento da fila de eventos. Os recursos compartilhados — posto de carga, balança, ponto de descarga, pulmão e carregadeira de recebimento — atendem um caminhão por vez por posto; quem chega com o recurso ocupado espera na fila.') +
      ul([
        `<b>Tempos variáveis:</b> carga, pesagem e descarga sorteados por distribuição lognormal em torno da média, com coeficiente de variação de ${fp(sc?.cv ?? 0)}; viagens com metade dessa variação.`,
        `<b>Quebras:</b> cada caminhão quebra após um tempo de operação sorteado (exponencial) com média MTBF = MTTR × DF ÷ (1 − DF) = ${f1(model.truckMttrH)} h × ${f1(sc?.truckDf ?? 0)}% ÷ ${f1(100 - (sc?.truckDf ?? 0))}% = <b>${f1((model.truckMttrH * (sc?.truckDf ?? 0)) / Math.max(1e-6, 100 - (sc?.truckDf ?? 0)))} h</b>; o reparo também é sorteado. Os postos de carga seguem a DF do equipamento de carga.`,
        P.losses?.enabled
          ? `<b>Paradas programadas:</b> troca de turno no início de cada turno, refeição no meio do turno em revezamento (±15 min entre caminhões) e abastecimento uma vez por dia; interferências na via sorteadas (exponencial) depois da ida e da volta. Com elas, a eficiência do cenário fica em 100% para não contar as perdas duas vezes.`
          : `<b>Perdas operacionais:</b> a parcela (1 − UF) é aplicada como espera após cada ciclo.`,
        `<b>Turno:</b> fora das ${f1(sc?.hoursPerDay ?? 24)} h de operação o caminhão fica parado.`,
        `<b>Repetições:</b> cada combinação de configuração × cenário é simulada ${model.replications} vezes com sorteios diferentes; os resultados mostrados são a média e o intervalo de 95% (t de Student) entre as repetições.`,
        `<b>Aquecimento:</b> as primeiras ${f1(model.warmupH)} h de cada repetição são descartadas, porque começam com todos os caminhões parados e filas vazias, o que não representa a operação normal.`,
      ]),
  });

  /* 6 ------------------------------------------------------------------ */
  if (matrix?.length) {
    const cfgName = (id: string) => model.configs.find((c) => c.id === id)?.name ?? id;
    const scName = (id: string) => model.scenarios.find((s) => s.id === id)?.name ?? id;
    sections.push({
      title: 'Resultados da simulação: configurações × cenários',
      body:
        table(
          ['Configuração', 'Cenário', 't/dia (média)', 'IC 95%', '% da meta', 'Ciclo (min)', 'Fila carga (min)', 'Fila desc. (min)', 'Ocup. carga', 'Ocup. desc.', 'R$/t'],
          matrix.map((m) => {
            const s = m.stats;
            return [t(cfgName(m.configId)), t(scName(m.scenarioId)), f0(s.tpd.mean), `${f0(s.tpd.lo)}–${f0(s.tpd.hi)}`, model.targetTpd > 0 ? fp(s.tpd.mean / model.targetTpd) : '—', f1(s.cycleMin.mean), f1(s.queueLoadMin.mean), f1(s.queueDumpMin.mean), fp(s.loaderUtil.mean), fp(s.dumpUtil.mean), s.costPerT.mean > 0 ? fbrl2(s.costPerT.mean) : '—'];
          }),
        ) +
        ul([
          '<b>t/dia</b>: toneladas úmidas descarregadas por dia de operação, somando todos os circuitos.',
          '<b>IC 95%</b>: faixa onde está a média verdadeira com 95% de confiança; faixas largas pedem mais repetições.',
          `<b>% da meta</b>: t/dia ÷ meta de ${f0(model.targetTpd)} t/dia.`,
          '<b>Ocupação</b>: fração do tempo em que o recurso está atendendo. Acima de ~85% as filas crescem depressa e mais caminhões rendem pouco.',
          `<b>R$/t</b>: (caminhões × custo fixo × horas do período + horas trabalhadas × custo operacional) ÷ toneladas. Referência: ${t(SICRO_REF.label)}.`,
        ]),
    });

    const cell = matrix.find((m) => m.configId === sel.configId && m.scenarioId === sel.scenarioId) ?? matrix[0];
    if (cell) {
      const share = cell.stats.stateShare;
      const rows = STATE_GROUPS.map((g) => ({ ...g, v: g.states.reduce((a, s) => a + (share[s] ?? 0), 0) })).filter((g) => g.v > 0.0005);
      const nT = model.circuits.reduce((a, c) => a + c.trucks, 0);
      sections.push({
        title: `Para onde vai o tempo dos caminhões · ${cfgName(cell.configId)} · ${scName(cell.scenarioId)}`,
        body:
          bars(rows.map((r) => ({ label: r.label, value: r.v, color: r.color, text: fp(r.v) }))) +
          table(
            ['Atividade', '% do dia', 'h por caminhão por dia', 'h por caminhão no período', `h da frota no período (${nT} cam.)`],
            [
              ...rows.map((r) => [r.label, fp(r.v), f1(r.v * 24), f0(r.v * 24 * per.workDays), f0(r.v * 24 * per.workDays * nT)]),
              ...(per.calendarDays - per.workDays > 0.05 ? [['Dias não trabalhados (chuva, folgas)', '—', '—', f0((per.calendarDays - per.workDays) * 24), f0((per.calendarDays - per.workDays) * 24 * nT)]] : []),
            ],
          ),
      });
    }
  }

  /* 7 ------------------------------------------------------------------ */
  sections.push({
    title: 'Busca da frota mínima',
    body:
      p('A busca responde: <i>com quantos caminhões este circuito atinge a meta, e a partir de quantos não adianta pôr mais?</i>') +
      ul([
        'Fixa a frota dos outros circuitos e testa 1, 2, 3… caminhões no circuito escolhido, simulando cada quantidade com as repetições (até 5).',
        '<b>Frota mínima</b>: a menor quantidade cuja produção média alcança a meta (do sistema, quando há um só circuito; do circuito, quando há vários).',
        '<b>Saturação</b>: a partir dela, cada caminhão a mais rende menos de 3% de produção — o gargalo passou a ser a carga, a balança ou a descarga, e mais caminhões só aumentam a fila.',
        'A busca para quando a produção deixa de crescer 1% por caminhão por dois passos seguidos (ou três, se a meta ainda não foi atingida).',
      ]) +
      (sweep
        ? table(
            ['Caminhões', 't/dia (média)', 'IC 95%', 'Fila na carga (min)', 'Ocupação da carga', 'Marca'],
            sweep.points.map((pt) => {
              const v = pt.value ?? pt.stats.tpd;
              return [String(pt.trucks), f0(v.mean), `${f0(v.lo)}–${f0(v.hi)}`, f1(pt.stats.queueLoadMin.mean), fp(pt.stats.loaderUtil.mean), [pt.trucks === sweep.minFleet ? '<b>frota mínima</b>' : '', pt.trucks === sweep.saturation ? 'saturação' : ''].filter(Boolean).join(' · ')];
            }),
          ) +
          note(
            `${sweep.circuitName ? `Circuito: ${t(sweep.circuitName)}. ` : ''}${sweep.target ? `Meta: ${f0(sweep.target)} t/dia. ` : ''}${sweep.minFleet ? `Frota mínima: <b>${sweep.minFleet} caminhões</b>. ` : 'Nenhuma frota testada atingiu a meta. '}Saturação em ${sweep.saturation} caminhões.`,
          )
        : note('A busca ainda não foi executada neste estudo.')),
  });

  /* 8 ------------------------------------------------------------------ */
  if (cfg && model.routes.length) {
    sections.push({
      title: `Tempos de viagem por rota · ${cfg.name}`,
      body: table(
        ['Rota', 'Comprimento (m)', 'Ida carregado (min)', 'Volta vazio (min)', 'Velocidade média ida (km/h)', 'Velocidade média volta (km/h)'],
        model.circuits
          .map((c) => {
            const r = model.routes.find((z) => z.id === c.routeId);
            if (!r) return null;
            const used = configFor(model, c, cfg);
            const tt = travelTimes(r.points, used.speed, limitsOf(model, used), used.rollingResistance ?? model.rollingResistance);
            const len = tt.s[tt.s.length - 1] ?? 0;
            return [t(r.name), f0(len), f1(tt.loaded), f1(tt.empty), f1(tt.loaded > 0 ? (len / 1000 / tt.loaded) * 60 : 0), f1(tt.empty > 0 ? (len / 1000 / tt.empty) * 60 : 0)];
          })
          .filter((r): r is string[] => r !== null),
      ),
    });
  }

  sections.push({
    title: 'Referências',
    body: ul([
      `${t(SICRO_REF.label)} — custos horários de equipamentos (${t(SICRO_REF.truck.code)} ${t(SICRO_REF.truck.description)}; ${t(SICRO_REF.roadTruck.code)} ${t(SICRO_REF.roadTruck.description)}).`,
      'Law, A. M. <i>Simulation Modeling and Analysis</i> — simulação de eventos discretos, réplicas independentes e período de aquecimento.',
      'Tabelas velocidade × rampa efetiva: valores típicos de fabricantes, editáveis por configuração.',
    ]),
  });

  return memoDocument({
    title: x.studyName ? `Resultados do circuito — ${x.studyName}` : 'Resultados do circuito',
    subtitle: `${periodLabel} · ${model.circuits.length} circuitos · ${model.configs.length} configurações × ${model.scenarios.length} cenários`,
    meta: [
      ['Período', periodLabel],
      ['Meta de ROM (t seca)', f0(per.romT)],
    ],
    sections,
  });
}
