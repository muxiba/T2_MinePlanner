import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Contours, TerrainGrid } from '@/sim/terrain';
import type { SimRoute, Vec3 } from '@/sim/types';
import type { PointQueue, TruckDot } from '@/sim/animation';

export interface TerrainLayer {
  meta: Omit<TerrainGrid, 'z'>;
  shade: Uint8ClampedArray;
}

export interface MapOverlays {
  polygons?: { ring: [number, number][]; fill: string; stroke: string; label?: string; dashed?: boolean }[];
  paths?: { points: Vec3[]; color: string; label?: string }[];
}

interface Props {
  overlays?: MapOverlays;
  /** desenha as rotas base em cinza claro (malha), sem marcadores */
  routesAsNetwork?: boolean;
  terrain?: TerrainLayer | null;
  contours?: Contours | null;
  routes: SimRoute[];
  highlight?: string | null;
  dots?: TruckDot[];
  queues?: PointQueue[];
  /** índice de circuito → rota (para posicionar as filas) */
  circuitRoutes?: string[];
  height?: number;
}

/** Cores dos caminhões na animação (3 classes validadas para leitura sobreposta). */
export const DOT_COLORS = { carregado: '#2a78d6', vazio: '#1baf7a', ponto: '#eb6834', parado: '#8a8984' } as const;

type View = { cx: number; cy: number; scale: number }; // centro (m) e px por metro

function boundsOf(routes: SimRoute[], terrain?: TerrainLayer | null, contours?: Contours | null, overlays?: MapOverlays) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const r of routes) for (const p of r.points) add(p.x, p.y);
  for (const g of overlays?.polygons ?? []) for (const [x, y] of g.ring) add(x, y);
  for (const g of overlays?.paths ?? []) for (const p of g.points) add(p.x, p.y);
  if (!Number.isFinite(minX)) {
    if (terrain) {
      add(terrain.meta.x0, terrain.meta.y0);
      add(terrain.meta.x0 + terrain.meta.nx * terrain.meta.cell, terrain.meta.y0 + terrain.meta.ny * terrain.meta.cell);
    } else if (contours) {
      add(contours.bounds.minX, contours.bounds.minY);
      add(contours.bounds.maxX, contours.bounds.maxY);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Pré-renderiza camadas estáticas (relevo e curvas) uma vez, em um canvas fora da tela. */
function useBaseLayer(terrain?: TerrainLayer | null, contours?: Contours | null) {
  return useMemo(() => {
    if (typeof document === 'undefined') return null;
    const layers: { img: HTMLCanvasElement; x0: number; y1: number; w: number; h: number }[] = [];
    if (terrain) {
      const { nx, ny, cell, x0, y0 } = terrain.meta;
      const c = document.createElement('canvas');
      c.width = nx;
      c.height = ny;
      const ctx = c.getContext('2d')!;
      const data = new ImageData(new Uint8ClampedArray(terrain.shade), nx, ny);
      ctx.putImageData(data, 0, 0);
      layers.push({ img: c, x0, y1: y0 + (ny - 1) * cell, w: (nx - 1) * cell, h: (ny - 1) * cell });
    }
    if (contours) {
      const b = contours.bounds;
      const w = b.maxX - b.minX || 1;
      const h = b.maxY - b.minY || 1;
      const px = 2400 / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * px);
      c.height = Math.ceil(h * px);
      const ctx = c.getContext('2d')!;
      const zr = contours.zmax - contours.zmin || 1;
      for (const l of contours.lines) {
        const major = Math.abs(l.z % 5) < 0.01 || Math.abs((l.z % 5) - 5) < 0.01;
        ctx.strokeStyle = major ? 'rgba(80,70,50,0.55)' : 'rgba(80,70,50,0.22)';
        ctx.lineWidth = major ? 1.2 : 0.7;
        void zr;
        ctx.beginPath();
        l.pts.forEach(([x, y], i) => {
          const X = (x - b.minX) * px;
          const Y = (b.maxY - y) * px;
          if (i) ctx.lineTo(X, Y);
          else ctx.moveTo(X, Y);
        });
        ctx.stroke();
      }
      layers.push({ img: c, x0: b.minX, y1: b.maxY, w, h });
    }
    return layers;
  }, [terrain, contours]);
}

const MapCanvas: React.FC<Props> = ({ terrain, contours, routes, highlight, dots, queues, circuitRoutes, height = 460, overlays, routesAsNetwork }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [size, setSize] = useState({ w: 800, h: height });
  const base = useBaseLayer(terrain, contours);
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);

  const fit = React.useCallback(() => {
    const b = boundsOf(routes, terrain, contours, overlays);
    if (!b) return setView(null);
    const pad = 1.12;
    const scale = Math.min(size.w / ((b.maxX - b.minX) * pad || 1), size.h / ((b.maxY - b.minY) * pad || 1));
    setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 });
  }, [routes, terrain, contours, overlays, size.w, size.h]);

  useEffect(() => {
    fit();
    // reenquadra só quando muda o conjunto de geometrias
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes.length, terrain, contours, size.w, Boolean(overlays)]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // desenho
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !view) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr;
    cv.height = size.h * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ecebe4';
    ctx.fillRect(0, 0, size.w, size.h);
    const X = (x: number) => size.w / 2 + (x - view.cx) * view.scale;
    const Y = (y: number) => size.h / 2 - (y - view.cy) * view.scale;

    ctx.imageSmoothingEnabled = true;
    for (const l of base ?? []) ctx.drawImage(l.img, X(l.x0), Y(l.y1), l.w * view.scale, l.h * view.scale);

    // áreas (frentes do período, sólidos de rejeito)
    for (const g of overlays?.polygons ?? []) {
      if (g.ring.length < 3) continue;
      ctx.beginPath();
      g.ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.closePath();
      ctx.fillStyle = g.fill;
      ctx.fill();
      ctx.setLineDash(g.dashed ? [5, 4] : []);
      ctx.strokeStyle = g.stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (routesAsNetwork) {
      for (const r of routes) {
        ctx.beginPath();
        r.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
        ctx.strokeStyle = 'rgba(61,60,55,0.35)';
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
    for (const g of overlays?.paths ?? []) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      g.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = g.color;
      ctx.lineWidth = 3;
      ctx.stroke();
      const a = g.points[0];
      ctx.beginPath();
      ctx.arc(X(a.x), Y(a.y), 5, 0, Math.PI * 2);
      ctx.fillStyle = g.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    for (const g of overlays?.polygons ?? []) {
      if (!g.label || g.ring.length < 3) continue;
      const cx = g.ring.reduce((a, p) => a + p[0], 0) / g.ring.length;
      const cy = g.ring.reduce((a, p) => a + p[1], 0) / g.ring.length;
      const w = ctx.measureText(g.label).width;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(g.label, X(cx) - w / 2, Y(cy));
      ctx.fillStyle = '#151619';
      ctx.fillText(g.label, X(cx) - w / 2, Y(cy));
    }

    // rotas (rótulos agrupados por posição para não sobrepor em pontos compartilhados)
    const labelAt = new Map<string, string[]>();
    const keyOf = (p: Vec3) => `${Math.round(p.x / 15)}:${Math.round(p.y / 15)}`;
    const addLabel = (p: Vec3, text: string) => {
      const k = keyOf(p);
      const l = labelAt.get(k);
      if (l) {
        if (!l.includes(text)) l.push(text);
      } else labelAt.set(k, [text]);
    };
    const labelPos = new Map<string, Vec3>();
    (routesAsNetwork ? [] : routes).forEach((r) => {
      const hl = highlight === r.id;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = hl ? 7 : 5;
      ctx.beginPath();
      r.points.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
      ctx.strokeStyle = hl ? '#151619' : '#3d3c37';
      ctx.lineWidth = hl ? 3.5 : 2.5;
      ctx.stroke();
      const a = r.points[0];
      const b = r.points[r.points.length - 1];
      const mark = (p: Vec3, fill: string) => {
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 6, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = fill === '#ffffff' ? '#151619' : '#fff';
        ctx.stroke();
      };
      mark(a, '#151619');
      mark(b, '#ffffff');
      addLabel(a, `Carga · ${r.name}`);
      addLabel(b, `Descarga · ${r.name}`);
      labelPos.set(keyOf(a), a);
      labelPos.set(keyOf(b), b);
    });
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    for (const [k, texts] of labelAt) {
      const p = labelPos.get(k)!;
      texts.forEach((t, i) => {
        const tx = X(p.x) + 10;
        const ty = Y(p.y) - 8 - (texts.length - 1 - i) * 14;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeText(t, tx, ty);
        ctx.fillStyle = '#151619';
        ctx.fillText(t, tx, ty);
      });
    }

    // caminhões
    for (const d of dots ?? []) {
      ctx.beginPath();
      ctx.arc(X(d.p.x), Y(d.p.y), d.kind === 'parado' ? 4 : 5.5, 0, Math.PI * 2);
      ctx.fillStyle = DOT_COLORS[d.kind];
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }

    // filas (empilhadas quando dois circuitos usam o mesmo ponto)
    const badgeCount = new Map<string, number>();
    for (const q of queues ?? []) {
      const rid = circuitRoutes?.[q.circuit];
      const r = routes.find((x) => x.id === rid);
      if (!r) continue;
      const p = q.where === 'carga' ? r.points[0] : r.points[r.points.length - 1];
      const txt = `${r.name}: ${q.serving} em ${q.where === 'carga' ? 'carga' : 'descarga'}${q.waiting ? ` · ${q.waiting} na fila` : ''}`;
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      const w = ctx.measureText(txt).width + 14;
      const bk = `${Math.round(p.x / 15)}:${Math.round(p.y / 15)}`;
      const nth = badgeCount.get(bk) ?? 0;
      badgeCount.set(bk, nth + 1);
      const bx = X(p.x) + 10;
      const by = Y(p.y) + 8 + nth * 26;
      ctx.fillStyle = q.waiting ? '#151619' : 'rgba(21,22,25,0.75)';
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, bx + 7, by + 15);
    }

    // escala gráfica
    const meters = [10, 20, 50, 100, 200, 500, 1000, 2000].find((m) => m * view.scale > 80) ?? 2000;
    ctx.fillStyle = '#151619';
    ctx.fillRect(16, size.h - 22, meters * view.scale, 3);
    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText(`${meters} m`, 16, size.h - 28);
  }, [view, size, base, routes, highlight, dots, queues, circuitRoutes, overlays, routesAsNetwork]);

  const onWheel = (e: React.WheelEvent) => {
    if (!view) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const wx = view.cx + (mx - size.w / 2) / view.scale;
    const wy = view.cy - (my - size.h / 2) / view.scale;
    const scale = view.scale * k;
    setView({ scale, cx: wx - (mx - size.w / 2) / scale, cy: wy + (my - size.h / 2) / scale });
  };

  return (
    <div ref={wrap} className="relative overflow-hidden rounded-xl border border-black/[0.07]" style={{ height }}>
      {view ? (
        <canvas
          ref={ref}
          style={{ width: size.w, height: size.h, cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
          onWheel={onWheel}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, v: view };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setView({ ...d.v, cx: d.v.cx - (e.clientX - d.x) / d.v.scale, cy: d.v.cy + (e.clientY - d.y) / d.v.scale });
          }}
          onPointerUp={() => (drag.current = null)}
          aria-label="Mapa do circuito: arraste para mover, use a roda do mouse para aproximar"
          role="img"
        />
      ) : (
        <div className="flex h-full items-center justify-center bg-[#F4F3EE] px-6 text-center text-sm text-black/50">
          Importe as rotas (DXF) para ver o circuito. A topografia é opcional e aparece ao fundo.
        </div>
      )}
      {view && (
        <button
          type="button"
          onClick={fit}
          className="absolute top-3 right-3 rounded-lg bg-white/90 px-2.5 py-1 text-xs font-medium shadow-sm hover:bg-white"
        >
          Enquadrar
        </button>
      )}
    </div>
  );
};

export default MapCanvas;
