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

/**
 * Transforma uma parada da movimentação em transbordo: o caminhão bascula ali e outro carrega até o destino.
 * Cria o local do transbordo (no bloco Mina / pontos de passagem) e divide a movimentação em duas pernas,
 * cada uma com o seu DMT e as suas paradas; a perna final mantém o id (circuitos e históricos continuam ligados).
 */
export function splitAtTransfer(premises: DetailedPremises, routes: Route[], routeId: string, stopId: string): { premises: DetailedPremises; routes: Route[] } | null {
  const r = routes.find((x) => x.id === routeId);
  const st = r?.stops?.find((x) => x.id === stopId);
  if (!r || !st) return null;
  const tm = premises.flowMode === 'transporte';
  const nodes = premises.nodes ?? [];
  const L = Math.max(0, r.distance || 0);
  const d = Math.min(L, Math.max(0, st.distM || 0));
  const node: FlowNode = {
    id: `tb-${Math.random().toString(36).slice(2, 8)}`,
    name: st.name || 'Transbordo',
    type: 'estoque',
    group: tm ? 'passagem' : routeKind(r) === 'rom' ? 'mina' : routeKind(r) === 'product' ? 'produto' : routeKind(r) === 'tailings' ? 'rejeito' : 'esteril',
    transfer: { discardPct: 0, process: st.name },
  };
  const fromName = nodes.find((n) => n.id === r.fromId)?.name ?? 'Origem';
  const toName = nodes.find((n) => n.id === r.toId)?.name ?? 'Destino';
  const others = (r.stops ?? []).filter((x) => x.id !== stopId);
  const legA: Route = {
    ...r,
    id: `mov-${Math.random().toString(36).slice(2, 8)}`,
    name: `${fromName} → ${node.name}`,
    toId: node.id,
    distance: Math.round(d),
    stops: others.filter((x) => (x.distM || 0) < d).length ? others.filter((x) => (x.distM || 0) < d) : undefined,
    targetMass: tm && r.targetMass ? r.targetMass : undefined,
    geo: undefined,
    mix: undefined,
    truckCount: 0,
  };
  const after = others.filter((x) => (x.distM || 0) >= d).map((x) => ({ ...x, distM: Math.round((x.distM || 0) - d) }));
  const legB: Route = {
    ...r,
    name: `${node.name} → ${toName}`,
    fromId: node.id,
    distance: Math.round(L - d),
    stops: after.length ? after : undefined,
    targetMass: tm ? undefined : r.targetMass,
    loadMin: undefined,
  };
  const i = routes.findIndex((x) => x.id === r.id);
  const next = [...routes];
  next.splice(i, 1, legA, legB);
  return { premises: { ...premises, nodes: [...nodes, node] }, routes: next };
}
