/** Memorial de cálculo de Resultados e decisão: ranking, fluxo de caixa e o que move o custo de cada opção. */
import type { SimModel } from './types';
import type { MinePlan } from './plan';
import { calendarWorkDays } from './plan';
import { CASH_ITEMS, CRITERIA, DRIVER_CATS, cashFlow, costDrivers, explainDifference, financeFor, type Criterion, type Evaluation, type Finance, type SensRow } from './econ';
import { SICRO_REF } from './references';
import { bars, f0, f1, f2, fbrl, fbrl2, formula, fp, kv, memoDocument, note, p, t, table, ul, type MemoSection } from './memo';

export interface DecisionMemoInput {
  model: SimModel;
  plan: MinePlan;
  fin: Finance;
  ranked: Evaluation[];
  chosen: Evaluation;
  criterion: Criterion;
  sens: SensRow[];
  optName: (e: { configId: string; scenarioId: string }) => string;
  compareNote?: string;
}

const COLORS: Record<string, string> = { capex: '#2a78d6', diesel: '#eb6834', maintenance: '#1baf7a', tires: '#eda100', labor: '#e87ba4', loaders: '#8a5cd6', overhead: '#8a8984' };
const mi = (n: number) => `R$ ${(n / 1e6).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} mi`;
const sgn = (n: number) => (Math.round(n) < 0 ? `<span class="neg">${fbrl(n)}</span>` : fbrl(Math.abs(n) < 0.5 ? 0 : n));

export function decisionMemo(x: DecisionMemoInput): string {
  const { model, plan, fin, ranked, chosen, criterion, sens, optName } = x;
  const best = ranked[0];
  const withRevenue = fin.revenuePerT > 0;
  const cfgName = (id: string) => model.configs.find((c) => c.id === id)?.name ?? id;
  const sections: MemoSection[] = [];
  const totalPlanT = plan.movements.reduce((a, m) => a + m.tonnes.reduce((s, v) => s + v, 0), 0);

  sections.push({
    title: 'Objetivo e resposta',
    body:
      p(`Escolher a configuração de transporte para atender o plano de lavra de ${plan.periods.length} período(s), comparando ${ranked.length} opção(ões) por produção e por custo ao longo de todo o horizonte, com o desgaste e a troca da frota.`) +
      `<div class="callout"><b>Melhor opção pelo critério “${t(CRITERIA.find((c) => c.id === criterion)?.label)}”: ${t(optName(best))}.</b><br>` +
      `${best.allOk ? 'Cumpre a meta em todos os períodos' : 'Não cumpre a meta em algum período'} (folga mínima ${fp(best.minMargin - 1)}), pico de ${best.peakTrucks} caminhões, custo nivelado de <b>${fbrl2(best.costPerT)}/t</b>${withRevenue && best.npv !== null ? `, VPL do transporte de <b>${mi(best.npv)}</b>` : ''}.</div>` +
      note(t(CRITERIA.find((c) => c.id === criterion)?.help) + (x.compareNote ? ` ${t(x.compareNote)}` : '')),
  });

  sections.push({
    title: 'Dados do plano',
    body:
      kv([
        ['Períodos', String(plan.periods.length)],
        ['Movimentações', String(plan.movements.length)],
        ['Toneladas do plano', `${f0(totalPlanT)} t (${plan.tonnesBasis === 'seca' ? 'base seca; transportado = seca × ' + f2(plan.wetFactor ?? 1) : 'base úmida'})`],
        ['Dias trabalháveis por ano (calendário)', f0(calendarWorkDays(plan.calendar))],
        ['Horas de operação por dia', `${f1(plan.hoursPerDay)} h`],
        ['Configurações comparadas', model.configs.map((c) => c.name).join('; ')],
        ['Cenários', model.scenarios.map((s) => s.name).join('; ')],
      ]) +
      table(
        ['Período', 'Dias trabalhados', 'Toneladas transportadas (opção escolhida)', 'Caminhões operando', 'Horas por caminhão'],
        chosen.periods.map((pp) => [t(pp.label), f1(plan.periods[pp.period - 1]?.workDays ?? 0), f0(pp.tonnes), String(pp.trucks), f0(pp.trucks ? pp.truckHours / pp.trucks : 0)]),
      ),
  });

  sections.push({
    title: 'Premissas econômicas',
    body:
      kv([
        ['Diesel', `${fbrl2(fin.dieselPrice)}/L`],
        ['Taxa de desconto', `${f1(fin.discountRate)}% ao ano`],
        ['Salário do operador', `${fbrl(fin.salaryMonthly)}/mês + ${f0(fin.chargesPct)}% de encargos e benefícios`],
        ['Turnos e folguistas', `${f0(fin.shifts)} turnos × fator ${f2(fin.reliefFactor)}`],
        ['Custos fixos do transporte', `${fbrl(fin.overheadPerYear)}/ano`],
        ['Receita', withRevenue ? `${fbrl2(fin.revenuePerT)}/t de ${t(fin.revenueMaterial || 'todas as toneladas')}` : 'sem receita (comparação só por custo)'],
      ]) +
      table(
        ['Equipamento', 'Preço (R$)', 'Residual', 'Vida útil (h)', 'Diesel', 'Manutenção nova (R$/h)', '+ manut./10 mil h', 'Pneus (R$/h)', '− DF/10 mil h'],
        [
          ...model.configs.map((c) => {
            const e = financeFor(fin, c.id, c.payloadT);
            return [t(c.name), fbrl(e.price), `${f0(e.residualPct)}%`, f0(e.lifeH), e.dieselMode === 'lph' ? `${f1(e.dieselLph)} L/h` : `${f2(e.dieselLpt)} L/t`, f1(e.maintPerH), `${f0(e.maintEscPct)}%`, f1(e.tiresPerH), `${f1(e.dfLossPer10kH)} p.p.`];
          }),
          ['Equipamento de carga', fbrl(fin.loader.price), `${f0(fin.loader.residualPct)}%`, f0(fin.loader.lifeH), fin.loader.dieselMode === 'lph' ? `${f1(fin.loader.dieselLph)} L/h` : `${f2(fin.loader.dieselLpt)} L/t`, f1(fin.loader.maintPerH), `${f0(fin.loader.maintEscPct)}%`, f1(fin.loader.tiresPerH), `${f1(fin.loader.dfLossPer10kH)} p.p.`],
        ],
      ),
  });

  sections.push({
    title: 'Metodologia',
    body:
      ul([
        '<b>Frota de cada período:</b> para cada configuração × cenário, a simulação de eventos discretos parte de uma estimativa analítica e acrescenta caminhões até cada movimentação cumprir a meta diária (toneladas ÷ dias trabalhados); depois retira o que sobrou. Se um caminhão a mais rende menos de 1,5%, a movimentação está saturada pela carga ou pela descarga.',
        '<b>Desgaste:</b> cada caminhão acumula horas; a manutenção sobe e a disponibilidade cai com a idade (valores na tabela acima). A DF corrigida pela idade entra no dimensionamento do período seguinte.',
        '<b>Troca:</b> ao atingir a vida útil, o caminhão é trocado por um novo e o valor residual é creditado.',
        '<b>Valor presente:</b> cada período é descontado no seu ponto médio; a frota que sobra no fim do horizonte é creditada pelo valor depreciado (linear até o residual).',
      ]) +
      formula([
        `<b>Custo do período</b> = compras − residual + diesel + manutenção + pneus + mão de obra + equipamento de carga + custos fixos`,
        `<b>Diesel</b> = horas de caminhão × L/h × preço (ou t × L/t × preço)`,
        `<b>Manutenção</b> = horas × R$/h novo × (1 + aumento × idade média ÷ 10.000 h)`,
        `<b>Mão de obra</b> = caminhões × operadores × turnos × folguistas × salário anual com encargos × anos`,
        `<b>Fator de desconto</b> = (1 + taxa)^(anos até o meio do período)`,
        `<b>Custo nivelado (R$/t)</b> = VPL dos custos ÷ VPL das toneladas`,
        withRevenue ? `<b>VPL</b> = Σ (receita − custo) ÷ fator + valor residual da frota ÷ fator final` : `<b>Sem receita</b>: a escolha usa o custo nivelado`,
      ]),
  });

  sections.push({
    title: 'Comparação das opções',
    body: table(
      ['#', 'Opção', 'Meta', 'Folga mín.', 'Pico de caminhões', 'Pessoas', 'Investimento', 'VPL dos custos', 'R$/t nivelado', ...(withRevenue ? ['VPL'] : []), 'Trocas'],
      ranked.map((e, i) => [String(i + 1), t(optName(e)), e.allOk ? 'atende' : '<span class="neg">não atende</span>', fp(e.minMargin - 1), String(e.peakTrucks), f1(e.people), mi(e.capex), mi(e.npvCost), fbrl2(e.costPerT), ...(withRevenue ? [e.npv !== null ? mi(e.npv) : '—'] : []), String(e.replacements)]),
    ),
  });

  /* o que move o custo ------------------------------------------------- */
  const drivers = ranked.map((e) => ({ e, d: costDrivers(e) }));
  const ref = drivers[0];
  sections.push({
    title: 'O que move o custo de cada opção',
    body:
      p('Custo por tonelada sem desconto (antes do crédito da frota que sobra no fim), separado por item. As diferenças entre as opções vêm de quantos caminhões cada uma precisa (compra, mão de obra), de quantas horas de caminhão cada tonelada consome (diesel, manutenção, pneus) e de quantas trocas a vida útil exige.') +
      table(
        ['Opção', ...DRIVER_CATS.map((c) => c.label), 'Total R$/t', 'h de caminhão por mil t', 'Diesel (L/t)', 'Caminhões (média / pico)'],
        drivers.map(({ e, d }) => [t(optName(e)), ...DRIVER_CATS.map((c) => fbrl2(d.perT[c.key])), `<b>${fbrl2(d.totalPerT)}</b>`, f1(d.truckHoursPerKt), f2(d.dieselLPerT), `${f1(d.avgTrucks)} / ${d.peakTrucks}`]),
      ) +
      drivers
        .slice(1)
        .map(({ e, d }) => `<h3>${t(optName(e))} × ${t(optName(ref.e))}</h3>${ul(explainDifference(d, ref.d, optName(e), optName(ref.e)).map(t))}`)
        .join('') +
      `<h3>Composição do custo da opção escolhida</h3>` +
      (() => {
        const d = costDrivers(chosen);
        return bars(DRIVER_CATS.map((c) => ({ label: c.label, value: Math.max(0, d.perT[c.key]), color: COLORS[c.key], text: `${fbrl2(d.perT[c.key])}/t` })));
      })(),
  });

  /* fluxo de caixa ----------------------------------------------------- */
  const cf = cashFlow(chosen);
  const cols = cf.rows.map((r) => t(r.label));
  sections.push({
    title: `Fluxo de caixa detalhado · ${optName(chosen)}`,
    body:
      p('Valores em R$ por período, sem inflação. Saídas com sinal negativo. O valor residual da frota que sobra no fim do horizonte entra na última coluna.') +
      table(
        ['Item', ...cols, 'Residual final', 'Total'],
        [
          ...CASH_ITEMS.filter((c) => withRevenue || c.key !== 'revenue').map((c) => [c.label, ...cf.rows.map((r) => sgn(c.sign * r.values[c.key])), '', sgn(c.sign * cf.totals[c.key])]),
          ['Valor residual da frota restante', ...cf.rows.map(() => ''), sgn(cf.salvage.value), sgn(cf.salvage.value)],
          ['<b>Fluxo líquido</b>', ...cf.rows.map((r) => `<b>${sgn(r.net)}</b>`), `<b>${sgn(cf.salvage.value)}</b>`, `<b>${sgn(cf.totals.net)}</b>`],
          ['Fator de desconto', ...cf.rows.map((r) => f2(r.pvFactor)), f2(chosen.endPvFactor), ''],
          ['Fluxo em valor presente', ...cf.rows.map((r) => sgn(r.pvNet)), sgn(cf.salvage.pv), `<b>${sgn(cf.totals.pvNet)}</b>`],
          ['VP acumulado', ...cf.rows.map((r) => sgn(r.cumPvNet)), sgn(cf.totals.pvNet), ''],
          ['Toneladas', ...chosen.periods.map((pp) => f0(pp.tonnes)), '', f0(chosen.tonnes)],
          ['Custo por tonelada', ...cf.rows.map((r, i) => (chosen.periods[i].tonnes ? fbrl2(r.cost / chosen.periods[i].tonnes) : '—')), '', fbrl2(chosen.tonnes ? cf.totals.cost / chosen.tonnes : 0)],
        ],
      ) +
      table(
        ['Período', 'Caminhões operando', 'Frota', 'Compras', 'Trocas', 'Idade média (h)', 'Horas de caminhão', 'Diesel (L)', 'Pessoas'],
        chosen.periods.map((pp) => [t(pp.label), String(pp.trucks), String(pp.fleetSize), String(pp.bought || ''), String(pp.replaced || ''), f0(pp.avgAgeH), f0(pp.truckHours), f0(pp.dieselL), f1(pp.people)]),
      ) +
      note('Os picos de saída coincidem com compras e trocas por fim de vida útil; ao longo dos anos a idade média faz a manutenção subir e a disponibilidade cair, o que pode exigir mais caminhões.'),
  });

  /* fluxo de todas as opções ------------------------------------------- */
  const labels = best.periods.map((pp) => t(pp.label));
  sections.push({
    title: 'Fluxo líquido de todas as opções',
    body:
      table(
        ['Opção', ...labels, 'VP total'],
        ranked.map((e) => {
          const c = cashFlow(e);
          return [t(optName(e)), ...c.rows.map((r) => sgn(withRevenue ? r.net : -r.cost)), `<b>${sgn(withRevenue ? c.totals.pvNet : -e.npvCost)}</b>`];
        }),
      ) + note(withRevenue ? 'Receita − custos de cada período (R$).' : 'Custos de cada período (R$, negativos).'),
  });

  if (sens.length) {
    sections.push({
      title: `Sensibilidade · ${optName(chosen)}`,
      body:
        table(
          ['Parâmetro (±20%)', `${withRevenue ? 'VPL' : 'R$/t'} com −20%`, `${withRevenue ? 'VPL' : 'R$/t'} com +20%`, 'Muda a escolha?'],
          sens.map((r) => {
            const fmt = (v: number) => (withRevenue ? mi(v) : fbrl2(v));
            const k = `${chosen.configId}|${chosen.scenarioId}`;
            const flip = r.winnerLow !== k || r.winnerHigh !== k;
            const nm = (id: string) => {
              const [c, s] = id.split('|');
              return optName({ configId: c, scenarioId: s });
            };
            return [r.label, fmt(r.low), fmt(r.high), flip ? `<span class="neg">sim: ${t([r.winnerLow !== k ? `−20% → ${nm(r.winnerLow)}` : '', r.winnerHigh !== k ? `+20% → ${nm(r.winnerHigh)}` : ''].filter(Boolean).join('; '))}</span>` : 'não'];
          }),
        ) + note('Cada parâmetro é variado sozinho; a produção varia horas e toneladas na mesma proporção, sem re-simular as filas.'),
    });
  }

  sections.push({
    title: 'Referências',
    body: ul([
      `${t(SICRO_REF.label)} — custos horários e valores de aquisição de referência (caminhões ${t(SICRO_REF.truck.code)} e ${t(SICRO_REF.roadTruck.code)}, escavadeira ${t(SICRO_REF.excavator.code)}, carregadeira ${t(SICRO_REF.wheelLoader.code)}, motoniveladora ${t(SICRO_REF.grader.code)}).`,
      'Custo nivelado (levelized cost) e VPL: prática usual de avaliação de projetos de mineração.',
      `Configuração de cada caminhão em: ${t(model.configs.map((c) => cfgName(c.id)).join('; '))}.`,
    ]),
  });

  return memoDocument({
    title: 'Resultados e decisão da frota',
    subtitle: `${ranked.length} opções · ${plan.periods.length} períodos · critério: ${CRITERIA.find((c) => c.id === criterion)?.label ?? ''}`,
    meta: [
      ['Melhor opção', optName(best)],
      ['Custo nivelado', `${fbrl2(best.costPerT)}/t`],
    ],
    sections,
  });
}
