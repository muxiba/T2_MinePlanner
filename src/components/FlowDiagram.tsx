import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Trash2, X } from 'lucide-react';
import type { DetailedPremises, FlowNode, NodeType, Route, RouteKind } from '@/types';
import { MATERIAL_LABELS, NODE_LABELS, materialsFrom, networkBalance, transportMode } from '@/engine/network';
import { switchFlowMode, setWasteOn, type FlowMode } from '@/engine/flowMode';
import TransportTable from './TransportTable';
import StopsEditor from './StopsEditor';
import { entryClassId, nodeLoaderEntries, routeKind, withFirstEntry } from '@/engine/fleet';
import { LoaderSelect } from './LoaderSetupEditor';
import { processPct } from '@/engine/process';

/**
 * Desenho da rede de fluxos (Premissas → Locais e movimentações).
 * Blocos fixos na ordem do processo — Mina (ROM), Planta(s), Produto(s), Rejeito e Estéril (opcional) —
 * com os locais de cada um dentro; setas ligam um local ao outro e mostram a massa do balanço.
 * É a mesma rede da tabela: locais = premises.nodes, setas = rotas com fromId/toId.
 */

export type Group = 'mina' | 'planta' | 'produto' | 'rejeito' | 'esteril' | 'origem' | 'passagem' | 'destino';
const T_GROUPS: Group[] = ['origem', 'passagem', 'destino'];

const GROUP_LABEL: Record<Group, string> = { mina: 'Mina (ROM)', planta: 'Planta(s)', produto: 'Produto(s)', rejeito: 'Rejeito', esteril: 'Estéril', origem: 'Origens', passagem: 'Pontos de passagem', destino: 'Destinos' };
/** material que entra em cada bloco */
const GROUP_MAT: Record<Group, RouteKind> = { mina: 'rom', planta: 'rom', produto: 'product', rejeito: 'tailings', esteril: 'waste', origem: 'rom', passagem: 'rom', destino: 'rom' };
const MAT_COLOR: Record<RouteKind, string> = { rom: '#185FA5', product: '#3B6D11', tailings: '#A32D2D', waste: '#6B6A64' };
/** o que dá para criar em cada bloco */
const ADD: Record<Group, { type: NodeType; label: string; name: string }[]> = {
  mina: [
    { type: 'frente', label: 'frente', name: 'Frente' },
    { type: 'estoque', label: 'pilha / estoque', name: 'Pilha de ROM' },
  ],
  planta: [{ type: 'planta', label: 'planta', name: 'Planta' }],
  produto: [
    { type: 'estoque', label: 'estoque / pátio', name: 'Pátio de produto' },
    { type: 'expedicao', label: 'terminal', name: 'Terminal' },
  ],
  rejeito: [{ type: 'rejeito', label: 'baia / pilha', name: 'Baia' }],
  esteril: [{ type: 'esteril', label: 'pilha', name: 'PDE' }],
  origem: [{ type: 'frente', label: 'origem', name: 'Origem' }],
  passagem: [{ type: 'estoque', label: 'ponto de passagem', name: 'Pátio' }],
  destino: [{ type: 'expedicao', label: 'destino', name: 'Destino' }],
};

/** Bloco de cada local: pelo tipo; estoque pelo grupo gravado ou pelo material que chega/sai dele. */
export function groupOf(n: FlowNode, routes: Route[]): Group {
  if (n.group && T_GROUPS.includes(n.group)) return n.group;
  switch (n.type) {
    case 'frente':
      return 'mina';
    case 'planta':
      return 'planta';
    case 'expedicao':
      return 'produto';
    case 'rejeito':
      return 'rejeito';
    case 'esteril':
      return 'esteril';
  }
  if (n.group) return n.group;
  const r = routes.find((x) => x.toId === n.id) ?? routes.find((x) => x.fromId === n.id);
  const k = r ? routeKind(r) : 'product';
  return k === 'rom' ? 'mina' : k === 'tailings' ? 'rejeito' : k === 'waste' ? 'esteril' : 'produto';
}

/** Material que um local manda para outro (null = ligação que não faz sentido). */
export function linkMaterial(from: FlowNode, to: FlowNode, routes: Route[]): RouteKind | null {
  if (from.id === to.id) return null;
  const gf = groupOf(from, routes);
  const gt = groupOf(to, routes);
  // só transporte: origem → passagem/destino; passagem → passagem/destino
  if (T_GROUPS.includes(gf) || T_GROUPS.includes(gt)) return (gf === 'origem' || gf === 'passagem') && (gt === 'passagem' || gt === 'destino') ? 'rom' : null;
  const m = GROUP_MAT[gt];
  // pilha / estoque da mina também manda estéril para a PDE
  const emits = from.type === 'estoque' ? (gf === 'mina' ? (['rom', 'waste'] as RouteKind[]) : [GROUP_MAT[gf]]) : materialsFrom(from.type);
  return emits.includes(m) ? m : null;
}

const matTxt = (k: RouteKind) => (k === 'rom' ? 'ROM' : MATERIAL_LABELS[k].toLowerCase());
const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
const cut = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cell = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm';
const num = `${cell} text-right font-mono`;

type PtrEv = { clientX: number; clientY: number; pointerId: number; target: EventTarget | null; stopPropagation(): void };

const W = 230;
const IH = 40;
const GAP = 8;
const HEAD = 38;
const FOOT = 30;
const COL = { mina: 20, planta: 390, right: 760 };

interface Props {
  premises: DetailedPremises;
  setPremises: (fn: (prev: DetailedPremises) => DetailedPremises) => void;
  routes: Route[];
  setRoutes: (fn: (prev: Route[]) => Route[]) => void;
}

type Sel = { kind: 'node'; id: string } | { kind: 'route'; id: string } | null;


export interface FlowLayout {
  by: Record<Group, FlowNode[]>;
  box: Partial<Record<Group, { x: number; y: number; w: number; h: number }>>;
  pos: Map<string, { x: number; y: number; w: number; h: number; g: Group }>;
  H: number;
  edges: { r: Route; d: string; lx: number; ly: number; k: RouteKind; bad: boolean; mass: number; stops: { x: number; y: number; name: string; kind: string }[] }[];
}

/** Posição dos blocos, dos locais e das setas (usada no desenho da tela e no do PDF). */
export function flowLayout(nodes: FlowNode[], routes: Route[], res: ReturnType<typeof networkBalance>, showWaste: boolean, showTail: boolean, transport = false): FlowLayout {
    const by: Record<Group, FlowNode[]> = { mina: [], planta: [], produto: [], rejeito: [], esteril: [], origem: [], passagem: [], destino: [] };
    for (const n of nodes) by[groupOf(n, routes)].push(n);
    // dentro do bloco: frentes antes das pilhas; estoques antes do terminal (ordem do fluxo)
    const order: Partial<Record<NodeType, number>> = { frente: 0, estoque: 1, planta: 0, expedicao: 2, rejeito: 1, esteril: 0 };
    for (const g of Object.keys(by) as Group[]) by[g].sort((a, b) => (order[a.type] ?? 1) - (order[b.type] ?? 1));
    const h = (g: Group) => HEAD + Math.max(1, by[g].length) * (IH + GAP) + FOOT;
    const box: Partial<Record<Group, { x: number; y: number; w: number; h: number }>> = {};
    const top = 20;
    let yMina = top;
    if (transport) {
      box.origem = { x: COL.mina, y: top, w: W + 20, h: h('origem') };
      box.passagem = { x: COL.planta, y: top, w: W + 20, h: h('passagem') };
      box.destino = { x: COL.right, y: top, w: W + 20, h: h('destino') };
    } else {
    if (showWaste) {
      box.esteril = { x: 300, y: top, w: W + 20, h: h('esteril') };
      yMina = top + h('esteril') + 40;
    }
    box.mina = { x: COL.mina, y: yMina, w: W + 20, h: h('mina') };
    box.planta = { x: COL.planta, y: yMina + Math.max(0, (h('mina') - h('planta')) / 2), w: W + 20, h: h('planta') };
    box.produto = { x: COL.right, y: top, w: W + 20, h: h('produto') };
    if (showTail) box.rejeito = { x: COL.right, y: Math.max(top + h('produto') + 40, box.planta.y + box.planta.h / 2 + 10), w: W + 20, h: h('rejeito') };
    }
    const pos = new Map<string, { x: number; y: number; w: number; h: number; g: Group }>();
    for (const g of Object.keys(box) as Group[]) {
      const b = box[g]!;
      by[g].forEach((n, i) => pos.set(n.id, { x: b.x + 10, y: b.y + HEAD + i * (IH + GAP), w: W, h: IH, g }));
    }
    const H = Math.max(...Object.values(box).map((b) => b!.y + b!.h)) + 20;
    const layout = { by, box, pos, H };
  const edges = routes
    .filter((r) => r.fromId && r.toId && layout.pos.has(r.fromId) && layout.pos.has(r.toId))
    .map((r) => {
      const a = layout.pos.get(r.fromId!)!;
      const b = layout.pos.get(r.toId!)!;
      const y1 = a.y + a.h / 2;
      let P: number[];
      if (b.x > a.x + a.w / 2) {
        const x1 = a.x + a.w;
        const x2 = b.x - 2;
        const y2 = b.y + b.h / 2;
        const c = Math.max(40, (x2 - x1) / 2);
        P = [x1, y1, x1 + c, y1, x2 - c, y2, x2, y2];
      } else if (b.x + b.w < a.x) {
        const x2 = b.x + b.w + 2;
        const y2 = b.y + b.h / 2;
        P = [a.x, y1, a.x - 60, y1, x2 + 60, y2, x2, y2];
      } else {
        // mesmo bloco (ou mesma coluna): laço pela direita
        const x1 = a.x + a.w;
        const x2 = b.x + b.w + 3;
        const y2 = b.y + b.h / 2;
        const off = 40 + Math.min(30, Math.abs(y2 - y1) / 4);
        P = [x1, y1, x1 + off, y1, x2 + off, y2, x2, y2];
      }
      const d = `M${P[0]},${P[1]} C${P[2]},${P[3]} ${P[4]},${P[5]} ${P[6]},${P[7]}`;
      // rótulo a 60% do caminho (setas que saem do mesmo local não se sobrepõem)
      const bz = (t: number, i: number) => (1 - t) ** 3 * P[i] + 3 * (1 - t) ** 2 * t * P[i + 2] + 3 * (1 - t) * t ** 2 * P[i + 4] + t ** 3 * P[i + 6];
      const lt = b.x > a.x + a.w / 2 || b.x + b.w < a.x ? 0.6 : 0.5;
      const lx = bz(lt, 0);
      const ly = bz(lt, 1);
      const k = routeKind(r);
      const bad = res.issues.some((x) => x.routeId === r.id && x.level === 'erro');
      // paradas no trajeto: marcadores sobre a seta, pela distância da origem ÷ DMT
      const stops = (r.stops ?? []).map((st) => {
        const f = Math.min(0.97, Math.max(0.03, (st.distM || 0) / Math.max(1, r.distance || 1)));
        return { x: bz(f, 0), y: bz(f, 1), name: st.name, kind: st.kind };
      });
      return { r, d, lx, ly, k, bad, mass: r.active ? res.edges.get(r.id) ?? 0 : 0, stops };
    });

  // rótulos de massa não se sobrepõem: desce o que bater em outro já colocado
  const placed: { x: number; y: number }[] = [];
  const marks = edges.flatMap((e) => e.stops);
  for (const e of edges) {
    let tries = 0;
    while (tries++ < 8 && (placed.some((q) => Math.abs(q.x - e.lx) < 84 && Math.abs(q.y - e.ly) < 22) || marks.some((m) => Math.abs(m.x - e.lx) < 50 && Math.abs(m.y - e.ly) < 18))) e.ly += 22;
    placed.push({ x: e.lx, y: e.ly });
  }

  return { ...layout, edges };
}

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Desenho da rede como SVG estático (memorial em HTML e PDF). */
export function flowSvg(routes: Route[], premises: DetailedPremises): string {
  const nodes = premises.nodes ?? [];
  if (!nodes.length) return '';
  const res = networkBalance(routes, premises, routeKind);
  const pp = processPct(premises);
  const tmode = transportMode(premises);
  const showWaste = !tmode && !!premises.hasWasteRock;
  const showTail = !tmode && (!pp.seco || nodes.some((n) => n.type === 'rejeito'));
  const L = flowLayout(nodes, routes, res, showWaste, showTail, tmode);
  const frentes = nodes.filter((n) => n.type === 'frente');
  const shareSum = frentes.reduce((a, n) => a + (n.romShare ?? 1), 0) || 1;
  const sub = (n: FlowNode) => {
    if (tmode) {
      const b = res.nodes.find((x) => x.node.id === n.id);
      const i = b?.inT.rom ?? 0;
      const o = b?.outT.rom ?? 0;
      return o > 0.5 ? `envia ${t0(o)} t` : i > 0.5 ? `recebe ${t0(i)} t` : 'sem movimentação';
    }
    if (n.type === 'frente') return `${Math.round(((n.romShare ?? 1) / shareSum) * 100)}% do ROM`;
    if (n.type === 'planta') return pp.seco ? `RM ${pp.rm.toLocaleString('pt-BR')}% · a seco` : `RM ${pp.rm.toLocaleString('pt-BR')}% · rejeito ${pp.rej.toLocaleString('pt-BR')}%`;
    const b = res.nodes.find((x) => x.node.id === n.id);
    const inT = b ? Object.values(b.inT).reduce((a, v) => a + v, 0) : 0;
    return inT > 0.5 ? `recebe ${t0(inT)} t` : 'sem entrada';
  };
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1090 ${L.H}" width="1090" height="${L.H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="1090" height="${L.H}" fill="#FAFAF8"/>`);
  out.push('<defs>' + (Object.keys(MAT_COLOR) as RouteKind[]).map((k) => `<marker id="m-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${MAT_COLOR[k]}"/></marker>`).join('') + '</defs>');
  for (const g of Object.keys(L.box) as Group[]) {
    const b = L.box[g]!;
    out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h - FOOT + 6}" rx="10" fill="#E7EEF2" stroke="#15567F" stroke-opacity="0.55"/>`);
    out.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="30" rx="10" fill="#15567F"/><rect x="${b.x}" y="${b.y + 20}" width="${b.w}" height="10" fill="#15567F"/>`);
    out.push(`<text x="${b.x + b.w / 2}" y="${b.y + 20}" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="bold">${esc(GROUP_LABEL[g].toUpperCase())}</text>`);
  }
  for (const e of L.edges) {
    const c = MAT_COLOR[e.k];
    out.push(`<path d="${e.d}" fill="none" stroke="${c}" stroke-width="2" ${e.r.active ? '' : 'stroke-dasharray="6 5" opacity="0.5"'} marker-end="url(#m-${e.k})"/>`);
  }
  for (const n of nodes) {
    const p = L.pos.get(n.id);
    if (!p) continue;
    out.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="7" fill="#ffffff" stroke="#00000033"/>`);
    out.push(`<text x="${p.x + 10}" y="${p.y + 17}" font-size="13" font-weight="bold" fill="#151619">${esc(cut(n.name))}</text>`);
    out.push(`<text x="${p.x + 10}" y="${p.y + 32}" font-size="11" fill="#555555">${esc(cut(sub(n), 34))}</text>`);
  }
  for (const e of L.edges) for (const st of e.stops) out.push(`<rect x="${st.x - 6}" y="${st.y - 6}" width="12" height="12" transform="rotate(45 ${st.x} ${st.y})" fill="#ffffff" stroke="${MAT_COLOR[e.k]}" stroke-width="2"/><text x="${st.x}" y="${st.y - 11}" text-anchor="middle" font-size="10.5" fill="${MAT_COLOR[e.k]}">${esc(cut(st.name, 14))}</text>`);
  for (const e of L.edges) {
    const c = MAT_COLOR[e.k];
    out.push(`<rect x="${e.lx - 40}" y="${e.ly - 10}" width="80" height="20" rx="5" fill="#ffffff" stroke="${c}" stroke-opacity="0.6"/>`);
    out.push(`<text x="${e.lx}" y="${e.ly + 4}" text-anchor="middle" font-size="11.5" font-weight="bold" fill="${c}">${e.r.active ? `${t0(e.mass)} t` : 'inativa'}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

const FlowDiagram: React.FC<Props> = ({ premises, setPremises, routes, setRoutes }) => {
  const nodes = premises.nodes ?? [];
  const res = useMemo(() => networkBalance(routes, premises, routeKind), [routes, premises]);
  const pp = processPct(premises);
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number; moved: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const tm = transportMode(premises);
  const showWaste = !tm && !!premises.hasWasteRock;
  const showTail = !tm && (!pp.seco || nodes.some((n) => n.type === 'rejeito'));
  const frentes = nodes.filter((n) => n.type === 'frente');
  const shareSum = frentes.reduce((a, n) => a + (n.romShare ?? 1), 0) || 1;
  const setMode = (m: FlowMode) => {
    const x = switchFlowMode(premises, routes, m);
    if (!x) return;
    setPremises(() => x.premises);
    setRoutes(() => x.routes);
    setSel(null);
    setLink(null);
  };
  const cleanup = () => {
    const unused = nodes.filter((n) => !routes.some((r) => r.fromId === n.id || r.toId === n.id));
    if (!unused.length || !confirm(`Apagar ${unused.length} local(is) sem movimentação: ${unused.map((n) => n.name).join(', ')}?`)) return;
    const ids = new Set(unused.map((n) => n.id));
    setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).filter((n) => !ids.has(n.id)) }));
    setSel(null);
  };
  const setWaste = (on: boolean) => {
    const x = setWasteOn(premises, routes, on);
    setPremises((p) => ({ ...p, hasWasteRock: x.premises.hasWasteRock }));
    setRoutes(() => x.routes);
  };

  /* ------------------------------ layout ------------------------------ */
  const layout = useMemo(() => flowLayout(nodes, routes, res, showWaste, showTail, tm), [nodes, routes, res, showWaste, showTail, tm]);
  const edges = layout.edges;

  /* ------------------------------ ações ------------------------------ */
  const setNode = (id: string, patch: Partial<FlowNode>) => setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const setRoute = (id: string, patch: Partial<Route>) => setRoutes((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addNode = (g: Group, type: NodeType, name: string) => {
    const id = newId(type);
    const count = nodes.filter((n) => n.type === type && groupOf(n, routes) === g).length + 1;
    setPremises((p) => ({ ...p, nodes: [...(p.nodes ?? []), { id, name: `${name} ${count}`, type, ...(type === 'estoque' || T_GROUPS.includes(g) ? { group: g } : {}) }] }));
    setSel({ kind: 'node', id });
  };
  const removeNode = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    const linked = routes.filter((r) => r.fromId === id || r.toId === id);
    if (!confirm(`Apagar “${n?.name}”${linked.length ? ` e ${linked.length} movimentaç${linked.length > 1 ? 'ões' : 'ão'} ligada${linked.length > 1 ? 's' : ''} a ele` : ''}?`)) return;
    if (linked.length) setRoutes((rs) => rs.filter((r) => r.fromId !== id && r.toId !== id));
    setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).filter((x) => x.id !== id) }));
    setSel(null);
  };
  const removeRoute = (r: Route) => {
    if (!confirm(`Apagar a movimentação “${r.name}”? Os caminhões dela voltam para a folga.`)) return;
    setRoutes((rs) => rs.filter((x) => x.id !== r.id));
    setSel(null);
  };
  const connect = (fromId: string, toId: string) => {
    const f = nodes.find((n) => n.id === fromId);
    const t = nodes.find((n) => n.id === toId);
    if (!f || !t) return;
    const m = linkMaterial(f, t, routes);
    if (!m) {
      if (tm) {
        setMsg(`Ligação não permitida: no modo só transporte a movimentação sai de uma origem ou de um ponto de passagem e chega a um ponto de passagem ou a um destino.`);
        return;
      }
      setMsg(`${f.name} não manda material para ${t.name}: ${t.name} recebe ${matTxt(GROUP_MAT[groupOf(t, routes)])}, e ${f.name} só envia ${(f.type === 'estoque' ? [GROUP_MAT[groupOf(f, routes)]] : materialsFrom(f.type)).map(matTxt).join(' ou ')}.`);
      return;
    }
    const same = routes.find((r) => r.fromId === fromId && r.toId === toId && routeKind(r) === m);
    if (same) {
      setSel({ kind: 'route', id: same.id });
      if (!same.active) setRoute(same.id, { active: true });
      return;
    }
    const id = newId('mov');
    setRoutes((rs) => [
      ...rs,
      { id, name: `${f.name} → ${t.name}`, kind: m, fromId, toId, active: true, ...(tm ? { materialName: 'Minério', targetMass: undefined } : {}), truckCount: 0, truckCapacity: premises.truckCapacity, distance: 1000, cycleTime: 20, mechanicalAvailability: premises.dfMina, operationalEfficiency: 100, processType: premises.processType, fleetMode: 'inteiro' },
    ]);
    setSel({ kind: 'route', id });
    setMsg(null);
  };

  /* ------------------------------ ligar arrastando ou clicando ------------------------------ */
  const toSvg = (e: PtrEv) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(m.inverse());
    return { x: q.x, y: q.y };
  };
  const nodeAt = (e: PtrEv) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-node]');
    return el?.getAttribute('data-node') ?? null;
  };
  const startLink = (e: PtrEv, id: string) => {
    e.stopPropagation();
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    const p = toSvg(e);
    setLink({ from: id, x: p.x, y: p.y, moved: false });
    setMsg(null);
  };
  const onMove = (e: PtrEv) => {
    if (!link) return;
    const p = toSvg(e);
    setLink((l) => (l ? { ...l, x: p.x, y: p.y, moved: l.moved || Math.hypot(p.x - l.x, p.y - l.y) > 6 } : l));
  };
  const onUp = (e: PtrEv) => {
    if (!link || !link.moved) return; // clique simples: fica no modo ligar até clicar no destino
    const t = nodeAt(e);
    if (t && t !== link.from) connect(link.from, t);
    setLink(null);
  };
  const clickNode = (id: string) => {
    if (link) {
      if (id !== link.from) connect(link.from, id);
      setLink(null);
      return;
    }
    setSel({ kind: 'node', id });
  };

  const issuesOf = (id: string) => res.issues.filter((x) => x.nodeId === id);
  const balOf = (id: string) => res.nodes.find((b) => b.node.id === id);
  const subLabel = (n: FlowNode) => {
    if (tm) {
      const b = balOf(n.id);
      const i = b?.inT.rom ?? 0;
      const o = b?.outT.rom ?? 0;
      return i > 0.5 && o > 0.5 ? `recebe ${t0(i)} · envia ${t0(o)} t` : o > 0.5 ? `envia ${t0(o)} t` : i > 0.5 ? `recebe ${t0(i)} t` : 'sem movimentação';
    }
    if (n.type === 'frente') return `${Math.round(((n.romShare ?? 1) / shareSum) * 100)}% do ROM · ${t0(((premises.targetMonthlyROM || 0) * (n.romShare ?? 1)) / shareSum)} t`;
    if (n.type === 'planta') return pp.seco ? `RM ${pp.rm.toLocaleString('pt-BR')}% · a seco` : `RM ${pp.rm.toLocaleString('pt-BR')}% · rejeito ${pp.rej.toLocaleString('pt-BR')}%`;
    const b = balOf(n.id);
    const inT = b ? Object.values(b.inT).reduce((s, v) => s + v, 0) : 0;
    const sc = n.stockChangeT ? ` · estoque ${n.stockChangeT > 0 ? '+' : ''}${t0(n.stockChangeT)}` : '';
    return inT > 0.5 ? `recebe ${t0(inT)} t${sc}` : 'sem entrada';
  };

  const selNode = sel?.kind === 'node' ? nodes.find((n) => n.id === sel.id) : undefined;
  const selRoute = sel?.kind === 'route' ? routes.find((r) => r.id === sel.id) : undefined;
  const linkFrom = link ? nodes.find((n) => n.id === link.from) : undefined;
  const total = edges.reduce((s, e) => s + e.mass, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-black/10 p-0.5 text-sm" role="radiogroup" aria-label="Modo da rede">
          {([['processo', 'Processo (mina → planta → produto/rejeito)'], ['transporte', 'Só transporte (origem → destino)']] as const).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={(premises.flowMode ?? 'processo') === m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1 font-medium ${(premises.flowMode ?? 'processo') === m ? 'bg-[#15567F] text-white' : 'text-black/60 hover:bg-black/5'}`}>
              {label}
            </button>
          ))}
        </div>
        {nodes.some((n) => !routes.some((r) => r.fromId === n.id || r.toId === n.id)) && (
          <button type="button" onClick={cleanup} className="rounded-lg border border-black/10 px-3 py-1 text-sm text-black/65 hover:bg-black/5" title="Apaga do desenho os locais que não têm nenhuma movimentação">
            Remover locais sem movimentação
          </button>
        )}
        {!tm && (
          <label className="flex items-center gap-2 text-sm text-black/70">
            <input type="checkbox" checked={!!premises.hasWasteRock} onChange={(e) => setWaste(e.target.checked)} />
            Possui estéril
          </label>
        )}
        {showWaste && (
          <label className="flex items-center gap-2 text-sm text-black/70">
            Meta de estéril
            <input type="number" step={1000} min={0} className="w-28 rounded-lg border border-black/10 bg-white px-2 py-1 text-right font-mono text-sm" value={premises.targetMonthlyWasteRock || ''} aria-label="Meta de estéril" onChange={(e) => setPremises((p) => ({ ...p, targetMonthlyWasteRock: Math.max(0, Number(e.target.value) || 0) }))} />
            <span className="text-xs text-black/45">t seca/mês</span>
          </label>
        )}
      </div>
      <p className="max-w-4xl text-xs text-black/55">
        {tm ? (
          <>Só transporte: crie origens, pontos de passagem (opcional) e destinos e ligue um ao outro puxando a bolinha à direita do local. Cada movimentação leva a massa que você informar (t seca/mês; a umidade converte para úmida). Consumo da planta, RM, rejeito e as demais variáveis do processo não são usados neste modo. A rede do modo Processo fica guardada.</>
        ) : (
          <>
            Crie os locais dentro de cada bloco (“+”) e ligue um ao outro puxando a bolinha à direita do local até o destino — ou clique nela e depois no destino. As massas saem do balanço: produto = ROM × {pp.rm.toLocaleString('pt-BR')}%
            {pp.seco ? '' : `, rejeito = ROM × ${pp.rej.toLocaleString('pt-BR')}%`}; estoques mandam adiante o que recebem (± variação). Clique num local ou numa seta para editar.
          </>
        )}
      </p>

      <div className="space-y-4">
        <div className="relative">
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 space-y-2">
      {linkFrom && (
        <p className="pointer-events-auto flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Ligando a partir de <b>{linkFrom.name}</b>: clique no destino (os possíveis estão destacados).
          <button type="button" className="rounded p-1 hover:bg-sky-100" aria-label="Cancelar ligação" onClick={() => setLink(null)}><X size={14} /></button>
        </p>
      )}
      {msg && (
        <p className="pointer-events-auto flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {msg}</span>
          <button type="button" className="rounded p-1 hover:bg-amber-100" aria-label="Fechar aviso" onClick={() => setMsg(null)}><X size={14} /></button>
        </p>
      )}

        </div>
        <div className="overflow-x-auto rounded-xl border border-black/[0.06] bg-[#FAFAF8]">
          <svg
            ref={svgRef}
            viewBox={`0 0 1090 ${layout.H}`}
            className="block w-full min-w-[760px] select-none"
            role="img"
            aria-label="Desenho da rede de fluxos"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onClick={(e) => {
              if (e.target === svgRef.current) {
                setSel(null);
                setLink(null);
              }
            }}
          >
            <defs>
              {(Object.keys(MAT_COLOR) as RouteKind[]).map((k) => (
                <marker key={k} id={`ar-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill={MAT_COLOR[k]} />
                </marker>
              ))}
            </defs>

            {/* blocos */}
            {(Object.keys(layout.box) as Group[]).map((g) => {
              const b = layout.box[g]!;
              const optional = g === 'esteril' && !premises.hasWasteRock;
              return (
                <g key={g}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill="#15567F" fillOpacity={optional ? 0.04 : 0.08} stroke="#15567F" strokeOpacity={0.55} strokeDasharray={optional ? '5 4' : undefined} />
                  <rect x={b.x} y={b.y} width={b.w} height={30} rx={10} fill="#15567F" fillOpacity={optional ? 0.4 : 1} />
                  <rect x={b.x} y={b.y + 20} width={b.w} height={10} fill="#15567F" fillOpacity={optional ? 0.4 : 1} />
                  <text x={b.x + b.w / 2} y={b.y + 20} textAnchor="middle" fill="#fff" fontSize={14} fontWeight={600}>{GROUP_LABEL[g].toUpperCase()}</text>
                  {!layout.by[g].length && <text x={b.x + b.w / 2} y={b.y + HEAD + 24} textAnchor="middle" fill="#00000066" fontSize={12}>nenhum local</text>}
                  {ADD[g].map((a, i) => {
                    const n = ADD[g].length;
                    const bw = (b.w - 20 - (n - 1) * 6) / n;
                    const x = b.x + 10 + i * (bw + 6);
                    return (
                      <g key={a.type + a.label} role="button" tabIndex={0} aria-label={`Adicionar ${a.label} em ${GROUP_LABEL[g]}`} className="cursor-pointer" onClick={() => addNode(g, a.type, a.name)} onKeyDown={(e) => e.key === 'Enter' && addNode(g, a.type, a.name)}>
                        <rect x={x} y={b.y + b.h - FOOT + 2} width={bw} height={22} rx={6} fill="#fff" stroke="#15567F" strokeOpacity={0.35} strokeDasharray="3 3" />
                        <text x={x + bw / 2} y={b.y + b.h - FOOT + 17} textAnchor="middle" fill="#15567F" fontSize={11.5}>+ {a.label}</text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* setas */}
            {edges.map((e) => {
              const on = sel?.kind === 'route' && sel.id === e.r.id;
              const color = e.bad ? '#DC2626' : MAT_COLOR[e.k];
              return (
                <g key={e.r.id} className="cursor-pointer" onClick={(ev) => { ev.stopPropagation(); setSel({ kind: 'route', id: e.r.id }); }}>
                  <path d={e.d} fill="none" stroke="transparent" strokeWidth={14} />
                  <path d={e.d} fill="none" stroke={color} strokeWidth={on ? 3.2 : 2} strokeDasharray={e.r.active ? undefined : '6 5'} markerEnd={`url(#ar-${e.k})`} opacity={e.r.active ? 1 : 0.5} />
                  <g transform={`translate(${e.lx},${e.ly})`}>
                    <rect x={-40} y={-10} width={80} height={20} rx={5} fill="#fff" stroke={color} strokeOpacity={on ? 1 : 0.45} />
                    <text y={4} textAnchor="middle" fontSize={11.5} fontWeight={600} fill={color}>{e.r.active ? `${t0(e.mass)} t` : 'inativa'}</text>
                  </g>
                  {e.stops.map((st, i) => (
                    <g key={i} transform={`translate(${st.x},${st.y})`}>
                      <title>{`${st.name} (${st.kind})`}</title>
                      <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill="#fff" stroke={color} strokeWidth={2} />
                      <text y={-11} textAnchor="middle" fontSize={10.5} fill={color}>{cut(st.name, 14)}</text>
                    </g>
                  ))}
                </g>
              );
            })}

            {/* locais */}
            {nodes.map((n) => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              const issues = issuesOf(n.id);
              const err = issues.some((x) => x.level === 'erro');
              const warn = !err && issues.length > 0;
              const on = sel?.kind === 'node' && sel.id === n.id;
              const src = link ? nodes.find((x) => x.id === link.from) : undefined;
              const can = src ? !!linkMaterial(src, n, routes) : false;
              const dim = !!src && !can && src.id !== n.id;
              const canSend = tm ? groupOf(n, routes) !== 'destino' : (n.type === 'estoque' ? [GROUP_MAT[groupOf(n, routes)]] : materialsFrom(n.type)).length > 0;
              return (
                <g key={n.id} data-node={n.id} opacity={dim ? 0.35 : 1}>
                  <g role="button" tabIndex={0} aria-label={`Local ${n.name}`} className="cursor-pointer" onClick={(e) => { e.stopPropagation(); clickNode(n.id); }} onKeyDown={(e) => e.key === 'Enter' && clickNode(n.id)}>
                    <rect x={p.x} y={p.y} width={p.w} height={p.h} rx={7} fill="#fff" stroke={err ? '#DC2626' : warn ? '#D97706' : can ? '#16A34A' : on ? '#15567F' : '#00000022'} strokeWidth={on || err || can ? 2 : 1} strokeDasharray={can ? '5 3' : undefined} />
                    <text x={p.x + 10} y={p.y + 17} fontSize={13} fontWeight={600} fill="#151619">{cut(n.name)}</text>
                    <text x={p.x + 10} y={p.y + 32} fontSize={11} fill="#00000088">{cut(subLabel(n), 34)}</text>
                    {(err || warn) && <text x={p.x + p.w - 22} y={p.y + 17} fontSize={13} fill={err ? '#DC2626' : '#D97706'}>!</text>}
                  </g>
                  {canSend && (
                    <circle
                      cx={p.x + p.w}
                      cy={p.y + p.h / 2}
                      r={7}
                      fill={link?.from === n.id ? '#15567F' : '#fff'}
                      stroke="#15567F"
                      strokeWidth={1.5}
                      className="cursor-crosshair"
                      role="button"
                      aria-label={`Ligar ${n.name} a outro local`}
                      onPointerDown={(e) => startLink(e, n.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                </g>
              );
            })}

            {/* ligação sendo puxada */}
            {link?.moved && layout.pos.get(link.from) && (() => {
              const a = layout.pos.get(link.from)!;
              return <line x1={a.x + a.w} y1={a.y + a.h / 2} x2={link.x} y2={link.y} stroke="#15567F" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />;
            })()}
          </svg>
        </div>
        </div>

        {/* painel: edição do selecionado + quadro de massas */}
        <div className="grid content-start gap-4 md:grid-cols-2">
          {selNode && (
            <div className="rounded-xl border border-black/[0.08] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-black/45">{NODE_LABELS[selNode.type]}</p>
                <button type="button" className="rounded p-1 text-black/40 hover:bg-black/5" aria-label="Fechar" onClick={() => setSel(null)}><X size={14} /></button>
              </div>
              <div className="space-y-3">
                <label className="block text-xs text-black/55">Nome<input className={`${cell} mt-1`} value={selNode.name} onChange={(e) => setNode(selNode.id, { name: e.target.value })} /></label>
                {!tm && selNode.type === 'frente' && (
                  <label className="block text-xs text-black/55">
                    Parte do ROM (peso)
                    <input type="number" step={1} className={`${num} mt-1`} value={selNode.romShare ?? 1} onChange={(e) => setNode(selNode.id, { romShare: Math.max(0, Number(e.target.value) || 0) })} />
                    <span className="mt-0.5 block text-[11px] text-black/45">{Math.round(((selNode.romShare ?? 1) / shareSum) * 100)}% da meta · 60 e 40 = 60% e 40%</span>
                  </label>
                )}
                {!tm && selNode.type === 'frente' && premises.hasWasteRock && (
                  <label className="block text-xs text-black/55">Estéril desta frente (t seca/mês)<input type="number" step={1000} className={`${num} mt-1`} value={selNode.wasteT ?? ''} placeholder="divide a meta" onChange={(e) => setNode(selNode.id, { wasteT: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></label>
                )}
                {['estoque', 'expedicao', 'rejeito', 'esteril'].includes(selNode.type) && routes.some((r) => r.fromId === selNode.id) && (
                  <label className="block text-xs text-black/55">
                    Variação de estoque (t/mês)
                    <input type="number" step={1000} className={`${num} mt-1`} value={selNode.stockChangeT ?? ''} placeholder="0 = sai o que entra" onChange={(e) => setNode(selNode.id, { stockChangeT: e.target.value === '' ? undefined : Number(e.target.value) })} />
                    <span className="mt-0.5 block text-[11px] text-black/45">+ forma estoque (sai menos), − consome estoque (sai mais)</span>
                  </label>
                )}
                {routes.some((r) => r.fromId === selNode.id) && (
                  <>
                    <label className="block text-xs text-black/55">
                      Carregamento dos caminhões
                      <LoaderSelect premises={premises} className={`${cell} mt-1`} value={nodeLoaderEntries(selNode)[0]?.classId} label="Carregamento dos caminhões" onChange={(v) => setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((x) => (x.id === selNode.id ? withFirstEntry(x, { classId: v }) : x)) }))} />
                      {nodeLoaderEntries(selNode).length > 1 && <span className="mt-0.5 block text-[11px] text-black/45">+{nodeLoaderEntries(selNode).length - 1} equipamento(s) neste local — veja em Carga e ciclo</span>}
                    </label>
                    {(entryClassId(nodeLoaderEntries(selNode)[0] ?? {}, premises) ?? 'silo') !== 'silo' && (
                      <label className="block text-xs text-black/55">Equipamentos disponíveis<input type="number" min={0} step={1} className={`${num} mt-1`} value={nodeLoaderEntries(selNode)[0]?.count ?? ''} placeholder="o sistema calcula" onChange={(e) => { const c = e.target.value === '' ? undefined : Math.max(0, Math.round(Number(e.target.value))); setPremises((p) => ({ ...p, nodes: (p.nodes ?? []).map((x) => (x.id === selNode.id ? withFirstEntry(x, { count: c }) : x)) })); }} /></label>
                    )}
                  </>
                )}
                {(() => {
                  const b = balOf(selNode.id);
                  if (!b) return null;
                  const sum = (r: Record<RouteKind, number>) => Object.values(r).reduce((s, v) => s + v, 0);
                  return (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-black/[0.03] px-3 py-2 text-xs">
                      {sum(b.genT) > 0.5 && <><dt className="text-black/50">Gerado</dt><dd className="text-right font-mono">{t0(sum(b.genT))} t</dd></>}
                      <dt className="text-black/50">Entra</dt><dd className="text-right font-mono">{t0(sum(b.inT))} t</dd>
                      <dt className="text-black/50">Sai</dt><dd className="text-right font-mono">{t0(sum(b.outT))} t</dd>
                      <dt className="text-black/50">Fica no local</dt><dd className="text-right font-mono">{t0(sum(b.keptT))} t</dd>
                    </dl>
                  );
                })()}
                {issuesOf(selNode.id).map((x, i) => (
                  <p key={i} className={`rounded-lg px-2.5 py-1.5 text-xs ${x.level === 'erro' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>{x.text}</p>
                ))}
                <button type="button" onClick={() => removeNode(selNode.id)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"><Trash2 size={13} /> Apagar local</button>
              </div>
            </div>
          )}

          {selRoute && (
            <div className="rounded-xl border border-black/[0.08] bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: MAT_COLOR[routeKind(selRoute)] }}>Movimentação · {tm ? selRoute.materialName || 'material' : MATERIAL_LABELS[routeKind(selRoute)]}</p>
                <button type="button" className="rounded p-1 text-black/40 hover:bg-black/5" aria-label="Fechar" onClick={() => setSel(null)}><X size={14} /></button>
              </div>
              <div className="space-y-3">
                <label className="block text-xs text-black/55">Nome<input className={`${cell} mt-1`} value={selRoute.name} onChange={(e) => setRoute(selRoute.id, { name: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-black/55">DMT (m)<input type="number" step={10} className={`${num} mt-1`} value={selRoute.distance} onChange={(e) => setRoute(selRoute.id, { distance: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  <label className="block text-xs text-black/55">
                    Via
                    <select className={`${cell} mt-1`} value={selRoute.roadType ?? 'interna'} onChange={(e) => setRoute(selRoute.id, { roadType: e.target.value as 'interna' | 'estrada' })}>
                      <option value="interna">Interna</option>
                      <option value="estrada">Estrada pública</option>
                    </select>
                  </label>
{tm ? (
                  <>
                    <label className="block text-xs text-black/55">Material<input className={`${cell} mt-1`} value={selRoute.materialName ?? ''} placeholder="minério, estéril, areia…" onChange={(e) => setRoute(selRoute.id, { materialName: e.target.value })} /></label>
                    <label className="block text-xs text-black/55">Massa do mês (t seca)<input type="number" step={1000} className={`${num} mt-1 ${!selRoute.targetMass ? 'border-red-300' : ''}`} value={selRoute.targetMass ?? ''} placeholder="obrigatória" onChange={(e) => setRoute(selRoute.id, { targetMass: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></label>
                  </>
                ) : (
                  <>
                  <label className="block text-xs text-black/55">Massa fixa (t seca)<input type="number" step={1000} className={`${num} mt-1`} value={selRoute.targetMass ?? ''} placeholder="pelo balanço" onChange={(e) => setRoute(selRoute.id, { targetMass: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} /></label>
                  <label className="block text-xs text-black/55">Peso na divisão<input type="number" step={0.5} min={0} className={`${num} mt-1`} value={selRoute.share ?? 1} disabled={!!selRoute.targetMass} onChange={(e) => setRoute(selRoute.id, { share: Math.max(0, Number(e.target.value) || 0) })} /></label>
                  </>
                )}
                </div>
                {!tm && <p className="text-[11px] text-black/45">Peso: movimentações do mesmo material saindo do mesmo local dividem a massa (1 e 1 = metade; 3 e 1 = 75% e 25%). Massa fixa: leva exatamente essa massa e o saldo vai para as outras.</p>}
                <p className="rounded-lg bg-black/[0.03] px-3 py-2 text-sm">Massa no mês: <b className="font-mono">{selRoute.active ? t0(res.edges.get(selRoute.id) ?? 0) : '—'} t seca</b></p>
                <div>
                  <p className="mb-1 text-xs text-black/55">Paradas no trajeto</p>
                  <StopsEditor route={selRoute} compact onChange={(stops) => setRoute(selRoute.id, { stops })} />
                </div>
                <label className="flex items-center gap-2 text-xs text-black/60"><input type="checkbox" checked={selRoute.active} onChange={(e) => setRoute(selRoute.id, { active: e.target.checked })} /> Ativa (consome frota)</label>
                <button type="button" onClick={() => removeRoute(selRoute)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"><Trash2 size={13} /> Apagar movimentação</button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-black/[0.08] bg-white p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-black/45">Resumo das movimentações</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-[11px] text-black/45">
                  <th className="py-1 font-medium">Origem → destino</th>
                  <th className="py-1 text-right font-medium">Massa (t)</th>
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr key={e.r.id} className={`cursor-pointer border-b border-black/5 hover:bg-black/[0.02] ${e.r.active ? '' : 'opacity-50'}`} onClick={() => setSel({ kind: 'route', id: e.r.id })}>
                    <td className="py-1 pr-2"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: MAT_COLOR[e.k] }} />{e.r.name}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{e.r.active ? t0(e.mass) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-1">Movimentação total</td>
                  <td className="py-1 text-right font-mono tabular-nums">{t0(total)}</td>
                </tr>
              </tfoot>
            </table>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-black/50">
              {(tm ? (['rom'] as RouteKind[]) : (Object.keys(MAT_COLOR) as RouteKind[])).filter((k) => k !== 'tailings' || showTail).filter((k) => k !== 'waste' || showWaste).map((k) => (
                <span key={k} className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: MAT_COLOR[k] }} /> {tm ? "Movimentação" : MATERIAL_LABELS[k]}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {tm && <TransportTable premises={premises} setPremises={setPremises} routes={routes} setRoutes={setRoutes} />}

      {res.issues.length ? (
        <ul className="space-y-1">
          {res.issues.map((x, i) => (
            <li key={i} className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-xs ${x.level === 'erro' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {x.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800"><CheckCircle2 size={13} /> O balanço fecha: todo o material tem destino e as massas batem com as premissas.</p>
      )}
    </div>
  );
};

export default FlowDiagram;
