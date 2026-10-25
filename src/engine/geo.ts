/**
 * Geometria das movimentações (DXF): polígono da origem, polígono do destino e polilinha do trajeto, por período.
 * Cada período herda do anterior o que não foi trocado.
 */
import type { Route, RouteGeo } from '../types';
import { parseDxfText, routeLength, simplify } from '../sim/dxf';
import type { Vec3 } from '../sim/types';

export type GeoField = 'origin' | 'dest' | 'path';

/** Geometria efetiva de um período: para cada campo, a do último período ≤ p que tem o campo. */
export function geoFor(route: Pick<Route, 'geo'>, period = 1): { origin?: [number, number][]; dest?: [number, number][]; path?: Vec3[]; stops: Record<string, { x: number; y: number; z?: number }>; from: Partial<Record<GeoField, number>>; stopFrom: Record<string, number> } {
  const list = [...(route.geo ?? [])].filter((g) => g.period <= period).sort((a, b) => a.period - b.period);
  const out: ReturnType<typeof geoFor> = { from: {}, stops: {}, stopFrom: {} };
  for (const g of list) {
    for (const f of ['origin', 'dest', 'path'] as GeoField[])
      if (g[f]?.length) {
        (out as Record<string, unknown>)[f] = g[f];
        out.from[f] = g.period;
      }
    for (const [id, pt] of Object.entries(g.stops ?? {})) {
      out.stops[id] = pt;
      out.stopFrom[id] = g.period;
    }
  }
  return out;
}

/** Ponto de uma parada no DXF: o primeiro POINT; senão o centro da maior polilinha (bloco, círculo desenhado, etc.). */
export function readPointDxf(text: string): { x: number; y: number; z: number } | null {
  const pts: Vec3[] = [];
  const lines: Vec3[][] = [];
  parseDxfText(text, { point: (p) => pts.push(p), polyline: (p) => lines.push(p) });
  if (pts.length) return { x: pts[0].x, y: pts[0].y, z: pts[0].z };
  if (!lines.length) return null;
  const l = lines.reduce((a, b) => (b.length > a.length ? b : a));
  const n = l.length;
  return { x: l.reduce((a, v) => a + v.x, 0) / n, y: l.reduce((a, v) => a + v.y, 0) / n, z: l.reduce((a, v) => a + v.z, 0) / n };
}

/** Distância ao longo do trajeto (3D, a partir da origem) do ponto do trajeto mais próximo de p. */
export function distanceAlong(path: Vec3[], p: { x: number; y: number }): number {
  let best = Infinity;
  let at = 0;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    const qx = a.x + t * dx;
    const qy = a.y + t * dy;
    const d = Math.hypot(p.x - qx, p.y - qy);
    const seg = Math.hypot(dx, dy, b.z - a.z);
    if (d < best) {
      best = d;
      at = acc + t * seg;
    }
    acc += seg;
  }
  return at;
}

/** Grava (ou limpa) o ponto de uma parada num período; com trajeto, a distância da origem da parada passa a ser a medida nele. */
export function setStopGeo(route: Route, period: number, stopId: string, pt: { x: number; y: number; z?: number } | undefined, file?: string): Route {
  const list = [...(route.geo ?? [])];
  let g = list.find((x) => x.period === period);
  if (!g) {
    g = { period };
    list.push(g);
  }
  const stops = { ...(g.stops ?? {}) };
  const sf = { ...(g.files?.stops ?? {}) };
  if (pt) {
    stops[stopId] = pt;
    if (file) sf[stopId] = file;
  } else {
    delete stops[stopId];
    delete sf[stopId];
  }
  const ng: RouteGeo = { ...g, stops: Object.keys(stops).length ? stops : undefined, files: { ...(g.files ?? {}), stops: Object.keys(sf).length ? sf : undefined } };
  const next = list.map((x) => (x.period === period ? ng : x)).filter((x) => x.origin?.length || x.dest?.length || x.path?.length || Object.keys(x.stops ?? {}).length);
  const r: Route = { ...route, geo: next.length ? next.sort((a, b) => a.period - b.period) : undefined };
  const path = geoFor(r, period).path;
  if (pt && path && path.length > 1 && period === 1) r.stops = (r.stops ?? []).map((s) => (s.id === stopId ? { ...s, distM: Math.round(distanceAlong(path, pt)) } : s));
  return r;
}

/** Quantidade de períodos da geometria da movimentação. */
export const geoPeriodCount = (route: Pick<Route, 'geo' | 'geoLabels'>, planPeriods = 0) => Math.max(1, planPeriods, route.geoLabels?.length ?? 0, ...(route.geo ?? []).map((g) => g.period));

/** Apaga um período: tira a geometria dele e puxa os seguintes uma posição para trás. */
export function removeGeoPeriod(route: Route, period: number, planPeriods = 0): Route {
  const n = geoPeriodCount(route, planPeriods);
  const labels = Array.from({ length: n }, (_, i) => route.geoLabels?.[i] ?? `Período ${i + 1}`);
  labels.splice(period - 1, 1);
  // nomes automáticos (“Período N”) acompanham a nova posição
  for (let i = 0; i < labels.length; i++) if (/^Período \d+$/.test(labels[i])) labels[i] = `Período ${i + 1}`;
  const geo = (route.geo ?? []).filter((g) => g.period !== period).map((g) => (g.period > period ? { ...g, period: g.period - 1 } : g));
  return { ...route, geo: geo.length ? geo : undefined, geoLabels: labels.length ? labels : undefined };
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
  const next = list.map((x) => (x.period === period ? ng : x)).filter((x) => x.origin?.length || x.dest?.length || x.path?.length || Object.keys(x.stops ?? {}).length);
  const r: Route = { ...route, geo: next.length ? next.sort((a, b) => a.period - b.period) : undefined };
  // DMT pelo trajeto do primeiro período
  if (field === 'path' && period === 1 && value && (value as Vec3[]).length > 1) {
    r.distance = Math.round(pathLength(value as Vec3[]));
    // paradas com ponto no DXF: distância da origem medida no novo trajeto
    const pts = geoFor(r, 1).stops;
    if (r.stops?.length) r.stops = r.stops.map((st) => (pts[st.id] ? { ...st, distM: Math.round(distanceAlong(value as Vec3[], pts[st.id])) } : st));
  }
  return r;
}
