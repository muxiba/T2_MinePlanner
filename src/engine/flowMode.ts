/**
 * Troca de modo da rede (processo × só transporte) e liga/desliga do estéril, sem perder o que o usuário montou.
 */
import type { DetailedPremises, FlowNode, Route } from '../types';
import { routeKind } from './fleet';

export type FlowMode = 'processo' | 'transporte';

/** Guarda a rede do modo atual e traz a do outro modo (vazia na primeira vez). */
export function switchFlowMode(premises: DetailedPremises, routes: Route[], mode: FlowMode): { premises: DetailedPremises; routes: Route[] } | null {
  const cur: FlowMode = premises.flowMode ?? 'processo';
  if (cur === mode) return null;
  const saved = { ...(premises.savedNets ?? {}), [cur]: { nodes: premises.nodes ?? [], routes } };
  const next = saved[mode] ?? (mode === 'transporte' ? seedTransport(premises, routes[0]) : undefined);
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

/** Primeira vez no modo só transporte: uma origem, um destino e uma movimentação para começar (massa = consumo mensal). */
function seedTransport(premises: DetailedPremises, base?: Route): { nodes: FlowNode[]; routes: Route[] } {
  const nodes: FlowNode[] = [
    { id: 'orig-1', name: 'Origem 1', type: 'frente', group: 'origem' },
    { id: 'dest-1', name: 'Destino 1', type: 'expedicao', group: 'destino' },
  ];
  const r: Route = {
    ...(base ?? {}),
    id: `mov-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Origem 1 → Destino 1',
    kind: 'rom',
    materialName: 'Minério',
    fromId: 'orig-1',
    toId: 'dest-1',
    active: true,
    truckCount: 0,
    truckCapacity: premises.truckCapacity,
    distance: Math.round(base?.distance ?? 1000),
    cycleTime: 20,
    mechanicalAvailability: premises.dfMina,
    operationalEfficiency: 100,
    processType: premises.processType,
    fleetMode: 'inteiro',
    targetMass: Math.round(premises.targetMonthlyROM || 100000),
    share: undefined,
    mix: undefined,
    loader: undefined,
  };
  return { nodes, routes: [r] };
}
