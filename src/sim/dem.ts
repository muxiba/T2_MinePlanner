/**
 * Modelo digital de elevação reduzido (para a vista 3D) e topografia aproximada de cada período:
 * terreno base rebaixado nas áreas lavradas até a cota média do piso e elevado nos sólidos de disposição.
 */
import type { Contours, TerrainGrid } from './terrain';
import type { MinePlan } from './plan';
import { pointInRing } from './plan';

export interface Dem {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  /** cotas linha a linha (de y0 para cima) */
  z: Float32Array;
  zmin: number;
  zmax: number;
}

/** Superfície coarse (topo de um sólido), NaN = sem cobertura. */
export interface TopGrid {
  x0: number;
  y0: number;
  cell: number;
  nx: number;
  ny: number;
  z: number[];
}

/** Preenche células sem dado pela média das vizinhas (difusão), mantendo as conhecidas. */
export function fillGaps(z: Float32Array, nx: number, ny: number, iters = 400) {
  const known = new Uint8Array(z.length);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < z.length; i++)
    if (Number.isFinite(z[i])) {
      known[i] = 1;
      sum += z[i];
      n++;
    }
  if (!n) return;
  const mean = sum / n;
  for (let i = 0; i < z.length; i++) if (!known[i]) z[i] = mean;
  const tmp = new Float32Array(z.length);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = y * nx + x;
        if (known[i]) {
          tmp[i] = z[i];
          continue;
        }
        let s = 0;
        let c = 0;
        if (x > 0) { s += z[i - 1]; c++; }
        if (x < nx - 1) { s += z[i + 1]; c++; }
        if (y > 0) { s += z[i - nx]; c++; }
        if (y < ny - 1) { s += z[i + nx]; c++; }
        tmp[i] = s / c;
      }
    z.set(tmp);
  }
}

function finish(d: Omit<Dem, 'zmin' | 'zmax'>): Dem {
  let zmin = Infinity;
  let zmax = -Infinity;
  for (const v of d.z) {
    if (!Number.isFinite(v)) continue;
    if (v < zmin) zmin = v;
    if (v > zmax) zmax = v;
  }
  return { ...d, zmin, zmax };
}

/** Reduz uma grade (de 3DFACE) para no máximo maxN × maxN células. */
export function demFromGrid(g: TerrainGrid, maxN = 320): Dem {
  const step = Math.max(1, Math.ceil(Math.max(g.nx, g.ny) / maxN));
  const nx = Math.ceil(g.nx / step);
  const ny = Math.ceil(g.ny / step);
  const z = new Float32Array(nx * ny).fill(NaN);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      let s = 0;
      let c = 0;
      for (let yy = y * step; yy < Math.min(g.ny, (y + 1) * step); yy++)
        for (let xx = x * step; xx < Math.min(g.nx, (x + 1) * step); xx++) {
          const v = g.z[yy * g.nx + xx];
          if (Number.isFinite(v)) {
            s += v;
            c++;
          }
        }
      if (c) z[y * nx + x] = s / c;
    }
  // células sem dado ficam NaN (fora da superfície); combineDem completa
  return finish({ x0: g.x0, y0: g.y0, cell: g.cell * step, nx, ny, z });
}

/** Grade a partir de curvas de nível: média dos vértices em cada célula + preenchimento suave. */
export function demFromContours(c: Contours, maxN = 260): Dem {
  const b = c.bounds;
  const cell = Math.max(1, Math.max(b.maxX - b.minX, b.maxY - b.minY) / maxN);
  const nx = Math.ceil((b.maxX - b.minX) / cell) + 1;
  const ny = Math.ceil((b.maxY - b.minY) / cell) + 1;
  const sum = new Float64Array(nx * ny);
  const cnt = new Uint32Array(nx * ny);
  for (const l of c.lines) {
    for (let k = 0; k < l.pts.length; k++) {
      const [x, y] = l.pts[k];
      // densifica segmentos longos para não deixar buracos
      const nxt = l.pts[k + 1];
      const steps = nxt ? Math.max(1, Math.ceil(Math.hypot(nxt[0] - x, nxt[1] - y) / cell)) : 1;
      for (let s = 0; s < steps; s++) {
        const px = nxt ? x + ((nxt[0] - x) * s) / steps : x;
        const py = nxt ? y + ((nxt[1] - y) * s) / steps : y;
        const i = Math.floor((py - b.minY) / cell) * nx + Math.floor((px - b.minX) / cell);
        if (i >= 0 && i < sum.length) {
          sum[i] += l.z;
          cnt[i]++;
        }
      }
    }
  }
  const z = new Float32Array(nx * ny).fill(NaN);
  for (let i = 0; i < z.length; i++) if (cnt[i]) z[i] = sum[i] / cnt[i];
  fillGaps(z, nx, ny, 500);
  return finish({ x0: b.minX, y0: b.minY, cell, nx, ny, z });
}

export function sampleDem(d: Dem, x: number, y: number) {
  const fx = (x - d.x0) / d.cell;
  const fy = (y - d.y0) / d.cell;
  const ix = Math.max(0, Math.min(d.nx - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(d.ny - 2, Math.floor(fy)));
  const tx = Math.max(0, Math.min(1, fx - ix));
  const ty = Math.max(0, Math.min(1, fy - iy));
  const i = iy * d.nx + ix;
  return (d.z[i] * (1 - tx) + d.z[i + 1] * tx) * (1 - ty) + (d.z[i + d.nx] * (1 - tx) + d.z[i + d.nx + 1] * tx) * ty;
}

/**
 * Topografia aproximada no fim do período: áreas lavradas até o período rebaixadas à cota média
 * do piso; sólidos de disposição até o período sobem até o topo do sólido.
 */
export function periodDem(base: Dem, plan: MinePlan | undefined, period: number): Dem {
  if (!plan || period <= 0) return base;
  const z = new Float32Array(base.z);
  const fronts = plan.fronts.filter((f) => f.period <= period && f.areaM2 > 10 && f.z).sort((a, b) => a.period - b.period);
  for (const f of fronts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of f.ring) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const ix0 = Math.max(0, Math.floor((minX - base.x0) / base.cell));
    const ix1 = Math.min(base.nx - 1, Math.ceil((maxX - base.x0) / base.cell));
    const iy0 = Math.max(0, Math.floor((minY - base.y0) / base.cell));
    const iy1 = Math.min(base.ny - 1, Math.ceil((maxY - base.y0) / base.cell));
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const x = base.x0 + ix * base.cell;
        const y = base.y0 + iy * base.cell;
        if (!pointInRing(x, y, f.ring)) continue;
        const i = iy * base.nx + ix;
        if (z[i] > f.z) z[i] = f.z;
      }
  }
  for (const s of plan.solids.filter((x) => x.period <= period)) {
    const t = s.top;
    if (!t) continue;
    for (let iy = 0; iy < base.ny; iy++) {
      const y = base.y0 + iy * base.cell;
      const ty = Math.floor((y - t.y0) / t.cell);
      if (ty < 0 || ty >= t.ny) continue;
      for (let ix = 0; ix < base.nx; ix++) {
        const x = base.x0 + ix * base.cell;
        const tx = Math.floor((x - t.x0) / t.cell);
        if (tx < 0 || tx >= t.nx) continue;
        const v = t.z[ty * t.nx + tx];
        const i = iy * base.nx + ix;
        if (v !== null && Number.isFinite(v) && v > z[i]) z[i] = v;
      }
    }
  }
  return finish({ x0: base.x0, y0: base.y0, cell: base.cell, nx: base.nx, ny: base.ny, z });
}

function nearest(d: Dem, x: number, y: number) {
  const ix = Math.round((x - d.x0) / d.cell);
  const iy = Math.round((y - d.y0) / d.cell);
  if (ix < 0 || iy < 0 || ix >= d.nx || iy >= d.ny) return NaN;
  return d.z[iy * d.nx + ix];
}

/**
 * Junta a superfície detalhada (drone/3DFACE) com as curvas de nível (área maior):
 * onde há superfície, vale ela; fora, as curvas. Lacunas são preenchidas suavemente.
 */
export function combineDem(grid: Dem | null, contours: Dem | null, maxN = 360): Dem | null {
  if (!grid && !contours) return null;
  const a = grid ?? contours!;
  const b = grid && contours ? contours : null;
  const minX = Math.min(a.x0, b?.x0 ?? Infinity);
  const minY = Math.min(a.y0, b?.y0 ?? Infinity);
  const maxX = Math.max(a.x0 + (a.nx - 1) * a.cell, b ? b.x0 + (b.nx - 1) * b.cell : -Infinity);
  const maxY = Math.max(a.y0 + (a.ny - 1) * a.cell, b ? b.y0 + (b.ny - 1) * b.cell : -Infinity);
  const cell = Math.max(Math.min(a.cell, b?.cell ?? Infinity), Math.max(maxX - minX, maxY - minY) / maxN);
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const ny = Math.ceil((maxY - minY) / cell) + 1;
  const z = new Float32Array(nx * ny);
  for (let iy = 0; iy < ny; iy++)
    for (let ix = 0; ix < nx; ix++) {
      const x = minX + ix * cell;
      const y = minY + iy * cell;
      let v = grid ? nearest(grid, x, y) : NaN;
      if (!Number.isFinite(v) && contours) v = nearest(contours, x, y);
      z[iy * nx + ix] = v;
    }
  fillGaps(z, nx, ny, 300);
  return finish({ x0: minX, y0: minY, cell, nx, ny, z });
}
