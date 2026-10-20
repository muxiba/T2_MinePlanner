/**
 * Custos de referência (editáveis) para o simulador.
 *
 * Fonte: SICRO – Sistema de Custos Referenciais de Obras (DNIT), custos horários de equipamentos,
 * referência abril/2026, Minas Gerais. O custo produtivo de MG é o "preço unitário" do estado;
 * o custo improdutivo de MG é estimado pela proporção improdutivo/produtivo da tabela nacional.
 * Valores consultados em orcamentor.com/sicro/equipamentos (espelho da tabela do DNIT).
 */
import type { SimModel, TruckConfig } from './types';

export interface SicroItem {
  code: string;
  description: string;
  /** custo horário produtivo em MG (R$/h) */
  productive: number;
  /** custo horário improdutivo em MG, estimado (R$/h) */
  unproductive: number;
  /** valor de aquisição de referência (R$), quando publicado */
  acquisition?: number;
}

export const SICRO_REF = {
  label: 'SICRO/DNIT, Minas Gerais, abril/2026',
  url: 'https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/custos-referenciais/sistemas-de-custos/sicro',
  roadTruck: { code: 'E9672', description: 'Caminhão basculante para rocha 12 m³ – 210 kW (referência para rodoviário)', productive: 382.87, unproductive: 122.03 } as SicroItem,
  truck: { code: 'E9667', description: 'Caminhão basculante 14 m³ – 210 kW', productive: 360.0, unproductive: 110.0 } as SicroItem,
  excavator: { code: 'E9515', description: 'Escavadeira hidráulica sobre esteiras 1,56 m³ – 118 kW', productive: 355.41, unproductive: 162.3, acquisition: 1_168_800.76 } as SicroItem,
  wheelLoader: { code: 'E9511', description: 'Carregadeira de pneus 3,40 m³ – 195 kW', productive: 550.32, unproductive: 269.3, acquisition: 2_141_837.62 } as SicroItem,
  grader: { code: 'E9524', description: 'Motoniveladora – 93 kW', productive: 359.49, unproductive: 156.6 } as SicroItem,
};

/** Receita indicativa (R$/t de produto), informada pelo usuário; editável. */
export const REVENUE_REF_PER_T = 400;

/**
 * Custos do caminhão no simulador a partir do SICRO:
 * custo fixo (R$/h de calendário) = improdutivo × horas do turno ÷ 24 (o caminhão parado no turno custa o improdutivo);
 * custo operacional (R$/h trabalhada) = produtivo − improdutivo (diesel, manutenção e pneus a mais quando trabalha).
 * Assim, uma hora trabalhada custa o produtivo e uma hora parada no turno, o improdutivo.
 */
export function sicroTruckCosts(hoursPerDay = 24, vehicle: 'mina' | 'rodoviario' = 'mina') {
  const t = vehicle === 'rodoviario' ? SICRO_REF.roadTruck : SICRO_REF.truck;
  return {
    costFixedPerH: Math.round(t.unproductive * (Math.min(24, Math.max(1, hoursPerDay)) / 24) * 100) / 100,
    costVarPerH: Math.round((t.productive - t.unproductive) * 100) / 100,
  };
}

/** Configurações sem custo (0 e 0) recebem a referência do SICRO. */
export function withReferenceCosts(model: SimModel): SimModel {
  const hpd = model.scenarios[0]?.hoursPerDay ?? 24;
  let changed = false;
  const configs: TruckConfig[] = model.configs.map((c) => {
    if (c.costFixedPerH || c.costVarPerH) return c;
    changed = true;
    return { ...c, ...sicroTruckCosts(hpd, c.vehicle) };
  });
  return changed ? { ...model, configs } : model;
}

/** Custos fixos do transporte por ano (referência): manutenção de vias com motoniveladora + supervisão. */
export function overheadReference(opts: { workDaysYear: number; graderHoursPerDay?: number; supervisorsPerShift?: number; shifts: number; reliefFactor: number; supervisorSalary?: number; chargesPct: number }) {
  const graderH = opts.graderHoursPerDay ?? 4;
  const sup = opts.supervisorsPerShift ?? 1;
  const salary = opts.supervisorSalary ?? 7000;
  const roads = SICRO_REF.grader.productive * graderH * opts.workDaysYear;
  const supervision = sup * opts.shifts * opts.reliefFactor * salary * 12 * (1 + opts.chargesPct / 100);
  return { roads, supervision, total: Math.round((roads + supervision) / 1000) * 1000, graderH, sup, salary };
}
