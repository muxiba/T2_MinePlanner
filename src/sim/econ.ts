/**
 * Avaliação econômica e vida útil da frota ao longo dos períodos do plano.
 *
 * A frota é acompanhada unidade a unidade (idade em horas): compra quando falta equipamento,
 * troca ao atingir a vida útil (crédito do valor residual), manutenção que sobe com a idade
 * e disponibilidade que cai com a idade (usada no dimensionamento de cada período).
 * Custos em R$ por período; VPL com a taxa de desconto anual.
 */
import type { MinePlan, PeriodResult } from './plan';
import { calendarWorkDays } from './plan';

export interface EquipFinance {
  /** valor de compra (R$) */
  price: number;
  /** valor residual ao fim da vida útil (% do valor de compra) */
  residualPct: number;
  /** vida útil (horas trabalhadas) */
  lifeH: number;
  dieselMode: 'lph' | 'lpt';
  /** consumo por hora trabalhada (L/h) */
  dieselLph: number;
  /** consumo por tonelada transportada (L/t) */
  dieselLpt: number;
  /** manutenção com o equipamento novo (R$/h) */
  maintPerH: number;
  /** aumento da manutenção a cada 10.000 h de idade (%) */
  maintEscPct: number;
  /** pneus e material rodante (R$/h) */
  tiresPerH: number;
  /** operadores por equipamento em cada turno */
  operatorsPerUnit: number;
  /** perda de disponibilidade física a cada 10.000 h de idade (pontos percentuais) */
  dfLossPer10kH: number;
}

export interface Finance {
  dieselPrice: number;
  /** taxa de desconto (% ao ano) */
  discountRate: number;
  /** salário mensal do operador (R$) */
  salaryMonthly: number;
  /** encargos e benefícios (% sobre o salário) */
  chargesPct: number;
  /** turnos por dia */
  shifts: number;
  /** fator de folguistas (ex.: 1,25 = 25% a mais de pessoas para cobrir folgas e férias) */
  reliefFactor: number;
  /** custos fixos do transporte por ano (supervisão, apoio, vias), R$ */
  overheadPerYear: number;
  /** receita por tonelada (R$/t); 0 = comparar só por custo */
  revenuePerT: number;
  /** material que gera receita (vazio = todas as toneladas transportadas) */
  revenueMaterial: string;
  /** por configuração de caminhão (id) */
  trucks: Record<string, EquipFinance>;
  /** equipamento de carga (escavadeira/carregadeira), por unidade */
  loader: EquipFinance;
  /** referências (SICRO, receita) já aplicadas uma vez; depois tudo é do usuário */
  refApplied?: boolean;
}

export function defaultTruckFinance(payloadT = 40): EquipFinance {
  const k = payloadT / 40;
  return {
    price: Math.round(1_600_000 * Math.pow(k, 0.85) / 10_000) * 10_000,
    residualPct: 20,
    lifeH: 40_000,
    dieselMode: 'lph',
    dieselLph: Math.round(28 * Math.pow(k, 0.8)),
    dieselLpt: 0.35,
    maintPerH: Math.round(70 * Math.pow(k, 0.8)),
    maintEscPct: 40,
    tiresPerH: Math.round(25 * k),
    operatorsPerUnit: 1,
    dfLossPer10kH: 2,
  };
}

export function defaultFinance(configIds: { id: string; payloadT: number }[] = []): Finance {
  return {
    dieselPrice: 6.2,
    discountRate: 12,
    salaryMonthly: 4_500,
    chargesPct: 80,
    shifts: 3,
    reliefFactor: 1.25,
    // referência: vias (motoniveladora SICRO, 4 h/dia, 276 dias) + 1 supervisor por turno; editável
    overheadPerYear: 964_000,
    revenuePerT: 400,
    revenueMaterial: 'Produto',
    refApplied: true,
    trucks: Object.fromEntries(configIds.map((c) => [c.id, defaultTruckFinance(c.payloadT)])),
    loader: {
      // SICRO E9511 carregadeira de pneus 3,40 m³ (valor de aquisição de referência)
      price: 2_140_000,
      residualPct: 20,
      lifeH: 50_000,
      dieselMode: 'lph',
      dieselLph: 30,
      dieselLpt: 0.1,
      maintPerH: 110,
      maintEscPct: 40,
      tiresPerH: 15,
      operatorsPerUnit: 1,
      dfLossPer10kH: 1.5,
    },
  };
}

export function financeFor(f: Finance, configId: string, payloadT: number): EquipFinance {
  return f.trucks[configId] ?? defaultTruckFinance(payloadT);
}

/* ------------------------------------------------------------------------- */
/* Frota unidade a unidade                                                    */
/* ------------------------------------------------------------------------- */

export interface LedgerStep {
  bought: number;
  replaced: number;
  capex: number;
  residualCredit: number;
  maintenance: number;
  avgAgeH: number;
  fleetSize: number;
}

export class FleetLedger {
  ages: number[] = [];
  constructor(private fin: EquipFinance) {}

  /** idade média das N unidades que vão operar (as mais novas; compras entram com idade 0) */
  previewAge(n: number) {
    if (n <= 0) return 0;
    const sorted = [...this.ages].sort((a, b) => a - b).slice(0, n);
    while (sorted.length < n) sorted.push(0);
    return sorted.reduce((a, b) => a + b, 0) / n;
  }

  /** opera N unidades por `hoursEach` horas cada no período */
  step(n: number, hoursEach: number): LedgerStep {
    const f = this.fin;
    let bought = 0;
    while (this.ages.length < n) {
      this.ages.push(0);
      bought++;
    }
    let capex = bought * f.price;
    let credit = 0;
    let replaced = 0;
    let maintenance = 0;
    const order = this.ages.map((a, i) => [a, i] as const).sort((a, b) => a[0] - b[0]).slice(0, n);
    let ageSum = 0;
    for (const [, i] of order) {
      const a0 = this.ages[i];
      ageSum += a0;
      const mid = a0 + hoursEach / 2;
      maintenance += hoursEach * f.maintPerH * (1 + (f.maintEscPct / 100) * (mid / 10_000));
      let a = a0 + hoursEach;
      // fim da vida útil: troca por uma nova (o que passou da vida conta na nova)
      while (f.lifeH > 0 && a >= f.lifeH) {
        a -= f.lifeH;
        replaced++;
        capex += f.price;
        credit += (f.price * f.residualPct) / 100;
      }
      this.ages[i] = a;
    }
    return { bought, replaced, capex, residualCredit: credit, maintenance, avgAgeH: n ? ageSum / n : 0, fleetSize: this.ages.length };
  }

  /** valor da frota no fim do horizonte (depreciação linear até o residual) */
  salvage() {
    const f = this.fin;
    return this.ages.reduce((a, age) => a + f.price * (1 - (1 - f.residualPct / 100) * Math.min(1, age / Math.max(1, f.lifeH))), 0);
  }
}

/** Disponibilidade física corrigida pela idade média da frota. */
export const agedDf = (baseDf: number, fin: EquipFinance, avgAgeH: number) => Math.max(40, baseDf - (fin.dfLossPer10kH * avgAgeH) / 10_000);

/* ------------------------------------------------------------------------- */
/* Custos por período                                                         */
/* ------------------------------------------------------------------------- */

export interface PeriodCost {
  period: number;
  label: string;
  years: number;
  tonnes: number;
  revenueTonnes: number;
  trucks: number;
  fleetSize: number;
  bought: number;
  replaced: number;
  avgAgeH: number;
  truckHours: number;
  capex: number;
  residualCredit: number;
  diesel: number;
  maintenance: number;
  tires: number;
  labor: number;
  loaders: number;
  overhead: number;
  /** custo total do período (capex − crédito + operação) */
  total: number;
  revenue: number;
  dieselL: number;
  people: number;
}

export interface Evaluation {
  configId: string;
  scenarioId: string;
  periods: PeriodCost[];
  tonnes: number;
  totalCost: number;
  capex: number;
  opex: number;
  salvage: number;
  npvCost: number;
  npvTonnes: number;
  /** custo nivelado (VPL dos custos ÷ VPL das toneladas) */
  costPerT: number;
  npv: number | null;
  peakTrucks: number;
  replacements: number;
  allOk: boolean;
  /** menor folga de produção entre os períodos (simulado ÷ meta) */
  minMargin: number;
  people: number;
}

export interface EvalOptions {
  /** multiplicadores para a análise de sensibilidade */
  mult?: Partial<Record<SensKey, number>>;
}

export type SensKey = 'diesel' | 'salario' | 'manutencao' | 'equipamento' | 'producao' | 'taxa';

export const SENS_LABELS: Record<SensKey, string> = {
  diesel: 'Preço do diesel',
  salario: 'Salários e encargos',
  manutencao: 'Custo de manutenção',
  equipamento: 'Preço dos equipamentos',
  producao: 'Produção (toneladas)',
  taxa: 'Taxa de desconto',
};

export function evaluate(results: PeriodResult[], plan: MinePlan, fin: Finance, configId: string, payloadT: number, scenarioId: string, opt: EvalOptions = {}): Evaluation {
  const m = (k: SensKey) => opt.mult?.[k] ?? 1;
  const base = financeFor(fin, configId, payloadT);
  const tf: EquipFinance = { ...base, price: base.price * m('equipamento'), maintPerH: base.maintPerH * m('manutencao') };
  const lf: EquipFinance = { ...fin.loader, price: fin.loader.price * m('equipamento'), maintPerH: fin.loader.maintPerH * m('manutencao') };
  const trucks = new FleetLedger(tf);
  const loaders = new FleetLedger(lf);
  const yearDays = Math.max(1, calendarWorkDays(plan.calendar));
  const dieselPrice = fin.dieselPrice * m('diesel');
  const wage = fin.salaryMonthly * 12 * (1 + fin.chargesPct / 100) * m('salario');
  const rate = (fin.discountRate * m('taxa')) / 100;
  const revMat = fin.revenueMaterial.trim().toLowerCase();
  const sorted = [...results].sort((a, b) => a.period - b.period);
  const periods: PeriodCost[] = [];
  let t = 0;
  let npvCost = 0;
  let npvTonnes = 0;
  let npvRev = 0;
  for (const r of sorted) {
    const per = plan.periods[r.period - 1];
    const years = Math.max(0.01, (per?.workDays ?? yearDays) / yearDays);
    const prod = m('producao');
    const tonnes = r.circuits.reduce((a, c) => a + c.tonnes, 0) * prod;
    const revenueTonnes = r.circuits.filter((c) => !revMat || c.material.toLowerCase().includes(revMat)).reduce((a, c) => a + c.tonnes, 0) * prod;
    const hoursEach = r.hoursPerTruck * prod;
    const st = trucks.step(r.trucks, hoursEach);
    const truckHours = hoursEach * r.trucks;
    const dieselL = tf.dieselMode === 'lpt' ? tonnes * tf.dieselLpt : truckHours * tf.dieselLph;
    // equipamento de carga: opera as horas do turno com a mesma fração trabalhada dos caminhões
    const loaderHoursEach = hoursEach * 0.9;
    const ls = loaders.step(r.loaders, loaderHoursEach);
    const loaderDieselL = lf.dieselMode === 'lpt' ? tonnes * lf.dieselLpt : loaderHoursEach * r.loaders * lf.dieselLph;
    const peopleTrucks = r.trucks * tf.operatorsPerUnit * fin.shifts * fin.reliefFactor;
    const peopleLoaders = r.loaders * lf.operatorsPerUnit * fin.shifts * fin.reliefFactor;
    const labor = (peopleTrucks + peopleLoaders) * wage * years;
    const loaderCost = ls.capex - ls.residualCredit + ls.maintenance + loaderHoursEach * r.loaders * lf.tiresPerH + loaderDieselL * dieselPrice;
    const diesel = dieselL * dieselPrice;
    const tires = truckHours * tf.tiresPerH;
    const overhead = fin.overheadPerYear * years;
    const total = st.capex - st.residualCredit + diesel + st.maintenance + tires + labor + loaderCost + overhead;
    const revenue = revenueTonnes * fin.revenuePerT;
    t += years;
    const df = Math.pow(1 + rate, t - years / 2); // meio do período
    npvCost += total / df;
    npvTonnes += tonnes / df;
    npvRev += revenue / df;
    periods.push({
      period: r.period,
      label: r.label,
      years,
      tonnes,
      revenueTonnes,
      trucks: r.trucks,
      fleetSize: st.fleetSize,
      bought: st.bought,
      replaced: st.replaced,
      avgAgeH: st.avgAgeH,
      truckHours,
      capex: st.capex - st.residualCredit,
      residualCredit: st.residualCredit,
      diesel,
      maintenance: st.maintenance,
      tires,
      labor,
      loaders: loaderCost,
      overhead,
      total,
      revenue,
      dieselL: dieselL + loaderDieselL,
      people: peopleTrucks + peopleLoaders,
    });
  }
  const salvage = trucks.salvage() + loaders.salvage();
  npvCost -= salvage / Math.pow(1 + rate, t);
  const totalCost = periods.reduce((a, p) => a + p.total, 0) - salvage;
  const capex = periods.reduce((a, p) => a + p.capex, 0);
  const margins = sorted.flatMap((r) => r.circuits.map((c) => (c.targetTpd > 0 ? c.achievedTpd / c.targetTpd : 1)));
  return {
    configId,
    scenarioId,
    periods,
    tonnes: periods.reduce((a, p) => a + p.tonnes, 0),
    totalCost,
    capex,
    opex: totalCost - capex + salvage,
    salvage,
    npvCost,
    npvTonnes,
    costPerT: npvTonnes > 0 ? npvCost / npvTonnes : 0,
    npv: fin.revenuePerT > 0 ? npvRev - npvCost : null,
    peakTrucks: Math.max(0, ...periods.map((p) => p.trucks)),
    replacements: periods.reduce((a, p) => a + p.replaced, 0),
    allOk: sorted.every((r) => r.ok),
    minMargin: margins.length ? Math.min(...margins) : 1,
    people: Math.max(0, ...periods.map((p) => p.people)),
  };
}

/* ------------------------------------------------------------------------- */
/* Ranking e sensibilidade                                                    */
/* ------------------------------------------------------------------------- */

export type Criterion = 'economico' | 'producao' | 'equilibrado';

export const CRITERIA: { id: Criterion; label: string; help: string }[] = [
  { id: 'equilibrado', label: 'Atende a produção com o menor custo', help: 'Entre as opções que cumprem a meta em todos os períodos, a de menor custo por tonelada (VPL).' },
  { id: 'economico', label: 'Econômico', help: 'Maior VPL (com receita) ou menor custo por tonelada, mesmo que algum período fique abaixo da meta.' },
  { id: 'producao', label: 'Produção', help: 'Cumpre a meta em todos os períodos com a maior folga e, no empate, menos caminhões.' },
];

export function rank(evals: Evaluation[], criterion: Criterion): Evaluation[] {
  const econ = (a: Evaluation, b: Evaluation) => (a.npv !== null && b.npv !== null ? b.npv - a.npv : a.costPerT - b.costPerT);
  const list = [...evals];
  if (criterion === 'economico') return list.sort(econ);
  if (criterion === 'producao') return list.sort((a, b) => Number(b.allOk) - Number(a.allOk) || b.minMargin - a.minMargin || a.peakTrucks - b.peakTrucks || econ(a, b));
  return list.sort((a, b) => Number(b.allOk) - Number(a.allOk) || econ(a, b));
}

export interface SensRow {
  key: SensKey;
  label: string;
  low: number;
  high: number;
  /** a opção vencedora muda quando o parâmetro varia? */
  winnerLow: string;
  winnerHigh: string;
}

/**
 * Tornado: varia cada parâmetro ±delta e recalcula o custo por tonelada da opção escolhida
 * e quem venceria. Produção altera horas e toneladas proporcionalmente (aproximação sem re-simular).
 */
export function sensitivity(
  combos: { results: PeriodResult[]; configId: string; payloadT: number; scenarioId: string }[],
  plan: MinePlan,
  fin: Finance,
  chosen: { configId: string; scenarioId: string },
  criterion: Criterion,
  delta = 0.2,
): SensRow[] {
  const keys = Object.keys(SENS_LABELS) as SensKey[];
  const evalAll = (mult: Partial<Record<SensKey, number>>) => combos.map((c) => evaluate(c.results, plan, fin, c.configId, c.payloadT, c.scenarioId, { mult }));
  const pick = (ev: Evaluation[]) => ev.find((e) => e.configId === chosen.configId && e.scenarioId === chosen.scenarioId)!;
  const metric = (e: Evaluation) => (e.npv !== null ? e.npv : e.costPerT);
  const id = (e: Evaluation) => `${e.configId}|${e.scenarioId}`;
  return keys
    .map((key) => {
      const lo = evalAll({ [key]: 1 - delta });
      const hi = evalAll({ [key]: 1 + delta });
      return { key, label: SENS_LABELS[key], low: metric(pick(lo)), high: metric(pick(hi)), winnerLow: id(rank(lo, criterion)[0]), winnerHigh: id(rank(hi, criterion)[0]) };
    })
    .sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
}
