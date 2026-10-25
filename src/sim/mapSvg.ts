/**
 * Mapa da simulação como SVG estático (memorial impresso): áreas de origem e destino dos DXF,
 * trajetos dos circuitos, paradas no trajeto, escala e norte.
 */
import type { DetailedPremises, Route } from '@/types';
import type { SimModel, Vec3 } from './types';
import { geoFor } from '@/engine/geo';
import { cumulative, pointAt } from './dxf';

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const COLORS = ['#185FA5', '#3B6D11', '#A32D2D', '#854F0B', '#534AB7', '#0F6E56', '#993556'];

export function mapSvg(model: SimModel | undefined, routes: Route[], premises: DetailedPremises): string {
  const period = model?.geoPeriod ?? 1;
  const nodes = premises.nodes ?? [];
  const polys: { ring: [number, number][]; fill: string; stroke: string; label?: string }[] = [];
  const seen = new Set<string>();
  const paths: { pts: Vec3[]; color: string; label: string; stops: { p: Vec3; name: string }[] }[] = [];
  routes.filter((r) => r.active).forEach((r, i) => {
    const g = geoFor(r, period);
    const add = (ring: [number, number][] | undefined, id: string | undefined, fill: string, stroke: string) => {
      if (!ring || ring.length < 3 || seen.has(`${id}-${fill}`)) return;
      seen.add(`${id}-${fill}`);
      polys.push({ ring, fill, stroke, label: nodes.find((n) => n.id === id)?.name });
    };
    add(g.origin, r.fromId, 'rgba(24,95,165,0.15)', '#185FA5');
    add(g.dest, r.toId, 'rgba(59,109,17,0.15)', '#3B6D11');
    if (g.path && g.path.length > 1) {
      const cum = cumulative(g.path);
      const L = cum[cum.length - 1] || 1;
      paths.push({ pts: g.path, color: COLORS[i % COLORS.length], label: r.name, stops: (r.stops ?? []).map((s) => ({ p: pointAt(g.path!, cum, Math.min(L, Math.max(0, (s.distM / Math.max(1, r.distance)) * L))), name: s.name })) });
    }
  });
  // circuitos da simulação sem DXF na movimentação: usa as rotas importadas na simulação
  if (!paths.length && model?.routes?.length)
    model.routes.forEach((r, i) => r.points.length > 1 && paths.push({ pts: r.points, color: COLORS[i % COLORS.length], label: r.name, stops: [] }));
  if (!polys.length && !paths.length) return '';
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const addPt = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  polys.forEach((g) => g.ring.forEach(([x, y]) => addPt(x, y)));
  paths.forEach((p) => p.pts.forEach((v) => addPt(v.x, v.y)));
  const W = 1000;
  const pad = 40;
  const dx = Math.max(1, x1 - x0);
  const dy = Math.max(1, y1 - y0);
  const k = (W - 2 * pad) / Math.max(dx, dy * 1.0);
  const H = Math.round(Math.min(900, dy * k + 2 * pad + 30));
  const X = (x: number) => pad + (x - x0) * k;
  const Y = (y: number) => H - 30 - pad - (y - y0) * k;
  const o: string[] = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">`);
  o.push(`<rect width="${W}" height="${H}" fill="#FAFAF8"/>`);
  for (const g of polys) {
    o.push(`<polygon points="${g.ring.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')}" fill="${g.fill}" stroke="${g.stroke}" stroke-width="1.5"/>`);
    if (g.label) {
      const cx = g.ring.reduce((a, [x]) => a + x, 0) / g.ring.length;
      const cy = g.ring.reduce((a, [, y]) => a + y, 0) / g.ring.length;
      o.push(`<text x="${X(cx).toFixed(1)}" y="${Y(cy).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="bold" fill="${g.stroke}">${esc(g.label)}</text>`);
    }
  }
  paths.forEach((p) => {
    o.push(`<polyline points="${p.pts.map((v) => `${X(v.x).toFixed(1)},${Y(v.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${p.color}" stroke-width="3" stroke-linejoin="round"/>`);
    const m = p.pts[Math.floor(p.pts.length / 2)];
    o.push(`<text x="${(X(m.x) + 6).toFixed(1)}" y="${(Y(m.y) - 6).toFixed(1)}" font-size="11" fill="${p.color}">${esc(p.label)}</text>`);
    for (const s of p.stops) o.push(`<rect x="${(X(s.p.x) - 6).toFixed(1)}" y="${(Y(s.p.y) - 6).toFixed(1)}" width="12" height="12" transform="rotate(45 ${X(s.p.x).toFixed(1)} ${Y(s.p.y).toFixed(1)})" fill="#fff" stroke="${p.color}" stroke-width="2"/><text x="${X(s.p.x).toFixed(1)}" y="${(Y(s.p.y) - 11).toFixed(1)}" text-anchor="middle" font-size="10" fill="${p.color}">${esc(s.name)}</text>`);
  });
  // escala e norte
  const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((v) => v * k > 80) ?? 10000;
  o.push(`<g transform="translate(${pad},${H - 22})"><rect width="${nice * k}" height="6" fill="#151619"/><text y="-4" font-size="11" fill="#151619">0</text><text x="${nice * k}" y="-4" font-size="11" text-anchor="end" fill="#151619">${nice >= 1000 ? `${nice / 1000} km` : `${nice} m`}</text></g>`);
  o.push(`<g transform="translate(${W - pad},${pad})"><path d="M0,-18 L7,4 L0,0 L-7,4 Z" fill="#151619"/><text y="20" text-anchor="middle" font-size="12" font-weight="bold">N</text></g>`);
  o.push('</svg>');
  return o.join('');
}
