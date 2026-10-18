/**
 * Terreno a partir de DXF: grade de elevação (DEM) rasterizada de triangulação 3DFACE
 * e curvas de nível simplificadas. Pensado para rodar em Web Worker com arquivos grandes.
 */
import { parseDxfFile, simplify } from './dxf';
import type { Vec3 } from './types';

export interface TerrainGrid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  /** cotas por célula (linha a linha, de y0 para cima); NaN = sem dado */
  z: Float32Array;
  zmin: number;
  zmax: number;
}

export interface Contours {
  lines: { z: number; pts: [number, number][] }[];
  bounds: Bounds;
  zmin: number;
  zmax: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Tamanho de célula para que a grade tenha no máximo ~maxCells células. */
export function chooseCell(b: Bounds, maxCells = 2_500_000, minCell = 1) {
  const area = Math.max((b.maxX - b.minX) * (b.maxY - b.minY), 1);
  return Math.max(minCell, Math.ceil(Math.sqrt(area / maxCells) * 2) / 2);
}

export function emptyGrid(b: Bounds, cell: number): TerrainGrid {
  const nx = Math.max(2, Math.ceil((b.maxX - b.minX) / cell) + 1);
  const ny = Math.max(2, Math.ceil((b.maxY - b.minY) / cell) + 1);
  const z = new Float32Array(nx * ny);
  z.fill(NaN);
  return { x0: b.minX, y0: b.minY, cell, nx, ny, z, zmin: Infinity, zmax: -Infinity };
}

/** Rasteriza um triângulo na grade (amostragem no centro das células, interpolação baricêntrica). */
export function rasterTriangle(g: TerrainGrid, a: Vec3, b: Vec3, c: Vec3) {
  const ix0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - g.x0) / g.cell));
  const ix1 = Math.min(g.nx - 1, Math.ceil((Math.max(a.x, b.x, c.x) - g.x0) / g.cell));
  const iy0 = Math.max(0, Math.floor((Math.min(a.y, b.y, c.y) - g.y0) / g.cell));
  const iy1 = Math.min(g.ny - 1, Math.ceil((Math.max(a.y, b.y, c.y) - g.y0) / g.cell));
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-9) return;
  for (let iy = iy0; iy <= iy1; iy++) {
    const py = g.y0 + iy * g.cell;
    for (let ix = ix0; ix <= ix1; ix++) {
      const px = g.x0 + ix * g.cell;
      const l1 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) / det;
      const l2 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * a.z + l2 * b.z + l3 * c.z;
      g.z[iy * g.nx + ix] = z;
      if (z < g.zmin) g.zmin = z;
      if (z > g.zmax) g.zmax = z;
    }
  }
}

/** Cota interpolada (bilinear) em um ponto; NaN fora do terreno. */
export function elevationAt(g: TerrainGrid, x: number, y: number): number {
  const fx = (x - g.x0) / g.cell;
  const fy = (y - g.y0) / g.cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix >= g.nx - 1 || iy >= g.ny - 1) return NaN;
  const tx = fx - ix;
  const ty = fy - iy;
  const i = iy * g.nx + ix;
  const z00 = g.z[i];
  const z10 = g.z[i + 1];
  const z01 = g.z[i + g.nx];
  const z11 = g.z[i + g.nx + 1];
  return (z00 * (1 - tx) + z10 * tx) * (1 - ty) + (z01 * (1 - tx) + z11 * tx) * ty;
}

/** Leitura em 2 passadas de uma triangulação 3DFACE: limites e depois rasterização. */
export async function terrainFromFaces(file: Blob, onProgress?: (f: number, stage: string) => void, maxCells = 2_500_000) {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let faces = 0;
  await parseDxfFile(
    file,
    {
      face: (p, q, r) => {
        faces++;
        for (const v of [p, q, r]) {
          if (v.x < b.minX) b.minX = v.x;
          if (v.y < b.minY) b.minY = v.y;
          if (v.x > b.maxX) b.maxX = v.x;
          if (v.y > b.maxY) b.maxY = v.y;
        }
      },
    },
    (f) => onProgress?.(f * 0.5, 'Lendo limites'),
  );
  if (!faces) return null;
  const grid = emptyGrid(b, chooseCell(b, maxCells));
  await parseDxfFile(
    file,
    {
      face: (p, q, r, s) => {
        rasterTriangle(grid, p, q, r);
        // 3DFACE com 4 vértices distintos = quadrilátero
        if (s.x !== r.x || s.y !== r.y || s.z !== r.z) rasterTriangle(grid, p, r, s);
      },
    },
    (f) => onProgress?.(0.5 + f * 0.5, 'Montando o terreno'),
  );
  return { grid, faces };
}

/** Curvas de nível simplificadas (para desenho). */
export async function contoursFromFile(file: Blob, onProgress?: (f: number, stage: string) => void, tol = 1, maxVertices = 400_000) {
  const raw: { z: number; pts: Vec3[] }[] = [];
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let zmin = Infinity;
  let zmax = -Infinity;
  await parseDxfFile(
    file,
    {
      polyline: (pts) => {
        const z = pts[0].z;
        const s = simplify(pts, tol);
        for (const p of s) {
          if (p.x < b.minX) b.minX = p.x;
          if (p.y < b.minY) b.minY = p.y;
          if (p.x > b.maxX) b.maxX = p.x;
          if (p.y > b.maxY) b.maxY = p.y;
        }
        if (z < zmin) zmin = z;
        if (z > zmax) zmax = z;
        raw.push({ z, pts: s });
      },
    },
    (f) => onProgress?.(f, 'Lendo curvas'),
  );
  if (!raw.length) return null;
  // se ainda ficou pesado, simplifica mais
  let total = raw.reduce((a, r) => a + r.pts.length, 0);
  let t = tol;
  let lines = raw;
  while (total > maxVertices && t < 50) {
    t *= 2;
    lines = raw.map((r) => ({ z: r.z, pts: simplify(r.pts, t) }));
    total = lines.reduce((a, r) => a + r.pts.length, 0);
  }
  const out: Contours = {
    lines: lines.map((l) => ({ z: l.z, pts: l.pts.map((p) => [p.x, p.y] as [number, number]) })),
    bounds: b,
    zmin,
    zmax,
  };
  return out;
}

/** Relevo sombreado com cores hipsométricas, em RGBA (para desenhar em canvas). */
export function hillshade(g: TerrainGrid, azimuthDeg = 315, altitudeDeg = 45): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.nx * g.ny * 4);
  const az = (azimuthDeg * Math.PI) / 180;
  const alt = (altitudeDeg * Math.PI) / 180;
  const zr = g.zmax - g.zmin || 1;
  for (let iy = 0; iy < g.ny; iy++) {
    for (let ix = 0; ix < g.nx; ix++) {
      const i = iy * g.nx + ix;
      // a imagem é desenhada de cima para baixo: linha da imagem = ny-1-iy
      const o = ((g.ny - 1 - iy) * g.nx + ix) * 4;
      const z = g.z[i];
      if (Number.isNaN(z)) {
        out[o + 3] = 0;
        continue;
      }
      const zl = g.z[i - 1] ?? z;
      const zr_ = g.z[i + 1] ?? z;
      const zd = g.z[i - g.nx] ?? z;
      const zu = g.z[i + g.nx] ?? z;
      const dzdx = ((Number.isNaN(zr_) ? z : zr_) - (Number.isNaN(zl) ? z : zl)) / (2 * g.cell);
      const dzdy = ((Number.isNaN(zu) ? z : zu) - (Number.isNaN(zd) ? z : zd)) / (2 * g.cell);
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(0, Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect));
      const h = (z - g.zmin) / zr;
      // verde-oliva (baixo) → ocre → castanho claro (alto)
      const r = 120 + 95 * h;
      const gg = 130 + 50 * h - 30 * h * h;
      const bb = 95 + 40 * h;
      const k = 0.45 + 0.65 * shade;
      out[o] = r * k;
      out[o + 1] = gg * k;
      out[o + 2] = bb * k;
      out[o + 3] = 255;
    }
  }
  return out;
}
