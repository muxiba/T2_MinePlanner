import type { DetailedPremises } from '../types';

/**
 * Partição do ROM na planta (em % do ROM seco), fonte única para todo o sistema.
 * - A úmido: RM global + rejeito total; o que faltar para 100% é perda de processo (água, ultrafinos), não transportada.
 * - A seco: RM editável (padrão 100%), sem rejeito; o que faltar para 100% é perda de processo.
 */
export function processPct(p: Pick<DetailedPremises, 'processType' | 'rmGlobal' | 'rejeitoTotal' | 'rmDry'>) {
  const seco = p.processType === 'seco';
  const rm = Math.max(0, Math.min(100, seco ? p.rmDry ?? 100 : p.rmGlobal || 0));
  const rej = seco ? 0 : Math.max(0, Math.min(100 - rm, p.rejeitoTotal || 0));
  return { rm, rej, loss: Math.max(0, 100 - rm - rej), seco };
}
