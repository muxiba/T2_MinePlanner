import type { DetailedPremises } from '../types';

/**
 * Perdas operacionais detalhadas do caminhão (Premissas Fundamentais).
 * Ligadas, a UF da mina = 1 − paradas fixas do dia ÷ horas da jornada, e as interferências na via
 * entram no ciclo de cada viagem. O simulador gera cada parada como evento.
 */
export type Losses = NonNullable<DetailedPremises['losses']>;

export const DEFAULT_LOSSES: Losses = {
  enabled: false,
  shifts: 3,
  shiftChangeMin: 20,
  mealMin: 60,
  fuelMin: 30,
  interferenceMin: 1,
  otherMinPerShift: 10,
};

export const lossesOf = (p: DetailedPremises): Losses => ({ ...DEFAULT_LOSSES, ...(p.losses ?? {}) });

/** Minutos parados por caminhão por dia em paradas fixas (troca de turno, refeição, outras, abastecimento). */
export function fixedLossMinPerDay(p: DetailedPremises) {
  const l = lossesOf(p);
  const shifts = Math.max(1, Math.round(l.shifts || 1));
  return {
    shiftChange: shifts * Math.max(0, l.shiftChangeMin),
    meal: shifts * Math.max(0, l.mealMin),
    other: shifts * Math.max(0, l.otherMinPerShift),
    fuel: Math.max(0, l.fuelMin),
    get total() {
      return this.shiftChange + this.meal + this.other + this.fuel;
    },
  };
}

/** UF calculada pelas paradas fixas (%), sobre as horas da jornada da mina. */
export function ufFromLosses(p: DetailedPremises) {
  const day = Math.max(1, (p.contractedHoursMina || 24) * 60);
  return Math.max(0, Math.min(100, (1 - fixedLossMinPerDay(p).total / day) * 100));
}

/** Interferências na via por viagem (min), quando as perdas detalhadas estão ligadas. */
export const interferenceMin = (p: DetailedPremises) => (p.losses?.enabled ? Math.max(0, lossesOf(p).interferenceMin) : 0);
