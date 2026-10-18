/**
 * Leitor de DXF (ASCII) em streaming: processa arquivos de centenas de MB em blocos,
 * sem carregar tudo na memória. Entidades suportadas: POLYLINE/VERTEX (2D/3D),
 * LWPOLYLINE (com elevação), LINE, POINT e 3DFACE.
 */
import type { Vec3 } from './types';

export interface DxfHandlers {
  polyline?: (points: Vec3[], layer: string, closed: boolean) => void;
  point?: (p: Vec3, layer: string) => void;
  face?: (a: Vec3, b: Vec3, c: Vec3, d: Vec3, layer: string) => void;
}

type Raw = { type: string; layer: string; g: Map<number, number[]>; elevation: number; flags: number };

export class DxfReader {
  private rest = '';
  private code: number | null = null;
  private inEntities = false;
  private lastZero = '';
  private ent: Raw | null = null;
  private poly: { layer: string; closed: boolean; pts: Vec3[] } | null = null;
  bytes = 0;
  entities = 0;

  constructor(private h: DxfHandlers) {}

  push(chunk: string) {
    this.bytes += chunk.length;
    const text = this.rest + chunk;
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      let line = text.slice(start, nl);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.line(line);
      start = nl + 1;
    }
    this.rest = text.slice(start);
  }

  end() {
    if (this.rest) this.line(this.rest.replace(/\r$/, ''));
    this.rest = '';
    this.flush();
    this.endPoly();
  }

  private line(line: string) {
    if (this.code === null) {
      this.code = parseInt(line, 10);
      return;
    }
    const code = this.code;
    this.code = null;
    this.pair(code, line);
  }

  private pair(code: number, value: string) {
    if (code === 0) {
      const v = value.trim();
      this.flush();
      if (v === 'SECTION') this.lastZero = 'SECTION';
      else if (v === 'ENDSEC') {
        this.inEntities = false;
        this.endPoly();
        this.lastZero = v;
      } else {
        this.lastZero = v;
        if (this.inEntities) this.ent = { type: v, layer: '0', g: new Map(), elevation: 0, flags: 0 };
      }
      return;
    }
    if (code === 2 && this.lastZero === 'SECTION') {
      this.inEntities = value.trim() === 'ENTITIES' || value.trim() === 'BLOCKS';
      return;
    }
    const e = this.ent;
    if (!e) return;
    if (code === 8) e.layer = value.trim();
    else if (code === 70) e.flags = parseInt(value, 10) || 0;
    else if (code === 38) e.elevation = parseFloat(value) || 0;
    else if ((code >= 10 && code <= 13) || (code >= 20 && code <= 23) || (code >= 30 && code <= 33)) {
      const arr = e.g.get(code);
      const n = parseFloat(value);
      if (arr) arr.push(n);
      else e.g.set(code, [n]);
    }
  }

  private flush() {
    const e = this.ent;
    this.ent = null;
    if (!e) return;
    this.entities++;
    const g = (c: number, i = 0) => e.g.get(c)?.[i] ?? 0;
    switch (e.type) {
      case 'POLYLINE':
        this.endPoly();
        this.poly = { layer: e.layer, closed: (e.flags & 1) === 1, pts: [] };
        break;
      case 'VERTEX':
        if (this.poly) this.poly.pts.push({ x: g(10), y: g(20), z: g(30) });
        break;
      case 'SEQEND':
        this.endPoly();
        break;
      case 'LWPOLYLINE': {
        const xs = e.g.get(10) ?? [];
        const ys = e.g.get(20) ?? [];
        const pts: Vec3[] = xs.map((x, i) => ({ x, y: ys[i] ?? 0, z: e.elevation }));
        if (pts.length >= 2) this.h.polyline?.(pts, e.layer, (e.flags & 1) === 1);
        break;
      }
      case 'LINE':
        this.h.polyline?.([{ x: g(10), y: g(20), z: g(30) }, { x: g(11), y: g(21), z: g(31) }], e.layer, false);
        break;
      case 'POINT':
        this.h.point?.({ x: g(10), y: g(20), z: g(30) }, e.layer);
        break;
      case '3DFACE':
        this.h.face?.(
          { x: g(10), y: g(20), z: g(30) },
          { x: g(11), y: g(21), z: g(31) },
          { x: g(12), y: g(22), z: g(32) },
          { x: g(13), y: g(23), z: g(33) },
          e.layer,
        );
        break;
    }
  }

  private endPoly() {
    const p = this.poly;
    this.poly = null;
    if (p && p.pts.length >= 2) this.h.polyline?.(p.pts, p.layer, p.closed);
  }
}

/** Lê um DXF inteiro de um texto (arquivos pequenos, como rotas). */
export function parseDxfText(text: string, h: DxfHandlers) {
  const r = new DxfReader(h);
  r.push(text);
  r.end();
  return r;
}

/** Lê um File do navegador em blocos, informando o progresso (0–1). */
export async function parseDxfFile(file: Blob, h: DxfHandlers, onProgress?: (f: number) => void) {
  const r = new DxfReader(h);
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    r.push(value);
    onProgress?.(Math.min(1, r.bytes / Math.max(file.size, 1)));
  }
  r.end();
  return r;
}

/* ------------------------------------------------------------------------- */
/* Geometria                                                                  */
/* ------------------------------------------------------------------------- */

/** Simplificação de polilinha (Douglas–Peucker em planta) mantendo as cotas dos vértices. */
export function simplify(points: Vec3[], tol: number): Vec3[] {
  if (points.length <= 2 || tol <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = points[a];
    const B = points[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = points[i];
      const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
      const ex = A.x + t * dx - P.x;
      const ey = A.y + t * dy - P.y;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export interface ProfileSegment {
  /** distância horizontal (m) */
  h: number;
  /** extensão inclinada (m) */
  len: number;
  /** rampa no sentido carga → descarga (%) */
  grade: number;
  /** distância acumulada no início do trecho (m) */
  s0: number;
}

/**
 * Perfil longitudinal: agrupa vértices muito próximos (ruído do levantamento)
 * em trechos de pelo menos `minLen` m para a rampa não ficar instável.
 */
export function routeProfile(points: Vec3[], minLen = 20): ProfileSegment[] {
  const segs: ProfileSegment[] = [];
  let s = 0;
  let i = 0;
  while (i < points.length - 1) {
    const a = points[i];
    let j = i + 1;
    let h = Math.hypot(points[j].x - a.x, points[j].y - a.y);
    while (h < minLen && j < points.length - 1) {
      h += Math.hypot(points[j + 1].x - points[j].x, points[j + 1].y - points[j].y);
      j++;
    }
    const dz = points[j].z - a.z;
    const len = Math.hypot(h, dz);
    segs.push({ h, len, grade: h > 0 ? (dz / h) * 100 : 0, s0: s });
    s += h;
    i = j;
  }
  return segs;
}

export function routeLength(points: Vec3[]) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return L;
}

/** Ponto em planta a uma distância horizontal `s` ao longo da polilinha. */
export function pointAt(points: Vec3[], cum: number[], s: number): Vec3 {
  if (s <= 0) return points[0];
  const n = points.length;
  if (s >= cum[n - 1]) return points[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  const A = points[lo];
  const B = points[hi];
  return { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t, z: A.z + (B.z - A.z) * t };
}

export function cumulative(points: Vec3[]) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  return cum;
}

/**
 * Lê um DXF de rota: usa a polilinha mais longa como eixo. Se houver dois POINTs
 * nas pontas, eles definem início/fim; a orientação final (carga → descarga) é escolhida na tela.
 */
export function readRouteDxf(text: string, name: string): { points: Vec3[]; markers: Vec3[] } | null {
  const lines: Vec3[][] = [];
  const markers: Vec3[] = [];
  parseDxfText(text, { polyline: (p) => lines.push(p), point: (p) => markers.push(p) });
  if (!lines.length) return null;
  const best = lines.reduce((a, b) => (routeLength(b) > routeLength(a) ? b : a));
  void name;
  return { points: best, markers };
}
