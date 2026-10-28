/**
 * Figuras e fórmulas dos relatórios desenhadas em canvas (só no navegador) e devolvidas como PNG.
 * Gráficos no padrão do relatório (cores das configurações, meta em vermelho tracejado) e fórmulas
 * montadas com fração, somatório, expoente e arredondamento para cima.
 */
import type { ReportData } from './data';
import type { EqKey, FigureKey } from './content';
import { STATE_ORDER } from './content';
import type { RenderedImage } from './docx';
import { fmt } from './theme';

const INK = '#1E2B30';
const MUTED = '#5E6B70';
const GRID = '#E3DED4';
const RED = '#B23A2E';
const SANS = 'Arial, Helvetica, sans-serif';
const SERIF = '"Cambria Math", "Cambria", "STIX Two Math", "Times New Roman", serif';
const hex = (c: string) => (c.startsWith('#') ? c : `#${c}`);
const PART_COLORS = ['#E9A56B', '#1E2B30', '#B9C3C7', '#C8641E', '#4F7F9C', '#EFE7D8', '#D8D2C6'];

function canvas(w: number, h: number, scale = 2) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d')!;
  g.scale(scale, scale);
  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, w, h);
  return { c, g };
}

async function toPng(c: HTMLCanvasElement, w: number, h: number): Promise<RenderedImage> {
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao gerar imagem'))), 'image/png'));
  return { data: new Uint8Array(await blob.arrayBuffer()), w, h };
}

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
function yAxis(g: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, max: number, label?: (v: number) => string) {
  g.font = `11px ${SANS}`;
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 5; i++) {
    const v = (max * i) / 5;
    const y = y0 - ((y0 - y1) * i) / 5;
    g.strokeStyle = GRID;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.fillStyle = MUTED;
    g.fillText(label ? label(v) : fmt(v), x0 - 6, y);
  }
}
function legend(g: CanvasRenderingContext2D, items: { label: string; color: string; dash?: boolean }[], x: number, y: number, maxW: number) {
  g.font = `11px ${SANS}`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  let cx = x;
  let cy = y;
  for (const it of items) {
    const w = 22 + g.measureText(it.label).width + 18;
    if (cx + w > x + maxW) {
      cx = x;
      cy += 18;
    }
    if (it.dash) {
      g.strokeStyle = it.color;
      g.lineWidth = 2;
      g.setLineDash([5, 3]);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + 16, cy);
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = it.color;
      g.fillRect(cx, cy - 5, 16, 10);
    }
    g.fillStyle = INK;
    g.fillText(it.label, cx + 22, cy);
    cx += w;
  }
  return cy + 12;
}
const trunc = (g: CanvasRenderingContext2D, s: string, w: number) => {
  if (g.measureText(s).width <= w) return s;
  let t = s;
  while (t.length > 3 && g.measureText(`${t}…`).width > w) t = t.slice(0, -1);
  return `${t}…`;
};

/** barras horizontais empilhadas (composição do ciclo) */
function stacked(rows: { label: string; parts: number[] }[], partLabels: string[], colors: string[]) {
  const W = 860;
  const rowH = 46;
  const H = 70 + rows.length * rowH + 40;
  const { c, g } = canvas(W, H);
  const x0 = 210;
  const x1 = W - 80;
  const total = Math.max(...rows.map((r) => r.parts.reduce((a, b) => a + b, 0)), 1);
  const max = niceMax(total * 1.05);
  const y0 = 20;
  const sx = (v: number) => ((x1 - x0) * v) / max;
  // grade
  g.font = `11px ${SANS}`;
  for (let i = 0; i <= 5; i++) {
    const xx = x0 + ((x1 - x0) * i) / 5;
    g.strokeStyle = GRID;
    g.beginPath();
    g.moveTo(xx, y0);
    g.lineTo(xx, y0 + rows.length * rowH);
    g.stroke();
    g.fillStyle = MUTED;
    g.textAlign = 'center';
    g.fillText(fmt((max * i) / 5), xx, y0 + rows.length * rowH + 14);
  }
  g.fillText('minutos por ciclo', (x0 + x1) / 2, y0 + rows.length * rowH + 30);
  rows.forEach((r, i) => {
    const y = y0 + i * rowH + 8;
    let xx = x0;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillStyle = INK;
    g.font = `12px ${SANS}`;
    g.fillText(trunc(g, r.label, x0 - 14), x0 - 8, y + 15);
    r.parts.forEach((v, k) => {
      const w = sx(v);
      if (w <= 0) return;
      g.fillStyle = colors[k];
      g.fillRect(xx, y, w, 30);
      g.strokeStyle = '#FFFFFF';
      g.strokeRect(xx, y, w, 30);
      if (w > 30) {
        g.fillStyle = ['#1E2B30', '#C8641E', '#4F7F9C'].includes(colors[k]) ? '#FFFFFF' : INK;
        g.font = `10px ${SANS}`;
        g.textAlign = 'center';
        g.fillText(fmt(v, 1), xx + w / 2, y + 15);
      }
      xx += w;
    });
    g.fillStyle = INK;
    g.font = `bold 12px ${SANS}`;
    g.textAlign = 'left';
    g.fillText(`${fmt(r.parts.reduce((a, b) => a + b, 0), 1)} min`, xx + 6, y + 15);
  });
  legend(
    g,
    partLabels.map((l, k) => ({ label: l, color: colors[k] })).filter((_, k) => rows.some((r) => r.parts[k] > 0.01)),
    40,
    y0 + rows.length * rowH + 50,
    W - 80,
  );
  return { c, W, H };
}

/** colunas agrupadas (categorias × séries), com linha de meta opcional */
function grouped(cats: string[], series: { label: string; color: string; values: (number | null)[] }[], opt: { target?: number; targetLabel?: string; yLabel?: (v: number) => string; valueLabel?: (v: number) => string; H?: number }) {
  const W = 860;
  const H = opt.H ?? 400;
  const { c, g } = canvas(W, H);
  const x0 = 70;
  const x1 = W - 20;
  const y0 = H - 60;
  const y1 = 50;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = niceMax(Math.max(...all, opt.target ?? 0) * 1.12);
  yAxis(g, x0, x1, y0, y1, max, opt.yLabel);
  const gw = (x1 - x0) / cats.length;
  const bw = Math.min(70, (gw * 0.8) / series.length);
  cats.forEach((cat, i) => {
    const gx = x0 + gw * i + (gw - bw * series.length) / 2;
    series.forEach((s, k) => {
      const v = s.values[i];
      if (v === null || v === undefined) return;
      const h = ((y0 - y1) * v) / max;
      g.fillStyle = hex(s.color);
      g.fillRect(gx + k * bw + 2, y0 - h, bw - 4, h);
      g.fillStyle = INK;
      g.font = `10px ${SANS}`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(opt.valueLabel ? opt.valueLabel(v) : fmt(v), gx + k * bw + bw / 2, y0 - h - 3);
    });
    g.fillStyle = MUTED;
    g.font = `11px ${SANS}`;
    g.textBaseline = 'top';
    g.fillText(trunc(g, cat, gw - 6), x0 + gw * i + gw / 2, y0 + 8);
  });
  const items = series.map((s) => ({ label: s.label, color: hex(s.color) }));
  if (opt.target) {
    const y = y0 - ((y0 - y1) * opt.target) / max;
    g.strokeStyle = RED;
    g.lineWidth = 2;
    g.setLineDash([7, 4]);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.setLineDash([]);
    items.push({ label: opt.targetLabel ?? 'meta', color: RED, dash: true } as never);
  }
  legend(g, items, x0, 18, x1 - x0);
  return { c, W, H };
}

function lineChart(points: { x: number; y: number; lo: number; hi: number }[], opt: { target?: number; color: string; xLabel: string; marks: { x: number; text: string }[] }) {
  const W = 860;
  const H = 400;
  const { c, g } = canvas(W, H);
  const x0 = 70;
  const x1 = W - 20;
  const y0 = H - 55;
  const y1 = 40;
  const max = niceMax(Math.max(...points.map((p) => p.hi), opt.target ?? 0) * 1.08);
  const xmax = Math.max(...points.map((p) => p.x)) + 1;
  yAxis(g, x0, x1, y0, y1, max);
  const X = (v: number) => x0 + ((x1 - x0) * v) / xmax;
  const Y = (v: number) => y0 - ((y0 - y1) * v) / max;
  g.fillStyle = hex(opt.color) + '30';
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.hi)) : g.moveTo(X(p.x), Y(p.hi))));
  [...points].reverse().forEach((p) => g.lineTo(X(p.x), Y(p.lo)));
  g.closePath();
  g.fill();
  g.strokeStyle = hex(opt.color);
  g.lineWidth = 2.5;
  g.beginPath();
  points.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
  g.stroke();
  g.fillStyle = hex(opt.color);
  points.forEach((p) => {
    g.beginPath();
    g.arc(X(p.x), Y(p.y), 3, 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = MUTED;
  g.font = `11px ${SANS}`;
  g.textAlign = 'center';
  g.textBaseline = 'top';
  const step = Math.max(1, Math.ceil(xmax / 12));
  for (let v = step; v < xmax; v += step) g.fillText(String(v), X(v), y0 + 6);
  g.fillText(opt.xLabel, (x0 + x1) / 2, y0 + 26);
  if (opt.target) {
    g.strokeStyle = RED;
    g.lineWidth = 2;
    g.setLineDash([7, 4]);
    g.beginPath();
    g.moveTo(x0, Y(opt.target));
    g.lineTo(x1, Y(opt.target));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = RED;
    g.font = `bold 11px ${SANS}`;
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText(`meta ${fmt(opt.target)} t/dia`, x0 + 8, Y(opt.target) - 4);
  }
  g.font = `11px ${SANS}`;
  g.fillStyle = INK;
  opt.marks.forEach((m, i) => {
    const p = points.find((q) => q.x === m.x);
    if (!p) return;
    const tx = Math.max(x0 + 10, X(m.x) - 260);
    const ty = Y(p.y) + 30 + i * 34;
    g.strokeStyle = MUTED;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(X(m.x), Y(p.y));
    g.lineTo(tx + 250, ty);
    g.stroke();
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(m.text, tx + 246, ty + 10);
  });
  return { c, W, H };
}

const CYCLE_LABELS = ['Carga', 'Viagem carregado', 'Pesagem', 'Basculamento + manobra', 'Viagem vazio', 'Fila fixa', 'Outras paradas'];
const cycleParts = (p: { loadMin: number; loadedMin: number; weighMin: number; dumpMin: number; emptyMin: number; queueMin: number; otherMin: number }) => [p.loadMin, p.loadedMin, p.weighMin, p.dumpMin, p.emptyMin, p.queueMin, p.otherMin];

export async function renderFigure(key: FigureKey, d: ReportData): Promise<RenderedImage | null> {
  const cs = d.configs;
  let r: { c: HTMLCanvasElement; W: number; H: number } | null = null;
  if (key === 'cycleStatic' && cs.length) r = stacked(cs.map((c) => ({ label: `${c.tag} · ${c.name}`, parts: cycleParts(c.cycle) })), CYCLE_LABELS, PART_COLORS);
  if (key === 'cycleRoutes' && d.statik.movements.length) r = stacked(d.statik.movements.map((m) => ({ label: m.name, parts: cycleParts(m.cycle) })), CYCLE_LABELS, PART_COLORS);
  if (key === 'cycleSim') {
    const withBase = cs.filter((c) => c.base);
    if (withBase.length) {
      const states = STATE_ORDER.filter((s) => withBase.some((c) => (c.base!.cycle[s] ?? 0) > 0.05));
      const palette = ['#F2C7A0', '#E9A56B', '#1E2B30', '#D7C5E0', '#B9C3C7', '#B23A2E', '#C8641E', '#4F7F9C', '#9AA7AC', '#D8D2C6', '#C7D9C4', '#E8D9A8', '#BFD8D5'];
      r = stacked(
        withBase.map((c) => ({ label: `${c.tag} · ${c.name}`, parts: states.map((s) => c.base!.cycle[s] ?? 0) })),
        states.map((s) => d.stateLabels[s]),
        states.map((_, i) => palette[i % palette.length]),
      );
    }
  }
  if (key === 'simTpd') {
    const scen = d.sim.scenarios.filter((s) => cs.some((c) => c.matrix.some((m) => m.scenarioId === s.id)));
    if (scen.length)
      r = grouped(
        scen.map((s) => s.name),
        cs.map((c) => ({ label: `${c.tag} · ${c.name}`, color: c.color, values: scen.map((s) => c.matrix.find((m) => m.scenarioId === s.id)?.tpd ?? null) })),
        { target: d.sim.targetTpd, targetLabel: `meta ${fmt(d.sim.targetTpd)} t/dia`, valueLabel: (v) => fmt(v / 1000, 1), yLabel: (v) => fmt(v) },
      );
  }
  if (key === 'fleets' && cs.length) {
    const cats = ['Conta estática', 'Frota mínima simulada'];
    r = grouped(
      cats,
      cs.map((c) => ({ label: `${c.tag} · ${c.name}`, color: c.color, values: [c.staticTrucks, c.minFleet?.total ?? null] })),
      { H: 340 },
    );
  }
  if (key === 'cost' && cs.length) {
    const cats = ['Custo por tonelada (planejamento)', ...(d.decision ? ['Custo nivelado no horizonte'] : [])];
    r = grouped(
      cats,
      cs.map((c) => ({ label: `${c.tag} · ${c.name}`, color: c.color, values: [c.cost.perT, ...(d.decision ? [c.decision?.costPerT ?? null] : [])] })),
      { H: 340, valueLabel: (v) => `R$ ${fmt(v, 2)}`, yLabel: (v) => `R$ ${fmt(v, 0)}` },
    );
  }
  if (key === 'sweep' && d.sweep?.points.length) {
    const sw = d.sweep;
    const last = sw.points[sw.points.length - 1];
    r = lineChart(
      sw.points.map((p) => ({ x: p.trucks, y: p.tpd, lo: p.lo, hi: p.hi })),
      {
        target: sw.target,
        color: '#2B5F80',
        xLabel: 'caminhões no circuito',
        marks: [
          { x: sw.saturation, text: `${sw.saturation} caminhões: saturação` },
          { x: last.trucks, text: `${last.trucks} caminhões: ${fmt(last.tpd)} t/dia` },
        ].filter((m, i, a) => a.findIndex((q) => q.x === m.x) === i),
      },
    );
  }
  if (key === 'decisionPeriods' && d.decision?.chosenPeriods.length) {
    const ps = d.decision.chosenPeriods;
    const chosen = d.decision.rows.find((x) => x.id === d.decision!.chosenId);
    const color = cs.find((c) => c.id === chosen?.configId)?.color ?? '2B5F80';
    r = grouped(
      ps.map((p) => p.label),
      [{ label: `Custo do período – ${chosen?.name ?? ''}`, color, values: ps.map((p) => p.total / 1e6) }],
      { H: 320, valueLabel: (v) => fmt(v, 1), yLabel: (v) => `${fmt(v)} mi` },
    );
  }
  return r ? toPng(r.c, r.W, r.H) : null;
}

/* --------------------------------- fórmulas --------------------------------- */
type Eq = string | Eq[] | { frac: [Eq, Eq] } | { sum: { lo?: string; hi?: string } } | { sup: [Eq, Eq] } | { ceil: Eq };
interface Box {
  w: number;
  asc: number;
  desc: number;
  draw: (g: CanvasRenderingContext2D, x: number, y: number) => void;
}

function layout(g: CanvasRenderingContext2D, e: Eq, size: number): Box {
  if (typeof e === 'string') {
    g.font = `${size}px ${SERIF}`;
    const w = g.measureText(e).width;
    return {
      w,
      asc: size * 0.75,
      desc: size * 0.25,
      draw: (gg, x, y) => {
        gg.font = `${size}px ${SERIF}`;
        gg.fillText(e, x, y);
      },
    };
  }
  if (Array.isArray(e)) {
    const kids = e.map((k) => layout(g, k, size));
    const gap = size * 0.18;
    return {
      w: kids.reduce((a, k) => a + k.w, 0) + gap * Math.max(0, kids.length - 1),
      asc: Math.max(...kids.map((k) => k.asc), 0),
      desc: Math.max(...kids.map((k) => k.desc), 0),
      draw: (gg, x, y) => {
        let cx = x;
        for (const k of kids) {
          k.draw(gg, cx, y);
          cx += k.w + gap;
        }
      },
    };
  }
  if ('frac' in e) {
    const s = size * 0.86;
    const n = layout(g, e.frac[0], s);
    const dd = layout(g, e.frac[1], s);
    const w = Math.max(n.w, dd.w) + size * 0.4;
    const axis = size * 0.3;
    const pad = size * 0.14;
    return {
      w,
      asc: axis + pad + n.desc + n.asc,
      desc: -axis + pad + dd.asc + dd.desc,
      draw: (gg, x, y) => {
        n.draw(gg, x + (w - n.w) / 2, y - axis - pad - n.desc);
        dd.draw(gg, x + (w - dd.w) / 2, y - axis + pad + dd.asc);
        gg.fillRect(x + size * 0.08, y - axis - 0.7, w - size * 0.16, 1.4);
      },
    };
  }
  if ('sum' in e) {
    const s = size * 1.5;
    g.font = `${s}px ${SERIF}`;
    const w = g.measureText('∑').width;
    const lo = e.sum.lo ? layout(g, e.sum.lo, size * 0.6) : null;
    const hi = e.sum.hi ? layout(g, e.sum.hi, size * 0.6) : null;
    const ww = Math.max(w, lo?.w ?? 0, hi?.w ?? 0);
    return {
      w: ww,
      asc: s * 0.75 + (hi ? hi.asc + hi.desc : 0),
      desc: s * 0.2 + (lo ? lo.asc + lo.desc : 0),
      draw: (gg, x, y) => {
        gg.font = `${s}px ${SERIF}`;
        gg.fillText('∑', x + (ww - w) / 2, y + s * 0.18);
        hi?.draw(gg, x + (ww - hi.w) / 2, y - s * 0.8);
        lo?.draw(gg, x + (ww - lo.w) / 2, y + s * 0.2 + lo.asc + 2);
      },
    };
  }
  if ('sup' in e) {
    const b = layout(g, e.sup[0], size);
    const p = layout(g, e.sup[1], size * 0.62);
    return {
      w: b.w + p.w + 2,
      asc: Math.max(b.asc, size * 0.5 + p.asc),
      desc: b.desc,
      draw: (gg, x, y) => {
        b.draw(gg, x, y);
        p.draw(gg, x + b.w + 2, y - size * 0.5);
      },
    };
  }
  // ceil
  const inner = layout(g, e.ceil, size);
  const pad = size * 0.25;
  return {
    w: inner.w + pad * 2 + 4,
    asc: inner.asc + 3,
    desc: inner.desc + 3,
    draw: (gg, x, y) => {
      inner.draw(gg, x + pad + 2, y);
      gg.lineWidth = 1.4;
      gg.beginPath();
      gg.moveTo(x + pad, y + inner.desc + 2);
      gg.lineTo(x + 2, y + inner.desc + 2);
      gg.lineTo(x + 2, y - inner.asc - 2);
      gg.lineTo(x + pad, y - inner.asc - 2);
      gg.moveTo(x + pad + inner.w + 4, y + inner.desc + 2);
      gg.lineTo(x + inner.w + pad * 2 + 2, y + inner.desc + 2);
      gg.lineTo(x + inner.w + pad * 2 + 2, y - inner.asc - 2);
      gg.lineTo(x + pad + inner.w + 4, y - inner.asc - 2);
      gg.stroke();
    },
  };
}

const EQS: Record<EqKey, Eq> = {
  eq_meta: ['Meta por dia', '=', { frac: ['meta do mês (t)', 'dias de operação'] }],
  eq_hours: ['Horas efetivas', '=', 'dias', '×', 'horas/dia', '×', 'DF', '×', 'UF'],
  eq_cycle: ['Ciclo', '=', 'carga + viagem carregado + pesagem + descarga + viagem vazio + fila'],
  eq_prod: ['Produção de 1 caminhão (t/h)', '=', { frac: [['carga útil (t)', '×', '60'], 'ciclo (min)'] }],
  eq_frota: ['Frota', '=', { ceil: { frac: ['massa do mês (t)', ['produção (t/h)', '×', 'horas efetivas (h)']] } }],
  eq_pmeta: ['% da meta', '=', { frac: ['t/dia simulada', 'meta (t/dia)'] }],
  eq_custo: ['Custo do mês', '=', 'n × custo fixo × horas do mês', '+', 'n × horas efetivas × custo operacional'],
  eq_rpt: ['R$/t', '=', { frac: ['custo do mês', 'toneladas do mês'] }],
  eq_nivel: ['Custo nivelado (R$/t)', '=', { frac: ['VPL dos custos', 'VPL das toneladas'] }],
  eq_vpl: ['VPL', '=', { sum: { lo: 't = 1', hi: 'n' } }, { frac: ['valor do período t', { sup: ['(1 + i)', 't − 0,5'] }] }],
  eq_cap: ['Capacidade da descarga (t/h)', '=', 'pontos', '×', { frac: [['carga útil', '×', '60'], 'basculamento + manobra'] }],
  eq_ocup: ['Ocupação', '=', { frac: ['chegada média (t/h)', 'capacidade da descarga (t/h)'] }],
};

export async function renderEquation(key: EqKey): Promise<RenderedImage> {
  const size = 20;
  const probe = document.createElement('canvas').getContext('2d')!;
  const b = layout(probe, EQS[key], size);
  const W = Math.ceil(b.w + 24);
  const H = Math.ceil(b.asc + b.desc + 20);
  const { c, g } = canvas(W, H, 3);
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  b.draw(g, 12, 10 + b.asc);
  return toPng(c, W, H);
}

/** Todas as imagens de um relatório (figuras e fórmulas). */
export async function renderAll(d: ReportData, figures: FigureKey[], equations: EqKey[]) {
  const out: Record<string, RenderedImage> = {};
  for (const k of figures) {
    const im = await renderFigure(k, d);
    if (im) out[k] = im;
  }
  for (const k of equations) out[k] = await renderEquation(k);
  return out;
}
