/**
 * Leitura dos DXFs do plano de lavra (roda no Web Worker):
 *  - frentes por período: contornos da área lavrada (camada Boundary, ou polilinhas fechadas grandes)
 *    e cota média do pé da cava (camada Pit_Toe) dentro de cada área;
 *  - sólidos de rejeito: triangulação 3DFACE fechada → volume, contorno (envoltória) e cotas.
 */
import { parseDxfFile, parseDxfText, simplify, type DxfHandlers } from './dxf';
import { convexHull, interiorPoint, pointInRing, ringArea } from './plan';
import type { Vec3 } from './types';

/** Número do período no nome do arquivo: "01-Linha.dxf" → 1, "Ano5_Rejeito.dxf" → 5. */
export function periodFromName(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, '').replace(/^[0-9a-f]{8}-/i, '');
  const ano = base.match(/(?:ano|year|per[ií]odo|p)[\s_-]*(\d{1,3})/i);
  if (ano) return Number(ano[1]);
  const m = base.match(/\d{1,3}/);
  return m ? Number(m[0]) : null;
}

export interface ParsedFrontArea {
  ring: [number, number][];
  areaM2: number;
  z: number;
  zMin: number;
  zMax: number;
  lx: number;
  ly: number;
  layer: string;
}

const MIN_AREA = 3000; // m²

async function read(src: Blob | string, h: DxfHandlers, onProgress?: (f: number) => void) {
  if (typeof src === 'string') parseDxfText(src, h);
  else await parseDxfFile(src, h, onProgress);
}

export interface LayerInfo {
  layer: string;
  polylines: number;
  closed: number;
  points: number;
  faces: number;
}

/** Resumo das camadas de um DXF (para o usuário escolher qual é contorno, piso ou sólido). */
export async function scanLayers(src: Blob | string, onProgress?: (f: number) => void): Promise<LayerInfo[]> {
  const m = new Map<string, LayerInfo>();
  const get = (l: string) => {
    let v = m.get(l);
    if (!v) m.set(l, (v = { layer: l, polylines: 0, closed: 0, points: 0, faces: 0 }));
    return v;
  };
  await read(
    src,
    {
      polyline: (pts, layer, closed) => {
        const v = get(layer);
        v.polylines++;
        if (closed || Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 2) v.closed++;
      },
      point: (_p, layer) => get(layer).points++,
      face: (_a, _b, _c, _d, layer) => get(layer).faces++,
    },
    onProgress,
  );
  return [...m.values()].sort((a, b) => a.layer.localeCompare(b.layer, 'pt-BR', { numeric: true }));
}

export interface FrontParseOptions {
  /** camadas do contorno da área (vazio/indefinido = automático: Boundary/Limite/Contorno ou polilinhas fechadas) */
  areaLayers?: string[];
  /** camadas com a cota do piso (indefinido = automático: camadas com "toe"/"pé"; [] = usar a cota do próprio contorno) */
  floorLayers?: string[];
}

export async function parseFrontsDxf(src: Blob | string, onProgress?: (f: number) => void, opts: FrontParseOptions = {}): Promise<ParsedFrontArea[]> {
  const polys: { pts: Vec3[]; layer: string; closed: boolean }[] = [];
  const pointsIn: { p: Vec3; layer: string }[] = [];
  const toe: Vec3[] = [];
  const chosen = opts.areaLayers && opts.areaLayers.length ? new Set(opts.areaLayers) : null;
  const floorSet = opts.floorLayers ? new Set(opts.floorLayers) : null;
  const isFloor = (layer: string) => (floorSet ? floorSet.has(layer) : /toe|p[eé]_?da_?cava|piso|floor/i.test(layer));
  await read(
    src,
    {
      polyline: (pts, layer, closed) => {
        if (isFloor(layer)) for (const p of simplify(pts, 2)) toe.push(p);
        if (chosen ? !chosen.has(layer) : isFloor(layer) || /crest|ramp|contour|curva/i.test(layer)) return;
        polys.push({ pts, layer, closed });
      },
      point: (p, layer) => {
        if (isFloor(layer)) toe.push(p);
        if (chosen?.has(layer)) pointsIn.push({ p, layer });
      },
    },
    onProgress,
  );
  const gap = (pts: Vec3[]) => Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
  const isClosed = (p: { pts: Vec3[]; closed: boolean }) => p.closed || gap(p.pts) < 2;
  const asRing = (pts: Vec3[]) => simplify(pts, 1.5).map((p) => [p.x, p.y] as [number, number]);
  // camada escolhida ou camada de contorno: trechos abertos são unidos e fechados
  let cands = chosen ? polys : polys.filter((p) => /boundary|limite|contorno/i.test(p.layer) && p.pts.length >= 2);
  const lenient = chosen !== null || cands.length > 0;
  if (lenient) cands = chain(cands);
  else cands = polys.filter((p) => p.pts.length >= 3 && isClosed(p));
  const zOf = (ring: [number, number][] | null, own: Vec3[]) => {
    const inside = ring ? toe.filter((p) => pointInRing(p.x, p.y, ring)) : [];
    const src = inside.length >= 5 ? inside : own;
    const zs = src.map((p) => p.z).filter((z) => Number.isFinite(z) && z !== 0);
    return zs.length ? { z: zs.reduce((a, b) => a + b, 0) / zs.length, zMin: Math.min(...zs), zMax: Math.max(...zs) } : { z: 0, zMin: 0, zMax: 0 };
  };
  const out: ParsedFrontArea[] = [];
  const small: Vec3[][] = [];
  for (const c of cands) {
    if (!isClosed(c) && !lenient) continue;
    const ring = c.pts.length >= 3 ? asRing(c.pts) : [];
    const areaM2 = ring.length >= 3 ? ringArea(ring) : 0;
    if (areaM2 < MIN_AREA) {
      if (chosen) small.push(c.pts);
      continue;
    }
    if (out.some((o) => Math.abs(o.areaM2 - areaM2) < 1 && Math.hypot(o.ring[0][0] - ring[0][0], o.ring[0][1] - ring[0][1]) < 1)) continue;
    const [lx, ly] = interiorPoint(ring);
    out.push({ ring: ring.length > 600 ? simplifyRing(ring, 600) : ring, areaM2, ...zOf(ring, c.pts), lx, ly, layer: c.layer });
  }
  // sem áreas na camada escolhida: pontos (ou linhas curtas) viram pontos de carga
  if (!out.length && chosen) {
    const pts: { p: Vec3; layer: string }[] = [...pointsIn, ...small.map((l) => ({ p: centroid(l), layer: '' }))];
    for (const { p, layer } of pts) {
      const r = 15;
      const ring: [number, number][] = [[p.x - r, p.y - r], [p.x + r, p.y - r], [p.x + r, p.y + r], [p.x - r, p.y + r]];
      out.push({ ring, areaM2: 1, ...zOf(null, [p]), lx: p.x, ly: p.y, layer });
    }
  }
  return out.sort((a, b) => b.areaM2 - a.areaM2);
}

function centroid(pts: Vec3[]): Vec3 {
  const n = pts.length || 1;
  return { x: pts.reduce((a, p) => a + p.x, 0) / n, y: pts.reduce((a, p) => a + p.y, 0) / n, z: pts.reduce((a, p) => a + p.z, 0) / n };
}

/** Une trechos abertos da mesma camada cujas pontas se tocam (≤ 3 m). */
function chain(list: { pts: Vec3[]; layer: string; closed: boolean }[]) {
  const open = list.filter((p) => !p.closed).map((p) => ({ ...p, pts: [...p.pts] }));
  const out = list.filter((p) => p.closed);
  const d = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y);
  while (open.length) {
    const cur = open.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        if (o.layer !== cur.layer) continue;
        const a = cur.pts[0], b = cur.pts[cur.pts.length - 1], c = o.pts[0], e = o.pts[o.pts.length - 1];
        if (d(b, c) < 3) cur.pts.push(...o.pts);
        else if (d(b, e) < 3) cur.pts.push(...[...o.pts].reverse());
        else if (d(a, e) < 3) cur.pts.unshift(...o.pts);
        else if (d(a, c) < 3) cur.pts.unshift(...[...o.pts].reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

function simplifyRing(ring: [number, number][], max: number) {
  let tol = 2;
  let r = ring;
  while (r.length > max && tol < 64) {
    r = simplify(ring.map(([x, y]) => ({ x, y, z: 0 })), tol).map((p) => [p.x, p.y] as [number, number]);
    tol *= 2;
  }
  return r;
}

export interface ParsedSolid {
  volumeM3: number;
  hull: [number, number][];
  cx: number;
  cy: number;
  zMin: number;
  zMax: number;
  faces: number;
  /** fração de arestas sem par (0 = sólido fechado) */
  openEdges: number;
  /** volume pela superfície fechada (divergência) */
  volumeClosedM3: number;
  /** volume pela diferença entre topo e base em grade (vale também para sólidos com falhas) */
  volumeGridM3: number;
}

export async function parseSolidDxf(src: Blob | string, onProgress?: (f: number) => void, layers?: string[]): Promise<ParsedSolid | null> {
  const only = layers && layers.length ? new Set(layers) : null;
  let ox = NaN;
  let oy = NaN;
  let vol = 0;
  let faces = 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  const sample: [number, number][] = [];
  const edges = new Map<string, number>();
  const vk = (p: Vec3) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)},${Math.round(p.z * 100)}`;
  const addEdge = (a: Vec3, b: Vec3) => {
    const ka = vk(a);
    const kb = vk(b);
    if (ka === kb) return;
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  };
  const tri = (a: Vec3, b: Vec3, c: Vec3) => {
    if (Number.isNaN(ox)) {
      ox = a.x;
      oy = a.y;
    }
    const ax = a.x - ox, ay = a.y - oy, bx = b.x - ox, by = b.y - oy, cx = c.x - ox, cy = c.y - oy;
    vol += (ax * (by * c.z - b.z * cy) - ay * (bx * c.z - b.z * cx) + a.z * (bx * cy - by * cx)) / 6;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
    if (tris.length < 18_000_000) tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const tris: number[] = [];
  await read(
    src,
    {
      face: (a, b, c, d, layer) => {
        if (only && !only.has(layer)) return;
        faces++;
        for (const v of [a, b, c, d]) {
          if (v.z < zMin) zMin = v.z;
          if (v.z > zMax) zMax = v.z;
        }
        if (faces % 3 === 0 || faces < 3000) sample.push([a.x, a.y], [b.x, b.y], [c.x, c.y]);
        tri(a, b, c);
        if (d.x !== c.x || d.y !== c.y || d.z !== c.z) tri(a, c, d);
      },
    },
    onProgress,
  );
  if (!faces) return null;
  const hull = convexHull(sample);
  const [cx, cy] = interiorPoint(hull);
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  const openEdges = edges.size ? open / edges.size : 1;
  const volumeGridM3 = gridVolume(tris);
  const volumeClosedM3 = Math.abs(vol);
  // a grade vale para sólidos com falhas ou com mais de uma casca (normais invertidas se anulariam na divergência)
  return { volumeM3: volumeGridM3 > 0 ? volumeGridM3 : volumeClosedM3, volumeClosedM3, volumeGridM3, hull, cx, cy, zMin, zMax, faces, openEdges };
}

/** Volume em grade: em cada célula, maior cota − menor cota entre os triângulos que a cobrem. */
function gridVolume(t: number[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < t.length; i += 3) {
    minX = Math.min(minX, t[i]); maxX = Math.max(maxX, t[i]);
    minY = Math.min(minY, t[i + 1]); maxY = Math.max(maxY, t[i + 1]);
  }
  if (!Number.isFinite(minX)) return 0;
  const cell = Math.max(0.5, Math.sqrt(((maxX - minX) * (maxY - minY)) / 1_500_000));
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const ny = Math.ceil((maxY - minY) / cell) + 1;
  const lo = new Float32Array(nx * ny).fill(Infinity);
  const hi = new Float32Array(nx * ny).fill(-Infinity);
  for (let k = 0; k < t.length; k += 9) {
    const ax = t[k], ay = t[k + 1], az = t[k + 2], bx = t[k + 3], by = t[k + 4], bz = t[k + 5], cx = t[k + 6], cy = t[k + 7], cz = t[k + 8];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(det) < 1e-9) continue;
    const ix0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - minX) / cell));
    const ix1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - minX) / cell));
    const iy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - minY) / cell));
    const iy1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - minY) / cell));
    for (let iy = iy0; iy <= iy1; iy++) {
      const py = minY + (iy + 0.5) * cell;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = minX + (ix + 0.5) * cell;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const z = l1 * az + l2 * bz + l3 * cz;
        const i = iy * nx + ix;
        if (z < lo[i]) lo[i] = z;
        if (z > hi[i]) hi[i] = z;
      }
    }
  }
  let v = 0;
  for (let i = 0; i < lo.length; i++) if (hi[i] > lo[i]) v += hi[i] - lo[i];
  return v * cell * cell;
}
