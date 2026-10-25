import { describe, expect, it } from 'vitest';
import { geoFor, readPathDxf, readPolygonDxf, setGeo } from './geo';
import { INITIAL_ROUTES } from '../constants';

const lw = (pts: number[][], closed: boolean) =>
  ['0', 'LWPOLYLINE', '8', '0', '90', String(pts.length), '70', closed ? '1' : '0', ...pts.flatMap(([x, y]) => ['10', String(x), '20', String(y)])].join('\n');
const dxf = (...ents: string[]) => ['0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF'].join('\n');

describe('geometria das movimentações (DXF)', () => {
  it('lê polígono e trajeto, atualiza o DMT e herda nos períodos seguintes', () => {
    const poly = readPolygonDxf(dxf(lw([[0, 0], [100, 0], [100, 100], [0, 100]], true), lw([[0, 0], [5, 0], [5, 5]], true)))!;
    expect(poly.length).toBe(4);
    const path = readPathDxf(dxf(lw([[0, 0], [300, 0], [300, 400]], false)))!;
    let r = setGeo({ ...INITIAL_ROUTES[0] }, 1, 'path', path, 'trajeto.dxf');
    expect(r.distance).toBe(700);
    r = setGeo(r, 1, 'origin', poly, 'cava.dxf');
    r = setGeo(r, 2, 'origin', poly.map(([x, y]) => [x + 1000, y] as [number, number]), 'cava2.dxf');
    const g2 = geoFor(r, 2);
    expect(g2.from.path).toBe(1);
    expect(g2.from.origin).toBe(2);
    expect(g2.origin![0][0]).toBe(1000);
    expect(geoFor(r, 1).origin![0][0]).toBe(0);
    r = setGeo(r, 2, 'origin', undefined);
    expect(geoFor(r, 2).from.origin).toBe(1);
  });
});

describe('paradas e períodos da geometria', () => {
  it('ponto da parada vira distância pelo trajeto; apagar período puxa os seguintes', async () => {
    const { setStopGeo, removeGeoPeriod, geoPeriodCount, readPointDxf } = await import('./geo');
    const path = readPathDxf(dxf(lw([[0, 0], [300, 0], [300, 400]], false)))!;
    const pt = readPointDxf(dxf(['0', 'POINT', '8', '0', '10', '305', '20', '200', '30', '0'].join('\n')))!;
    expect(pt.x).toBe(305);
    let r = setGeo({ ...INITIAL_ROUTES[0], stops: [{ id: 's1', name: 'Balança', kind: 'pesagem' as const, distM: 0, stopMin: 2, dir: 'ambos' as const }] }, 1, 'path', path);
    r = setStopGeo(r, 1, 's1', pt, 'balanca.dxf');
    expect(r.stops![0].distM).toBe(500);
    r = setGeo(r, 3, 'origin', [[0, 0], [1, 0], [1, 1]], 'x.dxf');
    r = { ...r, geoLabels: ['Ano 1', 'Ano 2', 'Ano 3'] };
    expect(geoPeriodCount(r)).toBe(3);
    r = removeGeoPeriod(r, 2);
    expect(geoPeriodCount(r)).toBe(2);
    expect(r.geo!.some((g) => g.period === 2 && g.origin)).toBe(true);
    expect(r.geoLabels).toEqual(['Ano 1', 'Ano 3']);
  });
});
