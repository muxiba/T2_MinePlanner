/**
 * Troca de modo da rede (processo × só transporte) e liga/desliga do estéril, sem perder o que o usuário montou.
 */
import type { DetailedPremises, Route } from '../types';
import { routeKind } from './fleet';

export type FlowMode = 'processo' | 'transporte';

/** Guarda a rede do modo atual e traz a do outro modo (vazia na primeira vez). */
export function switchFlowMode(premises: DetailedPremises, routes: Route[], mode: FlowMode): { premises: DetailedPremises; routes: Route[] } | null {
  const cur: FlowMode = premises.flowMode ?? 'processo';
  if (cur === mode) return null;
  const saved = { ...(premises.savedNets ?? {}), [cur]: { nodes: premises.nodes ?? [], routes } };
  const next = saved[mode];
  const rest = { ...saved };
  delete rest[mode];
  return { premises: { ...premises, flowMode: mode, savedNets: rest, nodes: next?.nodes ?? [] }, routes: next?.routes ?? [] };
}

/** “Possui estéril”: desmarcado desativa as movimentações de estéril (marcadas); marcado de novo, elas voltam. */
export function setWasteOn(premises: DetailedPremises, routes: Route[], on: boolean): { premises: DetailedPremises; routes: Route[] } {
  const next = routes.map((r) => {
    if (routeKind(r) !== 'waste') return r;
    if (!on && r.active) return { ...r, active: false, wasteOff: true };
    if (on && r.wasteOff) return { ...r, active: true, wasteOff: undefined };
    return r;
  });
  return { premises: { ...premises, hasWasteRock: on }, routes: next };
}
