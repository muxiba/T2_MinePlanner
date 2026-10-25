/**
 * Geometria das movimentações (DXF): polígono da origem, polígono do destino e polilinha do trajeto, por período.
 * Cada período herda do anterior o que não foi trocado.
 */
import type { Route, RouteGeo } from '../types';
import { parseDxfText, routeLength, simplify } from '../sim/dxf';
import type { Vec3 } from '../sim/types';

export type GeoField = 'origin' | 'dest' | 'path';

/** Geometria efetiva de um período: para cada campo, a do último período ≤ p que tem o campo. */
export function geoFor(route: Pick<Route, 'geo'>, period = 1): { origin?: [number, number][]; dest?: [number, number][]; path?: Vec3[]; from: Partial<Record<GeoField, number>> } {
  const list = [...(route.geo ?? [])].filter((g) => g.period <= period).sort((a, b) => a.period - b.period);
  const out: ReturnType<typeof geoFor> = { from: {} };
  for (const g of list)
    for (const f of ['origin', 'dest', 'path'] as GeoField[])
      if (g[f]?.length) {
        (out as Record<string, unknown>)[f] = g[f];
        out.from[f] = g.period;
      }
  return out;
}

const area = (ring: [number, number][]) => Math.abs(ring.reduce((a, [x, y], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return a + x * y2 - x2 * y; }, 0) / 2);

/** Polígono do DXF: a maior polilinha fechada (ou a maior polilinha, fechada à força), simplificada a 0,5 m. */
export function readPolygonDxf(text: string): [number, number][] | null {
  const rings: [number, number][][] = [];
  parseDxfText(text, { polyline: (p) => rings.push(simplify(p, 0.5).map((v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100])) });
  if (!rings.length) return null;
  return rings.reduce((a, b) => (area(b) > area(a) ? b : a));
}

/** Polilinha do trajeto: a mais longa do DXF, simplificada a 1 m (com cota). */
export function readPathDxf(text: string): Vec3[] | null {
  const lines: Vec3[][] = [];
  parseDxfText(text, { polyline: (p) => lines.push(p) });
  if (!lines.length) return null;
  const best = lines.reduce((a, b) => (routeLength(b) > routeLength(a) ? b : a));
  return simplify(best, 1).map((v) => ({ x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100, z: Math.round(v.z * 100) / 100 }));
}

/** Comprimento 3D do trajeto (m). */
export const pathLength = (pts: Vec3[]) => routeLength(pts);

/** Grava a geometria de um campo num período (cria o período se faltar). */
export function setGeo(route: Route, period: number, field: GeoField, value: RouteGeo[GeoField] | undefined, file?: string): Route {
  const list = [...(route.geo ?? [])];
  let g = list.find((x) => x.period === period);
  if (!g) {
    g = { period };
    list.push(g);
  }
  const ng: RouteGeo = { ...g, [field]: value, files: { ...(g.files ?? {}), [field]: value ? file : undefined } };
  const next = list.map((x) => (x.period === period ? ng : x)).filter((x) => x.origin?.length || x.dest?.length || x.path?.length);
  const r: Route = { ...route, geo: next.length ? next.sort((a, b) => a.period - b.period) : undefined };
  // DMT pelo trajeto do primeiro período
  if (field === 'path' && period === 1 && value && (value as Vec3[]).length > 1) r.distance = Math.round(pathLength(value as Vec3[]));
  return r;
}
