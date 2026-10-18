import React, { useEffect, useRef, useState } from 'react';
import type { Dem } from '@/sim/dem';
import { sampleDem } from '@/sim/dem';
import { EQUIP_SIZE, type LoaderDot, type TruckDot } from '@/sim/animation';
import type { Vec3 } from '@/sim/types';
import type { MapOverlays } from './MapCanvas';
import { DOT_COLORS, LOADER_COLORS } from './MapCanvas';

/**
 * Vista 3D em WebGL2 puro (sem bibliotecas): terreno sombreado com exagero vertical,
 * contornos das áreas, rotas e caminhões. Arraste para girar, Shift/botão direito para mover,
 * roda do mouse para aproximar.
 */

interface Props {
  dem: Dem | null;
  overlays?: MapOverlays;
  routes?: { points: Vec3[]; color?: string }[];
  dots?: TruckDot[];
  loaders?: LoaderDot[];
  height?: number;
}

type Mat = Float32Array;
const ident = (): Mat => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function mul(a: Mat, b: Mat): Mat {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
      o[i * 4 + j] = s;
    }
  return o;
}
function perspective(fovy: number, aspect: number, near: number, far: number): Mat {
  const f = 1 / Math.tan(fovy / 2);
  const o = new Float32Array(16);
  o[0] = f / aspect;
  o[5] = f;
  o[10] = (far + near) / (near - far);
  o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}
function lookAt(e: number[], c: number[], up: number[]): Mat {
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v: number[]) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(e, c));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  const o = ident();
  o[0] = x[0]; o[4] = x[1]; o[8] = x[2];
  o[1] = y[0]; o[5] = y[1]; o[9] = y[2];
  o[2] = z[0]; o[6] = z[1]; o[10] = z[2];
  o[12] = -dot(x, e); o[13] = -dot(y, e); o[14] = -dot(z, e);
  return o;
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** Rampa hipsométrica suave (verde → bege → marrom claro). */
function ramp(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [0.55, 0.62, 0.48]],
    [0.4, [0.78, 0.76, 0.6]],
    [0.75, [0.74, 0.62, 0.48]],
    [1, [0.92, 0.9, 0.86]],
  ];
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1];
      const [t1, b] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  return stops[stops.length - 1][1];
}

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

const TERRAIN_VS = `#version 300 es
in vec3 pos; in vec3 nrm; in vec3 col;
uniform mat4 mvp; out vec3 vN; out vec3 vC;
void main(){ vN = nrm; vC = col; gl_Position = mvp * vec4(pos, 1.0); }`;
const TERRAIN_FS = `#version 300 es
precision mediump float; in vec3 vN; in vec3 vC; out vec4 o;
void main(){ vec3 L = normalize(vec3(-0.5, 0.6, 0.75)); float d = max(dot(normalize(vN), L), 0.0);
 o = vec4(vC * (0.42 + 0.68 * d), 1.0); }`;
const FLAT_VS = `#version 300 es
in vec3 pos; in vec3 col; uniform mat4 mvp; uniform float ps; out vec3 vC;
void main(){ vC = col; gl_Position = mvp * vec4(pos, 1.0); gl_PointSize = ps; }`;
const FLAT_FS = `#version 300 es
precision mediump float; in vec3 vC; uniform float round; out vec4 o;
void main(){ if (round > 0.5) { vec2 c = gl_PointCoord - 0.5; float r = length(c); if (r > 0.5) discard; if (r > 0.36) { o = vec4(1.0); return; } }
 o = vec4(vC, 1.0); }`;

const View3D: React.FC<Props> = ({ dem, overlays, routes, dots, loaders, height = 520 }) => {
  const [enlarge, setEnlarge] = useState(1);
  const ref = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{
    gl: WebGL2RenderingContext;
    terrain: WebGLProgram;
    flat: WebGLProgram;
    buf: Record<string, { vao: WebGLVertexArrayObject; count: number; mode: number; buffers: WebGLBuffer[] } | null>;
  } | null>(null);
  const [cam, setCam] = useState({ yaw: -0.6, pitch: 0.75, dist: 1, tx: 0, ty: 0 });
  const [exag, setExag] = useState(2);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; pan: boolean; c: typeof cam } | null>(null);

  // referência do mundo: centro do terreno (ou das rotas) e cota mínima
  const ref0 = React.useMemo(() => {
    if (dem) return { cx: dem.x0 + ((dem.nx - 1) * dem.cell) / 2, cy: dem.y0 + ((dem.ny - 1) * dem.cell) / 2, z0: dem.zmin, size: Math.max(dem.nx, dem.ny) * dem.cell };
    const pts = (routes ?? []).flatMap((r) => r.points);
    if (!pts.length) return null;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, z0: Math.min(...pts.map((p) => p.z)), size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.2 };
  }, [dem, routes]);

  useEffect(() => {
    if (ref0) setCam((c) => ({ ...c, dist: ref0.size * 1.1, tx: 0, ty: 0 }));
  }, [ref0?.size]); // eslint-disable-line react-hooks/exhaustive-deps

  // contexto e programas
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext('webgl2', { antialias: true });
    if (!gl) {
      setErr('Este navegador não suporta WebGL2. Use a vista 2D.');
      return;
    }
    try {
      glRef.current = { gl, terrain: compile(gl, TERRAIN_VS, TERRAIN_FS), flat: compile(gl, FLAT_VS, FLAT_FS), buf: {} };
    } catch (e) {
      setErr(`Falha ao iniciar o 3D: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const W = (p: { x: number; y: number }, z: number) => (ref0 ? [p.x - ref0.cx, p.y - ref0.cy, (z - ref0.z0) * exag] : [0, 0, 0]);

  function upload(name: string, prog: WebGLProgram, attrs: Record<string, { data: Float32Array; size: number }>, count: number, mode: number, index?: Uint32Array) {
    const g = glRef.current!;
    const gl = g.gl;
    const old = g.buf[name];
    if (old) {
      for (const b of old.buffers) gl.deleteBuffer(b);
      gl.deleteVertexArray(old.vao);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    for (const [k, a] of Object.entries(attrs)) {
      const loc = gl.getAttribLocation(prog, k);
      if (loc < 0) continue;
      const b = gl.createBuffer()!;
      buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, a.data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, 0, 0);
    }
    if (index) {
      const b = gl.createBuffer()!;
      buffers.push(b);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    g.buf[name] = { vao, count, mode, buffers };
  }

  // terreno
  useEffect(() => {
    const g = glRef.current;
    if (!g || !ref0) return;
    const gl = g.gl;
    if (!dem) {
      g.buf.terrain = null;
      return;
    }
    const { nx, ny, cell } = dem;
    const pos = new Float32Array(nx * ny * 3);
    const nrm = new Float32Array(nx * ny * 3);
    const col = new Float32Array(nx * ny * 3);
    const zr = dem.zmax - dem.zmin || 1;
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const i = iy * nx + ix;
        const z = dem.z[i];
        const w = W({ x: dem.x0 + ix * cell, y: dem.y0 + iy * cell }, z);
        pos.set(w, i * 3);
        const zl = dem.z[iy * nx + Math.max(0, ix - 1)];
        const zrr = dem.z[iy * nx + Math.min(nx - 1, ix + 1)];
        const zd = dem.z[Math.max(0, iy - 1) * nx + ix];
        const zu = dem.z[Math.min(ny - 1, iy + 1) * nx + ix];
        const dx = ((zrr - zl) * exag) / (2 * cell);
        const dy = ((zu - zd) * exag) / (2 * cell);
        const l = Math.hypot(dx, dy, 1);
        nrm.set([-dx / l, -dy / l, 1 / l], i * 3);
        col.set(ramp((z - dem.zmin) / zr), i * 3);
      }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for (let iy = 0; iy < ny - 1; iy++)
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iy * nx + ix;
        idx.set([a, a + 1, a + nx, a + 1, a + nx + 1, a + nx], k);
        k += 6;
      }
    upload('terrain', g.terrain, { pos: { data: pos, size: 3 }, nrm: { data: nrm, size: 3 }, col: { data: col, size: 3 } }, idx.length, gl.TRIANGLES, idx);
    draw();
  }, [dem, ref0, exag]); // eslint-disable-line react-hooks/exhaustive-deps

  // contornos e rotas (faixas de 6 m)
  useEffect(() => {
    const g = glRef.current;
    if (!g || !ref0) return;
    const gl = g.gl;
    const zAt = (x: number, y: number, fallback: number) => (dem ? Math.max(sampleDem(dem, x, y), fallback) : fallback);
    // contornos: linhas
    const lp: number[] = [];
    const lc: number[] = [];
    for (const poly of overlays?.polygons ?? []) {
      const c = hex(poly.stroke.slice(0, 7));
      for (let i = 0; i < poly.ring.length; i++) {
        const a = poly.ring[i];
        const b = poly.ring[(i + 1) % poly.ring.length];
        for (const p of [a, b]) {
          lp.push(...W({ x: p[0], y: p[1] }, zAt(p[0], p[1], -Infinity) + 1.5));
          lc.push(...c);
        }
      }
    }
    upload('outlines', g.flat, { pos: { data: new Float32Array(lp), size: 3 }, col: { data: new Float32Array(lc), size: 3 } }, lp.length / 3, gl.LINES);
    // rotas: faixas
    const rp: number[] = [];
    const rc: number[] = [];
    const all = [...(routes ?? []).map((r) => ({ points: r.points, color: r.color ?? '#3d3c37' })), ...(overlays?.paths ?? [])];
    for (const r of all) {
      const c = hex(r.color.slice(0, 7));
      const pts = r.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        const ox = (-dy / l) * 3;
        const oy = (dx / l) * 3;
        const za = Math.max(a.z, zAt(a.x, a.y, a.z) - 0.5) + 1.2;
        const zb = Math.max(b.z, zAt(b.x, b.y, b.z) - 0.5) + 1.2;
        const q = [W({ x: a.x + ox, y: a.y + oy }, za), W({ x: a.x - ox, y: a.y - oy }, za), W({ x: b.x + ox, y: b.y + oy }, zb), W({ x: b.x - ox, y: b.y - oy }, zb)];
        for (const v of [q[0], q[1], q[2], q[1], q[3], q[2]]) {
          rp.push(...v);
          rc.push(...c);
        }
      }
    }
    upload('routes', g.flat, { pos: { data: new Float32Array(rp), size: 3 }, col: { data: new Float32Array(rc), size: 3 } }, rp.length / 3, gl.TRIANGLES);
    draw();
  }, [overlays, routes, dem, ref0, exag]); // eslint-disable-line react-hooks/exhaustive-deps

  // caminhões e equipamentos de carga, em escala (caixas orientadas)
  useEffect(() => {
    const g = glRef.current;
    if (!g || !ref0) return;
    const p: number[] = [];
    const c: number[] = [];
    const groundAt = (x: number, y: number, z: number) => Math.max(z, dem ? sampleDem(dem, x, y) - 0.5 : z);
    /** caixa centrada em (cx, cy) ao longo do eixo `h`, do deslocamento a0..a1 (m) no eixo, largura w, de z0 a z1 */
    const box = (cx: number, cy: number, h: number, a0: number, a1: number, w: number, z0: number, z1: number, col: [number, number, number]) => {
      const ux = Math.cos(h);
      const uy = Math.sin(h);
      const vx = -uy;
      const vy = ux;
      const corner = (a: number, b: number, z: number) => W({ x: cx + ux * a + vx * b, y: cy + uy * a + vy * b }, z);
      const P = [
        corner(a0, -w / 2, z0), corner(a1, -w / 2, z0), corner(a1, w / 2, z0), corner(a0, w / 2, z0),
        corner(a0, -w / 2, z1), corner(a1, -w / 2, z1), corner(a1, w / 2, z1), corner(a0, w / 2, z1),
      ];
      const faces: [number[], number][] = [
        [[4, 5, 6, 7], 1], // topo
        [[0, 1, 5, 4], 0.72],
        [[1, 2, 6, 5], 0.85],
        [[2, 3, 7, 6], 0.72],
        [[3, 0, 4, 7], 0.6],
      ];
      for (const [f, k] of faces) {
        const cc = [col[0] * k, col[1] * k, col[2] * k];
        for (const i of [f[0], f[1], f[2], f[0], f[2], f[3]]) {
          p.push(...P[i]);
          c.push(...cc);
        }
      }
    };
    const k = enlarge;
    const T = EQUIP_SIZE.truck;
    for (const d of dots ?? []) {
      const z = groundAt(d.p.x, d.p.y, d.p.z);
      const L = T.length * k;
      const Wd = T.width * k;
      const col = hex(DOT_COLORS[d.kind]);
      // caçamba (cor do estado) e cabine (escura) na frente
      box(d.p.x, d.p.y, d.heading, -L / 2, L / 2 - L * 0.24, Wd, z + 0.9 * k, z + T.height * 0.8 * k, col);
      box(d.p.x, d.p.y, d.heading, L / 2 - L * 0.22, L / 2, Wd * 0.95, z + 0.9 * k, z + T.height * k, [0.12, 0.13, 0.15]);
      if (d.loaded) box(d.p.x, d.p.y, d.heading, -L / 2 + 0.6 * k, L / 2 - L * 0.3, Wd * 0.7, z + T.height * 0.8 * k, z + T.height * 0.95 * k, [0.55, 0.36, 0.2]);
    }
    const Ld = EQUIP_SIZE.loader;
    for (const l of loaders ?? []) {
      const z = groundAt(l.p.x, l.p.y, l.p.z);
      const L = Ld.length * k;
      const Wd = Ld.width * k;
      box(l.p.x, l.p.y, l.heading, -L / 2, L / 2 - L * 0.25, Wd, z + 0.6 * k, z + Ld.height * k, hex(LOADER_COLORS[l.state]));
      box(l.p.x, l.p.y, l.heading, L / 2 - L * 0.25, L / 2, Wd * 1.15, z, z + 1.4 * k, [0.25, 0.26, 0.28]);
    }
    upload('dots', g.flat, { pos: { data: new Float32Array(p), size: 3 }, col: { data: new Float32Array(c), size: 3 } }, p.length / 3, g.gl.TRIANGLES);
    draw();
  }, [dots, loaders, dem, ref0, exag, enlarge]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => draw(), [cam]); // eslint-disable-line react-hooks/exhaustive-deps

  function draw() {
    const g = glRef.current;
    const cv = ref.current;
    if (!g || !cv || !ref0) return;
    const gl = g.gl;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.925, 0.92, 0.894, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const zc = dem ? ((dem.zmax + dem.zmin) / 2 - ref0.z0) * exag : 0;
    const target = [cam.tx, cam.ty, zc];
    const eye = [
      target[0] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      target[1] - cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
      target[2] + cam.dist * Math.sin(cam.pitch),
    ];
    const mvp = mul(perspective(0.8, w / Math.max(1, h), cam.dist / 200, cam.dist * 20), lookAt(eye, target, [0, 0, 1]));
    const t = g.buf.terrain;
    if (t) {
      gl.useProgram(g.terrain);
      gl.uniformMatrix4fv(gl.getUniformLocation(g.terrain, 'mvp'), false, mvp);
      gl.bindVertexArray(t.vao);
      gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, 0);
    }
    gl.useProgram(g.flat);
    gl.uniformMatrix4fv(gl.getUniformLocation(g.flat, 'mvp'), false, mvp);
    gl.uniform1f(gl.getUniformLocation(g.flat, 'round'), 0);
    gl.uniform1f(gl.getUniformLocation(g.flat, 'ps'), 1);
    for (const n of ['outlines', 'routes']) {
      const b = g.buf[n];
      if (!b || !b.count) continue;
      gl.bindVertexArray(b.vao);
      gl.drawArrays(b.mode, 0, b.count);
    }
    const d = g.buf.dots;
    if (d && d.count) {
      gl.bindVertexArray(d.vao);
      gl.drawArrays(gl.TRIANGLES, 0, d.count);
    }
    gl.bindVertexArray(null);
  }

  useEffect(() => {
    const cv = ref.current;
    if (!cv || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(cv);
    return () => ro.disconnect();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <div className="flex items-center justify-center rounded-xl border border-black/[0.07] bg-[#F4F3EE] p-6 text-sm text-black/55" style={{ height }}>{err}</div>;

  return (
    <div className="relative overflow-hidden rounded-xl border border-black/[0.07]" style={{ height, position: 'relative' }}>
      <canvas
        ref={ref}
        className="h-full w-full"
        style={{ width: '100%', height: '100%', display: 'block', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none' }}
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2, c: cam };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (d.pan) {
            const k = d.c.dist / 600;
            const cy = Math.cos(d.c.yaw);
            const sy = Math.sin(d.c.yaw);
            // direita da tela = (cos, sen); frente = (−sen, cos)
            setCam({ ...d.c, tx: d.c.tx - dx * cy * k - dy * sy * k, ty: d.c.ty - dx * sy * k + dy * cy * k });
          } else setCam({ ...d.c, yaw: d.c.yaw - dx * 0.006, pitch: Math.max(0.12, Math.min(1.52, d.c.pitch + dy * 0.005)) });
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => setCam((c) => ({ ...c, dist: Math.max(50, Math.min((ref0?.size ?? 1000) * 4, c.dist * Math.exp(e.deltaY * 0.0012))) }))}
        role="img"
        aria-label="Vista 3D: arraste para girar, Shift + arrastar para mover, roda do mouse para aproximar"
      />
      {!dem && (
        <p className="absolute top-3 left-3 max-w-sm rounded-lg bg-white/90 px-3 py-2 text-xs text-black/60 shadow-sm">
          Sem superfície carregada: importe a topografia (3DFACE ou curvas) na aba Circuito para ver o terreno em 3D.
        </p>
      )}
      <div className="absolute top-3 right-3 flex items-center gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs shadow-sm">
        <label className="flex items-center gap-1.5">
          Exagero vertical
          <select className="rounded border border-black/10 px-1 py-0.5" value={exag} onChange={(e) => setExag(Number(e.target.value))}>
            {[1, 1.5, 2, 3, 5].map((v) => (
              <option key={v} value={v}>{v}×</option>
            ))}
          </select>
        </label>
        {(dots || loaders) && (
          <label className="flex items-center gap-1.5">
            Equipamentos
            <select className="rounded border border-black/10 px-1 py-0.5" value={enlarge} onChange={(e) => setEnlarge(Number(e.target.value))}>
              <option value={1}>em escala</option>
              <option value={3}>ampliados 3×</option>
              <option value={8}>ampliados 8×</option>
            </select>
          </label>
        )}
        <button type="button" className="rounded px-1.5 py-0.5 font-medium hover:bg-black/5" onClick={() => ref0 && setCam({ yaw: -0.6, pitch: 0.75, dist: ref0.size * 1.1, tx: 0, ty: 0 })}>
          Enquadrar
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-black/45">Arraste para girar · Shift + arrastar para mover · roda para aproximar</p>
    </div>
  );
};

export default View3D;
