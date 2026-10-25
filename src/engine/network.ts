/**
 * Rede de fluxos: locais (frentes, plantas, estoques, expedição, baias/pilhas) e movimentações (rotas) entre eles.
 * O balanço de massa distribui o ROM das frentes, transforma na planta (produto = ROM × RM, rejeito = ROM × rejeito),
 * passa pelos estoques (entra = sai ± variação de estoque) e reparte cada saída entre as movimentações pela massa
 * digitada ou pelo peso. Cada perna de uma cadeia (planta → estoque → expedição) consome frota.
 */
import type { DetailedPremises, FlowNode, NodeType, Route, RouteKind } from '../types';
import { processPct } from './process';

export const NODE_LABELS: Record<NodeType, string> = {
  frente: 'Frente de lavra',
  planta: 'Planta',
  estoque: 'Estoque intermediário',
  expedicao: 'Expedição / terminal',
  rejeito: 'Baia / pilha de rejeito',
  esteril: 'Pilha de estéril',
};

export const MATERIAL_LABELS: Record<RouteKind, string> = { rom: 'ROM', product: 'Produto', tailings: 'Rejeito', waste: 'Estéril' };
const MATS: RouteKind[] = ['rom', 'product', 'tailings', 'waste'];

/** Materiais que podem sair de cada tipo de local (para a lista de movimentações). */
export function materialsFrom(type: NodeType): RouteKind[] {
  switch (type) {
    case 'frente':
      return ['rom', 'waste'];
    case 'planta':
      return ['product', 'tailings'];
    case 'estoque':
      return ['rom', 'product', 'tailings', 'waste'];
    case 'expedicao':
      return ['product'];
    case 'rejeito':
      return ['tailings'];
    case 'esteril':
      return ['waste'];
  }
}

export const networkOn = (p: Pick<DetailedPremises, 'nodes'>) => (p.nodes?.length ?? 0) > 0;

const DEFAULT_NODES: Record<RouteKind, [NodeType, NodeType, string, string]> = {
  rom: ['frente', 'planta', 'Frente de lavra', 'Planta'],
  product: ['planta', 'expedicao', 'Planta', 'Expedição'],
  tailings: ['planta', 'rejeito', 'Planta', 'Pilha de rejeito'],
  waste: ['frente', 'esteril', 'Frente de lavra', 'Pilha de estéril'],
};

const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Garante a rede: planos antigos ganham os locais padrão e as rotas sem origem/destino são ligadas a eles pelo fluxo.
 * Os números não mudam (uma rota por fluxo, mesma divisão por peso/massa). Retorna null se nada mudou.
 */
export function ensureNetwork(routes: Route[], premises: DetailedPremises, kindOf: (r: Route) => RouteKind): { nodes: FlowNode[]; routes: Route[] } | null {
  const nodes = [...(premises.nodes ?? [])];
  const valid = (id?: string) => !!id && nodes.some((n) => n.id === id);
  if (nodes.length && routes.every((r) => valid(r.fromId) && valid(r.toId))) return null;
  const byType = (t: NodeType, name: string) => {
    let n = nodes.find((x) => x.type === t);
    if (!n) {
      n = { id: newId(t), name, type: t };
      nodes.push(n);
    }
    return n.id;
  };
  const out = routes.map((r) => {
    if (valid(r.fromId) && valid(r.toId)) return r;
    const k = kindOf(r);
    const [ft, tt, fn, tn] = DEFAULT_NODES[k];
    return { ...r, kind: r.kind ?? k, fromId: valid(r.fromId) ? r.fromId : byType(ft, fn), toId: valid(r.toId) ? r.toId : byType(tt, tn) };
  });
  // a planta existe sempre que há ROM
  if (out.some((r) => kindOf(r) === 'rom')) byType('planta', 'Planta');
  return { nodes, routes: out };
}

export interface NodeBalance {
  node: FlowNode;
  /** entrada por material (t seca) */
  inT: Record<RouteKind, number>;
  /** gerado no local (frente: ROM e estéril; planta: produto e rejeito) */
  genT: Record<RouteKind, number>;
  /** saída pelas movimentações */
  outT: Record<RouteKind, number>;
  /** material disponível para sair (entrada ou geração − variação de estoque) */
  availT: Record<RouteKind, number>;
  /** fica no local (destino final ou estoque formado) */
  keptT: Record<RouteKind, number>;
}

export interface NetworkIssue {
  nodeId?: string;
  routeId?: string;
  level: 'erro' | 'aviso';
  text: string;
}

export interface NetworkResult {
  edges: Map<string, number>;
  nodes: NodeBalance[];
  issues: NetworkIssue[];
  /** ROM que entra nas plantas (t seca) */
  romToPlants: number;
}

const zero = (): Record<RouteKind, number> => ({ rom: 0, product: 0, tailings: 0, waste: 0 });
const isSource = (t: NodeType, m: RouteKind) => (t === 'frente' && (m === 'rom' || m === 'waste')) || (t === 'planta' && (m === 'product' || m === 'tailings'));
const isFinal = (t: NodeType, m: RouteKind) => (t === 'planta' && m === 'rom') || (t === 'expedicao' && m === 'product') || (t === 'rejeito' && m === 'tailings') || (t === 'esteril' && m === 'waste');

export function networkBalance(routes: Route[], premises: DetailedPremises, kindOf: (r: Route) => RouteKind): NetworkResult {
  const nodes = premises.nodes ?? [];
  const pp = processPct(premises);
  const active = routes.filter((r) => r.active && r.fromId && r.toId && nodes.some((n) => n.id === r.fromId) && nodes.some((n) => n.id === r.toId));
  const edges = new Map<string, number>();
  const issues: NetworkIssue[] = [];
  const outsOf = (id: string, m: RouteKind) => active.filter((r) => r.fromId === id && kindOf(r) === m);
  const insOf = (id: string, m: RouteKind) => active.filter((r) => r.toId === id && kindOf(r) === m);

  // ROM e estéril das frentes
  const frentes = nodes.filter((n) => n.type === 'frente');
  const romFrentes = frentes.filter((n) => outsOf(n.id, 'rom').length) .length ? frentes.filter((n) => outsOf(n.id, 'rom').length) : frentes;
  const wSum = romFrentes.reduce((a, n) => a + (n.romShare ?? 1), 0) || 1;
  const romTotal = premises.targetMonthlyROM || 0;
  const wasteTotal = premises.hasWasteRock ? premises.targetMonthlyWasteRock || 0 : 0;
  const wasteFrentes = frentes.filter((n) => outsOf(n.id, 'waste').length);
  const wasteFixed = wasteFrentes.reduce((a, n) => a + (n.wasteT ?? 0), 0);
  const wasteAuto = wasteFrentes.filter((n) => n.wasteT === undefined);
  const gen = new Map<string, Record<RouteKind, number>>();
  for (const n of nodes) gen.set(n.id, zero());
  for (const n of romFrentes) gen.get(n.id)!.rom = (romTotal * (n.romShare ?? 1)) / wSum;
  for (const n of wasteFrentes) gen.get(n.id)!.waste = n.wasteT ?? (wasteAuto.length ? Math.max(0, wasteTotal - wasteFixed) / wasteAuto.length : 0);

  const distribute = (list: Route[], total: number) => {
    const fixed = list.reduce((a, r) => a + (r.targetMass || 0), 0);
    const auto = list.filter((r) => !r.targetMass);
    const rest = Math.max(0, total - fixed);
    const w = (r: Route) => (r.share === undefined ? 1 : Math.max(0, r.share));
    const ws = auto.reduce((a, r) => a + w(r), 0);
    for (const r of list) edges.set(r.id, r.targetMass || (ws > 0 ? (rest * w(r)) / ws : 0));
    return { fixed, hasAuto: auto.length > 0 };
  };

  // relaxação: as massas das pernas a jusante dependem das de montante (cadeias de até ~20 pernas)
  const avail = new Map<string, Record<RouteKind, number>>();
  for (let iter = 0; iter < 25; iter++) {
    let changed = false;
    for (const n of nodes) {
      const g = gen.get(n.id)!;
      const inT = zero();
      for (const m of MATS) inT[m] = insOf(n.id, m).reduce((a, r) => a + (edges.get(r.id) ?? 0), 0);
      if (n.type === 'planta') {
        g.product = (inT.rom * pp.rm) / 100;
        g.tailings = (inT.rom * pp.rej) / 100;
      }
      const av = zero();
      // a variação de estoque vale para o material principal que passa pelo local
      const main = MATS.filter((m) => outsOf(n.id, m).length).sort((a, b) => inT[b] + g[b] - (inT[a] + g[a]))[0];
      for (const m of MATS) {
        const base = isSource(n.type, m) ? g[m] : n.type === 'planta' && m === 'rom' ? 0 : inT[m];
        av[m] = Math.max(0, base - (m === main ? n.stockChangeT ?? 0 : 0));
      }
      avail.set(n.id, av);
      for (const m of MATS) {
        const outs = outsOf(n.id, m);
        if (!outs.length) continue;
        const before = outs.map((r) => edges.get(r.id) ?? -1).join(',');
        distribute(outs, av[m]);
        if (outs.map((r) => edges.get(r.id) ?? -1).join(',') !== before) changed = true;
      }
    }
    if (!changed && iter > 0) break;
  }

  const balances: NodeBalance[] = nodes.map((n) => {
    const inT = zero();
    const outT = zero();
    const keptT = zero();
    for (const m of MATS) {
      inT[m] = insOf(n.id, m).reduce((a, r) => a + (edges.get(r.id) ?? 0), 0);
      outT[m] = outsOf(n.id, m).reduce((a, r) => a + (edges.get(r.id) ?? 0), 0);
    }
    const g = gen.get(n.id)!;
    const av = avail.get(n.id) ?? zero();
    for (const m of MATS) keptT[m] = (n.type === 'planta' && m === 'rom' ? inT.rom : isSource(n.type, m) ? g[m] : inT[m]) - outT[m];
    return { node: n, inT, genT: g, outT, availT: av, keptT };
  });

  // conferência
  for (const b of balances) {
    const n = b.node;
    for (const m of MATS) {
      const outs = outsOf(n.id, m);
      const fixed = outs.reduce((a, r) => a + (r.targetMass || 0), 0);
      const flexible = outs.some((r) => !r.targetMass);
      const has = b.availT[m];
      if (outs.length && fixed > has + 1) issues.push({ nodeId: n.id, level: 'erro', text: `${n.name}: as massas digitadas de ${MATERIAL_LABELS[m].toLowerCase()} somam ${fmt(fixed)} t, mas só há ${fmt(has)} t para sair.` });
      else if (outs.length && !flexible && fixed < has - 1 && !isFinal(n.type, m))
        issues.push({ nodeId: n.id, level: 'aviso', text: `${n.name}: faltam ${fmt(has - fixed)} t de ${MATERIAL_LABELS[m].toLowerCase()} — as massas digitadas somam menos que o disponível; deixe uma movimentação sem massa para receber o saldo.` });
      // material que deveria seguir e não tem para onde ir
      const stays = b.keptT[m] - (m === MATS.filter((x) => outsOf(n.id, x).length)[0] ? n.stockChangeT ?? 0 : 0);
      if (!outs.length && !isFinal(n.type, m) && stays > 1 && (isSource(n.type, m) || n.type === 'estoque'))
        issues.push({ nodeId: n.id, level: 'erro', text: `${n.name}: ${fmt(stays)} t de ${MATERIAL_LABELS[m].toLowerCase()} sem movimentação de saída.` });
    }
    if (n.type === 'estoque' && Math.abs(n.stockChangeT ?? 0) > 0.5) issues.push({ nodeId: n.id, level: 'aviso', text: `${n.name}: ${n.stockChangeT! > 0 ? 'forma' : 'consome'} ${fmt(Math.abs(n.stockChangeT!))} t de estoque no mês.` });
  }
  const romToPlants = balances.filter((b) => b.node.type === 'planta').reduce((a, b) => a + b.inT.rom, 0);
  if (romTotal > 0 && Math.abs(romToPlants - romTotal) > 1 + romTotal * 0.0005)
    issues.push({ level: 'aviso', text: `Entram ${fmt(romToPlants)} t de ROM nas plantas, contra ${fmt(romTotal)} t do consumo da planta nas premissas.` });
  const dangling = routes.filter((r) => r.active && (!r.fromId || !r.toId));
  for (const r of dangling) issues.push({ routeId: r.id, level: 'erro', text: `${r.name}: escolha a origem e o destino da movimentação.` });
  return { edges, nodes: balances, issues, romToPlants };
}

const fmt = (n: number) => Math.round(n).toLocaleString('pt-BR');
