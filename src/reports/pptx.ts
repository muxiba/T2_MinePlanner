/**
 * Apresentação (.pptx) escrita direto em PresentationML, no mesmo padrão do relatório:
 * capa com indicadores, um passo por slide, caixas de memória de cálculo / dado do software / como ler,
 * gráficos e fórmulas como imagem, e a escolha no fim.
 */
import type { ReportConfig, ReportData } from './data';
import { cfgHeads, short } from './content';
import type { ImageSet } from './docx';
import { APP, ROOT_RELS, core } from './docx';
import { makeZip, x } from './zip';
import { ACC, ACCD, BLUE, INK, MEMO_FILL, MUTED, PAPER, READ_FILL, REC_FILL, SW, SW_FILL, TOTAL_FILL, brl, dateBR, fmt, lighten, mi, minutes, pct } from './theme';

const EMU = 914400;
const SW_IN = 13.333;
const SH_IN = 7.5;
const e = (inch: number) => Math.round(inch * EMU);

interface Run {
  t: string;
  b?: boolean;
  color?: string;
  sz?: number;
  i?: boolean;
}
interface Para {
  runs: Run[];
  align?: 'l' | 'ctr' | 'r';
  space?: number;
  bullet?: boolean;
}
const rich = (s: string, base: Omit<Run, 't'> = {}): Run[] =>
  s
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith('**') && p.endsWith('**') ? { ...base, t: p.slice(2, -2), b: true } : { ...base, t: p }));

class Slide {
  shapes: string[] = [];
  rels: { id: string; target: string }[] = [];
  private id = 2;
  constructor(public bg: string = PAPER, public notes = '') {}
  private nextId() {
    return this.id++;
  }
  rect(xi: number, yi: number, wi: number, hi: number, fill: string, opt: { line?: string; lineW?: number } = {}) {
    const id = this.nextId();
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="r${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${e(xi)}" y="${e(yi)}"/><a:ext cx="${e(wi)}" cy="${e(hi)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${
        opt.line ? `<a:ln w="${Math.round((opt.lineW ?? 1) * 12700)}"><a:solidFill><a:srgbClr val="${opt.line}"/></a:solidFill></a:ln>` : '<a:ln><a:noFill/></a:ln>'
      }</p:spPr></p:sp>`,
    );
  }
  text(xi: number, yi: number, wi: number, hi: number, paras: Para[], opt: { fill?: string; inset?: number; anchor?: 't' | 'ctr' | 'b'; autofit?: boolean } = {}) {
    const id = this.nextId();
    const ins = e(opt.inset ?? 0.05);
    const body = paras
      .map(
        (p) =>
          `<a:p><a:pPr algn="${p.align ?? 'l'}"${p.bullet ? ' marL="228600" indent="-228600"' : ''}><a:spcAft><a:spcPts val="${Math.round((p.space ?? 4) * 100)}"/></a:spcAft>${p.bullet ? `<a:buClr><a:srgbClr val="${ACC}"/></a:buClr><a:buFont typeface="Arial"/><a:buChar char="•"/>` : '<a:buNone/>'}</a:pPr>${p.runs
            .map(
              (r) =>
                `<a:r><a:rPr lang="pt-BR" sz="${Math.round((r.sz ?? 14) * 100)}" b="${r.b ? 1 : 0}" i="${r.i ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${r.color ?? INK}"/></a:solidFill><a:latin typeface="Arial"/><a:cs typeface="Arial"/></a:rPr><a:t>${x(r.t)}</a:t></a:r>`,
            )
            .join('')}<a:endParaRPr lang="pt-BR" sz="${Math.round(((p.runs[0]?.sz ?? 14) * 100))}" dirty="0"/></a:p>`,
      )
      .join('');
    this.shapes.push(
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${e(xi)}" y="${e(yi)}"/><a:ext cx="${e(wi)}" cy="${e(hi)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${
        opt.fill ? `<a:solidFill><a:srgbClr val="${opt.fill}"/></a:solidFill>` : '<a:noFill/>'
      }</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" anchor="${opt.anchor ?? 't'}">${opt.autofit === false ? '' : '<a:normAutofit/>'}</a:bodyPr><a:lstStyle/>${body}</p:txBody></p:sp>`,
    );
  }
  image(xi: number, yi: number, wi: number, hi: number, target: string) {
    const id = this.nextId();
    const rid = `rId${this.rels.length + 2}`;
    this.rels.push({ id: rid, target });
    this.shapes.push(
      `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="img${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${e(xi)}" y="${e(yi)}"/><a:ext cx="${e(wi)}" cy="${e(hi)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`,
    );
  }
  table(xi: number, yi: number, wi: number, head: string[], rows: string[][], opt: { colW?: number[]; headColors?: (string | undefined)[]; colFill?: Record<number, string>; rowFill?: Record<number, string>; total?: boolean; sz?: number; rowH?: number; leftCols?: number[] } = {}) {
    const id = this.nextId();
    const n = head.length;
    const fr = opt.colW ?? [0.34, ...Array(n - 1).fill(0.66 / Math.max(1, n - 1))];
    const cw = fr.map((f) => e(f * wi));
    const sz = Math.round((opt.sz ?? 12) * 100);
    const rowH = e(opt.rowH ?? 0.34);
    const left = (i: number) => (opt.leftCols ? opt.leftCols.includes(i) : i === 0);
    const tc = (t: string, i: number, fill: string | undefined, color: string, b: boolean) =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${left(i) ? 'l' : 'ctr'}"/>${rich(t)
        .map((r) => `<a:r><a:rPr lang="pt-BR" sz="${sz}" b="${b || r.b ? 1 : 0}" dirty="0"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${x(r.t)}</a:t></a:r>`)
        .join('')}</a:p></a:txBody><a:tcPr marL="68580" marR="68580" marT="34290" marB="34290" anchor="ctr"><a:lnL w="6350"><a:solidFill><a:srgbClr val="DDD5C7"/></a:solidFill></a:lnL><a:lnR w="6350"><a:solidFill><a:srgbClr val="DDD5C7"/></a:solidFill></a:lnR><a:lnT w="6350"><a:solidFill><a:srgbClr val="DDD5C7"/></a:solidFill></a:lnT><a:lnB w="6350"><a:solidFill><a:srgbClr val="DDD5C7"/></a:solidFill></a:lnB>${
        fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : '<a:noFill/>'
      }</a:tcPr></a:tc>`;
    const headRow = `<a:tr h="${rowH}">${head.map((h, i) => tc(h, i, opt.headColors?.[i] ?? INK, 'FFFFFF', true)).join('')}</a:tr>`;
    const body = rows
      .map((r, ri) => {
        const total = opt.total && ri === rows.length - 1;
        return `<a:tr h="${rowH}">${r.map((v, i) => tc(v, i, total ? TOTAL_FILL : opt.rowFill?.[ri] ?? opt.colFill?.[i] ?? (ri % 2 ? 'FAF8F4' : 'FFFFFF'), INK, !!total || (opt.colFill?.[i] === REC_FILL && i > 0))).join('')}</a:tr>`;
      })
      .join('');
    this.shapes.push(
      `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="tbl${id}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${e(xi)}" y="${e(yi)}"/><a:ext cx="${e(wi)}" cy="${rowH * (rows.length + 1)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${cw
        .map((w) => `<a:gridCol w="${w}"/>`)
        .join('')}</a:tblGrid>${headRow}${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    );
    return (opt.rowH ?? 0.34) * (rows.length + 1);
  }
  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${this.bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${this.shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }
}

/* ------------------------------ componentes ------------------------------ */
const M = 0.6; // margem
const CW = SW_IN - 2 * M;

function header(s: Slide, eyebrow: string, title: string) {
  s.text(M, 0.35, CW, 0.3, [{ runs: [{ t: eyebrow.toUpperCase(), b: true, color: ACCD, sz: 11 }] }], { autofit: false });
  s.text(M, 0.62, CW, 0.75, [{ runs: [{ t: title, b: true, sz: 24 }] }]);
  s.rect(M, 1.38, CW, 0.03, ACC);
}
function footer(s: Slide, d: ReportData, n: number) {
  s.text(M, SH_IN - 0.42, CW, 0.3, [{ runs: [{ t: `${d.opts.client ? `${d.opts.client} · ` : ''}${d.opts.title} · ${n}`, sz: 9, color: MUTED }] }], { autofit: false });
}
const BOXES = {
  memo: { color: ACC, fill: MEMO_FILL, title: 'MEMÓRIA DE CÁLCULO', tcolor: ACCD },
  sw: { color: SW, fill: SW_FILL, title: 'DADO EXPORTADO DO T2 MINEPLANNER', tcolor: SW },
  read: { color: BLUE, fill: READ_FILL, title: 'COMO LER', tcolor: BLUE },
};
function box(s: Slide, kind: keyof typeof BOXES, xi: number, yi: number, wi: number, hi: number, lines: string[], title?: string, sz = 12) {
  const b = BOXES[kind];
  s.rect(xi, yi, wi, hi, b.fill);
  s.rect(xi, yi, 0.08, hi, b.color);
  s.text(xi + 0.18, yi + 0.08, wi - 0.25, hi - 0.12, [{ runs: [{ t: `${b.title}${title ? ` · ${title.toUpperCase()}` : ''}`, b: true, color: b.tcolor, sz: 10 }], space: 6 }, ...lines.map((l) => ({ runs: rich(l, { sz }), space: 4 }))]);
}

/* ------------------------------ apresentação ------------------------------ */
export function buildPptx(d: ReportData, images: ImageSet = {}): Uint8Array {
  const slides: Slide[] = [];
  const media: { name: string; data: Uint8Array }[] = [];
  const cs = d.configs;
  const rec = d.recommended;
  const recFill = (off = 1) => {
    const i = cs.findIndex((c) => c === rec);
    return i >= 0 ? { [i + off]: REC_FILL } : {};
  };
  const heads = (before = 1) => [...Array(before).fill(undefined), ...cs.map((c) => c.color)];
  /** imagem encaixada na caixa, mantendo a proporção */
  const img = (s: Slide, key: string, xi: number, yi: number, wi: number, hi: number, frame = true) => {
    const im = images[key];
    if (!im) return 0;
    if (!media.some((m) => m.name === `${key}.png`)) media.push({ name: `${key}.png`, data: im.data });
    const r = Math.min(wi / im.w, hi / im.h);
    const w = im.w * r;
    const h = im.h * r;
    if (frame) s.rect(xi + (wi - w) / 2 - 0.08, yi - 0.06, w + 0.16, h + 0.12, 'FFFFFF');
    s.image(xi + (wi - w) / 2, yi, w, h, `../media/${key}.png`);
    return h;
  };
  const add = (s: Slide) => {
    slides.push(s);
    if (s.bg !== INK) footer(s, d, slides.length);
    return s;
  };

  /* 1. capa */
  {
    const s = new Slide(INK);
    s.rect(0, 0, SW_IN, 0.18, ACC);
    s.text(M, 0.7, CW, 0.4, [{ runs: [{ t: `${d.opts.client}${d.opts.company ? ` · ${d.opts.company}` : ''}`.toUpperCase(), b: true, color: 'E9A56B', sz: 13 }] }]);
    s.text(M, 1.4, CW, 1.6, [{ runs: [{ t: d.opts.title, b: true, color: 'F5F2EC', sz: 40 }] }]);
    s.text(M, 3.0, CW, 0.6, [{ runs: [{ t: d.opts.subtitle || 'Memorial de cálculo, resultados simulados e escolha do equipamento', color: 'BFCDD1', sz: 18 }] }]);
    const kp = rec
      ? [
          [rec.tag, `${short(rec.name, 40)} é a recomendação`],
          [fmt(rec.fleet), `caminhões (${rec.fleetSource})`],
          [brl(rec.cost.perT), 'custo por tonelada'],
          [rec.dump ? pct(rec.dump.occupancy) : fmt(d.target.dayT), rec.dump ? 'ocupação da descarga' : 't/dia de meta'],
        ]
      : [
          [fmt(d.target.monthT), 't/mês de meta'],
          [fmt(d.statik.needed), 'caminhões (conta estática)'],
          [pct(d.statik.ratio), 'atendimento'],
        ];
    const kw = (CW - 0.3 * (kp.length - 1)) / kp.length;
    kp.forEach(([v, l], i) => {
      const xx = M + i * (kw + 0.3);
      s.rect(xx, 4.2, kw, 1.5, '2A3A40');
      s.rect(xx, 4.2, kw, 0.07, ACC);
      s.text(xx + 0.15, 4.35, kw - 0.3, 0.7, [{ runs: [{ t: v, b: true, color: 'E9A56B', sz: 30 }] }]);
      s.text(xx + 0.15, 5.05, kw - 0.3, 0.6, [{ runs: [{ t: l, color: 'DCE4E6', sz: 12 }] }]);
    });
    s.text(M, 6.6, CW, 0.4, [{ runs: [{ t: `Base: T2 MinePlanner · ${d.periodLabel} · ${dateBR(d.generatedAt)}${d.opts.author ? ` · ${d.opts.author}` : ''}`, color: '9FB0B5', sz: 11 }] }]);
    add(s);
  }

  /* 2. resumo */
  if (rec) {
    const s = add(new Slide());
    header(s, 'Resumo executivo', `Recomendação: ${rec.tag} – ${short(rec.name, 60)}`);
    const rows: string[][] = [
      ['Carga útil', ...cs.map((c) => `${fmt(c.payloadT, 1)} t`)],
      ['Ciclo (conta estática)', ...cs.map((c) => minutes(c.cycle.cycleMin))],
      ['Frota estática', ...cs.map((c) => fmt(c.staticTrucks))],
      ...(cs.some((c) => c.minFleet) ? [['Frota mínima simulada', ...cs.map((c) => (c.minFleet ? fmt(c.minFleet.total) : '—'))]] : []),
      ...(cs.some((c) => c.base) ? [['Produção simulada (% da meta)', ...cs.map((c) => (c.base ? pct(c.base.tpd / d.sim.targetTpd) : '—'))]] : []),
      ['Ocupação da descarga', ...cs.map((c) => (c.dump ? pct(c.dump.occupancy) : '—'))],
      ['Custo por tonelada', ...cs.map((c) => brl(c.cost.perT))],
      ...(cs.some((c) => c.price > 0) ? [['Investimento na frota', ...cs.map((c) => mi(c.cost.invest))]] : []),
      ...(d.decision ? [['Custo nivelado no horizonte', ...cs.map((c) => (c.decision ? brl(c.decision.costPerT) : '—'))]] : []),
    ];
    const h = s.table(M, 1.6, CW, ['Indicador', ...cfgHeads(cs)], rows, { headColors: heads(), colFill: recFill(), sz: 12, rowH: 0.4 });
    box(s, 'read', M, 1.75 + h, CW, Math.max(0.8, SH_IN - 2.4 - h), [d.conclusion]);
  }

  /* 3. meta e premissas */
  {
    const s = add(new Slide());
    header(s, 'Passo 1 · A meta', `${fmt(d.target.monthT)} t no mês, ${fmt(d.target.dayT)} t por dia de operação`);
    const h = img(s, 'eq_meta', M, 1.65, CW, 0.75);
    const y = 1.75 + h + 0.2;
    const hpd = d.hours.hoursPerDay;
    box(s, 'memo', M, y, CW / 2 - 0.15, SH_IN - y - 0.6, [
      `Meta por dia = ${fmt(d.target.monthT)} ÷ ${fmt(d.hours.workDays, 1)} = **${fmt(d.target.dayT, 1)} t/dia**`,
      `Por hora de operação = ${fmt(d.target.dayT, 1)} ÷ ${fmt(hpd, 1)} = **${fmt(d.target.dayT / Math.max(1, hpd), 1)} t/h**`,
      ...d.target.flows.slice(0, 5).map((f) => `${short(f.name, 34)}: **${fmt(f.tpd, 1)} t/dia**`),
    ]);
    box(
      s,
      'sw',
      M + CW / 2 + 0.15,
      y,
      CW / 2 - 0.15,
      SH_IN - y - 0.6,
      d.premises.slice(0, 9).map((p) => `${p.label}: **${p.raw !== undefined ? fmt(p.raw, Number.isInteger(p.raw) ? 0 : 1) : p.value} ${p.unit}**`),
      'premissas',
      11,
    );
  }

  /* 4. conta estática */
  {
    const s = add(new Slide());
    header(s, 'Passo 2 · Frota pela conta estática', `A conta estática pede ${fmt(d.statik.needed)} caminhões`);
    const h1 = img(s, 'eq_hours', M, 1.6, CW / 2 - 0.2, 0.55);
    img(s, 'eq_frota', M + CW / 2, 1.55, CW / 2, 0.75);
    const mv = d.statik.movements;
    const y = 1.6 + Math.max(h1, 0.75) + 0.25;
    const th = s.table(
      M,
      y,
      CW,
      ['Movimentação', 'Massa (t)', 'Ciclo (min)', 't/h cam.', 't/mês cam.', 'Exato', 'Frota'],
      [...mv.map((m) => [short(m.name, 40), fmt(m.massT), fmt(m.cycle.cycleMin, 1), fmt(m.tph, 2), fmt(m.truckMonthT), fmt(m.exact, 2), fmt(m.needed)]), ['Total', fmt(mv.reduce((a, m) => a + m.massT, 0)), '', '', '', fmt(mv.reduce((a, m) => a + m.exact, 0), 2), fmt(d.statik.needed)]],
      { colW: [0.34, 0.12, 0.1, 0.1, 0.12, 0.11, 0.11], total: true, sz: 11 },
    );
    box(s, 'memo', M, y + th + 0.2, CW, Math.max(0.8, SH_IN - y - th - 0.8), [
      `Horas efetivas = ${fmt(d.hours.workDays, 1)} × ${fmt(d.hours.hoursPerDay, 1)} × ${pct(d.hours.df)} × ${pct(d.hours.uf)} = **${fmt(d.hours.effectiveH, 1)} h**`,
      ...mv.slice(0, 3).map((m) => `${short(m.name, 30)}: ${fmt(m.payloadT, 1)} × 60 ÷ ${fmt(m.cycle.cycleMin, 2)} = ${fmt(m.tph, 2)} t/h → ${fmt(m.massT)} ÷ ${fmt(m.truckMonthT)} = ${fmt(m.exact, 2)} → **${fmt(m.needed)}**`),
    ]);
  }

  if (cs.length) {
    /* 5. configurações */
    {
      const s = add(new Slide());
      header(s, 'Passo 3 · Configurações comparadas', `${cs.length} configurações no mesmo modelo`);
      const h = s.table(
        M,
        1.6,
        CW,
        ['Item', ...cfgHeads(cs)],
        [
          ['Carga útil (t)', ...cs.map((c) => fmt(c.payloadT, 1))],
          ['Ciclo estático (min)', ...cs.map((c) => fmt(c.cycle.cycleMin, 1))],
          ['Produção de 1 caminhão (t/h)', ...cs.map((c) => fmt(c.tph, 2))],
          ['Frota estática', ...cs.map((c) => fmt(c.staticTrucks))],
          ['Custo fixo (R$/h calendário)', ...cs.map((c) => fmt(c.costFixedPerH, 2))],
          ['Custo operacional (R$/h trabalhada)', ...cs.map((c) => fmt(c.costVarPerH, 2))],
          ...(cs.some((c) => c.price > 0) ? [['Preço de compra', ...cs.map((c) => mi(c.price, 2))]] : []),
        ],
        { headColors: heads(), colFill: recFill(), sz: 12, rowH: 0.42 },
      );
      img(s, 'eq_prod', M, 1.8 + h, CW, 0.9);
      box(s, 'memo', M, SH_IN - 1.55, CW, 0.95, [cs.map((c) => `${c.tag}: ${fmt(c.payloadT, 1)} × 60 ÷ ${fmt(c.cycle.cycleMin, 2)} = **${fmt(c.tph, 2)} t/h**`).join('   ·   ')]);
    }
    /* 6. ciclo */
    if (images.cycleStatic) {
      const s = add(new Slide());
      header(s, 'Passo 3 · O ciclo, minuto a minuto', 'Onde o tempo de cada configuração vai');
      img(s, 'cycleStatic', M, 1.65, CW, SH_IN - 2.4);
    }
    /* 7. simulação */
    const hasRun = cs.some((c) => c.base);
    if (hasRun) {
      {
        const s = add(new Slide());
        header(s, 'Passo 4 · Simulação de eventos discretos', `Produção simulada contra a meta de ${fmt(d.sim.targetTpd)} t/dia`);
        img(s, 'simTpd', M, 1.65, CW * 0.64, SH_IN - 2.5);
        const xr = M + CW * 0.66;
        const wr = CW * 0.34;
        box(s, 'memo', xr, 1.65, wr, 2.2, cs.filter((c) => c.base).map((c) => `${c.tag}: ${fmt(c.base!.tpd)} ÷ ${fmt(d.sim.targetTpd)} = **${pct(c.base!.tpd / d.sim.targetTpd)}**`));
        const worst = cs.filter((c) => c.base).sort((a, b) => b.base!.queueDumpMin - a.base!.queueDumpMin)[0];
        box(s, 'read', xr, 4.0, wr, SH_IN - 4.6, [`Ciclo simulado: ${cs.filter((c) => c.base).map((c) => `${c.tag} ${fmt(c.base!.cycleMin, 1)} min`).join(' · ')}.`, worst ? `Maior fila na descarga: **${worst.tag}**, ${fmt(worst.base!.queueDumpMin, 1)} min.` : '']);
      }
      {
        const s = add(new Slide());
        header(s, 'Passo 4 · Matriz configuração × cenário', `${d.sim.replications} repetições de ${d.sim.days} dias por combinação`);
        const scen = d.sim.scenarios;
        const rows: string[][] = [];
        const rowFill: Record<number, string> = {};
        for (const c of cs)
          for (const sc of scen) {
            const r = c.matrix.find((m) => m.scenarioId === sc.id);
            if (!r) continue;
            rowFill[rows.length] = lighten(c.color, 0.86);
            rows.push([c.tag, short(sc.name, 30), fmt(r.tpd), pct(r.tpd / d.sim.targetTpd), fmt(r.cycleMin, 1), fmt(r.queueLoadMin, 1), fmt(r.queueDumpMin, 1), brl(r.costPerT)]);
          }
        s.rect(M, 1.55, CW, 0.32, SW_FILL);
        s.text(M + 0.1, 1.56, CW, 0.3, [{ runs: [{ t: `DADO EXPORTADO DO T2 MINEPLANNER · RODADA DE ${d.sim.runAt ? dateBR(d.sim.runAt) : ''}`, b: true, color: SW, sz: 10 }] }], { autofit: false });
        const rh = Math.min(0.32, (SH_IN - 2.7) / (rows.length + 1));
        s.table(M, 1.95, CW, ['Conf.', 'Cenário', 't/dia', '% meta', 'Ciclo', 'Fila carga', 'Fila desc.', 'R$/t'], rows, { colW: [0.07, 0.33, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1], rowFill, sz: rows.length > 14 ? 9 : 11, rowH: rh });
      }
      if (images.cycleSim) {
        const s = add(new Slide());
        header(s, 'Passo 4 · Onde o tempo vai na simulação', 'Ciclo simulado por estado do caminhão (cenário base)');
        img(s, 'cycleSim', M, 1.65, CW, SH_IN - 2.4);
      }
    }
    /* frota mínima */
    if (cs.some((c) => c.minFleet)) {
      const s = add(new Slide());
      header(s, 'Passo 5 · Frota mínima simulada', `Menor frota que fecha a meta: ${cs.map((c) => `${c.tag} ${c.minFleet ? fmt(c.minFleet.total) : '—'}`).join(' · ')}`);
      img(s, 'fleets', M, 1.65, CW * 0.6, SH_IN - 2.5);
      const ref = cs[0];
      box(
        s,
        'memo',
        M + CW * 0.63,
        1.65,
        CW * 0.37,
        SH_IN - 2.4,
        cs.filter((c) => c.minFleet).map((c) => `${c.tag}: **${fmt(c.minFleet!.total)}** (estático ${fmt(c.staticTrucks)})${c !== ref && ref.minFleet ? ` · ${pct(c.minFleet!.total / ref.minFleet.total - 1)} vs ${ref.tag}` : ''}`),
      );
    }
    if (d.sweep && images.sweep) {
      const s = add(new Slide());
      header(s, 'Passo 5 · Curva da frota mínima', `${short(d.sweep.config, 50)}${d.sweep.circuit ? ` · ${short(d.sweep.circuit, 40)}` : ''}`);
      img(s, 'sweep', M, 1.65, CW * 0.66, SH_IN - 2.5);
      const sw = d.sweep;
      const last = sw.points[sw.points.length - 1];
      box(s, 'sw', M + CW * 0.68, 1.65, CW * 0.32, SH_IN - 2.4, [`Saturação em **${sw.saturation}** caminhões`, last ? `${last.trucks} caminhões: **${fmt(last.tpd)} t/dia** (${pct(sw.target > 0 ? last.tpd / sw.target : 0, 1)} da meta)` : '', sw.minFleet ? `Frota mínima: **${sw.minFleet}**` : 'A busca parou antes de fechar a meta'], 'busca da frota');
    }
    /* custos */
    {
      const s = add(new Slide());
      header(s, 'Custo por tonelada e investimento', `${cs.slice().sort((a, b) => a.cost.perT - b.cost.perT).map((c) => `${c.tag} ${brl(c.cost.perT)}`).join(' · ')}`);
      const h1 = img(s, 'eq_custo', M, 1.6, CW, 0.5);
      const y = 1.6 + h1 + 0.2;
      box(s, 'memo', M, y, CW * 0.55, SH_IN - y - 0.6, [
        ...cs.map((c) => `${c.tag}: ${fmt(c.fleet)} × ${fmt(c.costFixedPerH, 0)} × ${fmt(d.hours.calendarH)} + ${fmt(c.fleet)} × ${fmt(c.circuits[0]?.productiveH ?? d.hours.effectiveH, 1)} × ${fmt(c.costVarPerH, 0)} = ${mi(c.cost.total, 2)} → **${brl(c.cost.perT)}/t**`),
        ...(cs.some((c) => c.price > 0) ? [`Investimento: ${cs.map((c) => `${c.tag} **${mi(c.cost.invest)}**`).join(' · ')}`] : []),
      ], undefined, 11);
      img(s, 'cost', M + CW * 0.57, y, CW * 0.43, SH_IN - y - 0.6);
    }
    /* decisão */
    if (d.decision) {
      const dc = d.decision;
      const s = add(new Slide());
      header(s, 'Decisão no horizonte do plano', `${dc.periods} período(s), ${fmt(dc.tonnes)} t, ${pct(dc.rate, 1)} ao ano`);
      s.rect(M, 1.55, CW, 0.32, SW_FILL);
      s.text(M + 0.1, 1.56, CW, 0.3, [{ runs: [{ t: 'DADO EXPORTADO DO T2 MINEPLANNER · RESULTADOS E DECISÃO', b: true, color: SW, sz: 10 }] }], { autofit: false });
      const h = s.table(
        M,
        1.95,
        CW,
        ['Opção', 'Atende', 'Pico', 'Investimento', 'VPL dos custos', 'Custo nivelado'],
        dc.rows.map((r) => [short(r.name, 44), r.allOk ? 'sim' : 'não', fmt(r.peakTrucks), mi(r.capex), mi(r.npvCost), `${brl(r.costPerT)}/t`]),
        { colW: [0.36, 0.09, 0.09, 0.15, 0.15, 0.16], rowFill: Object.fromEntries(dc.rows.map((r, i) => [i, r.id === dc.chosenId ? REC_FILL : 'FFFFFF'])), sz: 11 },
      );
      const y = 2.15 + h;
      const he = img(s, 'eq_nivel', M, y, CW * 0.45, 0.8);
      box(s, 'memo', M + CW * 0.47, y, CW * 0.53, SH_IN - y - 0.6, dc.rows.map((r) => `${short(r.name, 30)}: ${mi(r.npvCost, 1)} ÷ ${fmt(r.npvTonnes / 1e6, 2)} Mt = **${brl(r.costPerT)}/t**`), undefined, 11);
      void he;
    }
    /* descarga */
    if (cs.some((c) => c.dump)) {
      const s = add(new Slide());
      header(s, 'Restrições · Capacidade da descarga', `Ocupação na meta: ${cs.map((c) => `${c.tag} ${c.dump ? pct(c.dump.occupancy) : '—'}`).join(' · ')}`);
      const h = img(s, 'eq_cap', M, 1.65, CW, 0.8);
      const y = 1.75 + h + 0.25;
      box(s, 'memo', M, y, CW, 1.6, cs.filter((c) => c.dump).map((c) => `${c.tag}: ${fmt(c.dump!.stations)} × ${fmt(c.payloadT, 1)} × 60 ÷ ${fmt(c.dumpMin + c.maneuverMin, 1)} = **${fmt(c.dump!.capacityTph)} t/h** → ${fmt(c.dump!.needTph)} ÷ ${fmt(c.dump!.capacityTph)} = **${pct(c.dump!.occupancy)}** · 1 ponto só: ${fmt(c.dump!.capacityOne)} t/h`));
      box(s, 'read', M, y + 1.8, CW, 1.0, ['Até uns 70% de ocupação quase não há fila; acima de 80–85% qualquer chegada fora de hora gera fila longa.']);
    }
  }

  /* escolha */
  {
    const s = add(new Slide(INK));
    s.rect(0, 0, SW_IN, 0.18, ACC);
    s.text(M, 0.5, CW, 0.4, [{ runs: [{ t: 'A ESCOLHA', b: true, color: 'E9A56B', sz: 13 }] }]);
    s.text(M, 0.95, CW, 1.3, [{ runs: [{ t: rec ? `${rec.tag} – ${rec.name}` : 'Resultado do dimensionamento', b: true, color: 'F5F2EC', sz: 30 }] }]);
    s.text(M, 2.3, CW * 0.55, 3.8, [
      { runs: [{ t: 'Por quê', b: true, color: 'E9A56B', sz: 16 }], space: 8 },
      ...(d.recommendedWhy.length ? d.recommendedWhy : [d.conclusion]).map((w) => ({ runs: [{ t: w, color: 'F5F2EC', sz: 15 }], bullet: true, space: 8 })),
    ]);
    if (d.notes.length)
      s.text(M + CW * 0.58, 2.3, CW * 0.42, 3.8, [
        { runs: [{ t: 'Condições e próximos passos', b: true, color: 'A9C6D9', sz: 16 }], space: 8 },
        ...d.notes.map((w) => ({ runs: [{ t: w, color: 'F5F2EC', sz: 14 }], bullet: true, space: 6 })),
      ]);
    s.text(M, SH_IN - 0.6, CW, 0.3, [{ runs: [{ t: `Gerado pelo T2 MinePlanner em ${dateBR(d.generatedAt)}`, color: '9FB0B5', sz: 10 }] }], { autofit: false });
    add(s);
  }
  // a última chamada de add() na escolha não deve duplicar
  const unique = slides.filter((s, i) => slides.indexOf(s) === i);

  /* --------------------------------- pacote --------------------------------- */
  const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${P} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${unique
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`)
    .join('')}</p:sldIdLst><p:sldSz cx="${e(SW_IN)}" cy="${e(SH_IN)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="pt-BR"/></a:defPPr></p:defaultTextStyle></p:presentation>`;
  const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${unique
    .map((_, i) => `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`)
    .join('')}</Relationships>`;
  const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2800"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const masterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;
  const layout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${P} type="blank" preserve="1"><p:cSld name="Em branco"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  const layoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
  const slideRels = (s: Slide) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${s.rels
      .map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`)
      .join('')}</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${unique
    .map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`)
    .join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  return makeZip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: ROOT_RELS('ppt/presentation.xml') },
    { name: 'docProps/core.xml', data: core(d.opts.title, d.opts.company) },
    { name: 'docProps/app.xml', data: APP },
    { name: 'ppt/presentation.xml', data: presentation },
    { name: 'ppt/_rels/presentation.xml.rels', data: presRels },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: masterRels },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: layoutRels },
    { name: 'ppt/theme/theme1.xml', data: THEME },
    ...unique.flatMap((s, i) => [
      { name: `ppt/slides/slide${i + 1}.xml`, data: s.xml() },
      { name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: slideRels(s) },
    ]),
    ...media.map((m) => ({ name: `ppt/media/${m.name}`, data: m.data })),
  ]);
}

export type { ReportConfig };

const fill3 = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T2"><a:themeElements><a:clrScheme name="T2"><a:dk1><a:srgbClr val="${INK}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2A3A40"/></a:dk2><a:lt2><a:srgbClr val="${PAPER}"/></a:lt2><a:accent1><a:srgbClr val="${ACC}"/></a:accent1><a:accent2><a:srgbClr val="${BLUE}"/></a:accent2><a:accent3><a:srgbClr val="7D8A90"/></a:accent3><a:accent4><a:srgbClr val="${SW}"/></a:accent4><a:accent5><a:srgbClr val="8A4F7D"/></a:accent5><a:accent6><a:srgbClr val="B08A2E"/></a:accent6><a:hlink><a:srgbClr val="${BLUE}"/></a:hlink><a:folHlink><a:srgbClr val="8A4F7D"/></a:folHlink></a:clrScheme><a:fontScheme name="T2"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="T2"><a:fillStyleLst>${fill3}${fill3}${fill3}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill3}${fill3}${fill3}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
