/**
 * Relatório em Word (.docx) escrito direto em OOXML: capa, sumário, seções com tabelas coloridas,
 * caixas de memória de cálculo / dado do software / como ler, fórmulas e gráficos como imagem.
 */
import type { ReportData } from './data';
import { buildContent, type Block, type TableBlock } from './content';
import { makeZip, x } from './zip';
import { ACC, ACCD, BLUE, FONT, INK, LINE, MEMO_FILL, MUTED, READ_FILL, REC_FILL, SW, SW_FILL, TOTAL_FILL, ZEBRA, brl, dateBR, fmt, pct } from './theme';

export interface RenderedImage {
  data: Uint8Array;
  /** tamanho de exibição (px CSS a 96 dpi) */
  w: number;
  h: number;
}
export type ImageSet = Partial<Record<string, RenderedImage>>;

const W = 9638; // largura útil em dxa (A4, margens de 2 cm)
const EMU_PX = 9525;

/* ---------------------------------- texto ---------------------------------- */
interface RunOpt {
  b?: boolean;
  i?: boolean;
  color?: string;
  sz?: number;
  font?: string;
  caps?: boolean;
  spacing?: number;
}
const rPr = (o: RunOpt) =>
  `<w:rPr>${o.font ? `<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}" w:cs="${o.font}"/>` : ''}${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.caps ? '<w:caps/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : ''}${o.sz ? `<w:sz w:val="${o.sz}"/><w:szCs w:val="${o.sz}"/>` : ''}</w:rPr>`;
const run = (t: string, o: RunOpt = {}) => `<w:r>${rPr(o)}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
/** texto com **negrito** */
const rich = (t: string, o: RunOpt = {}) =>
  t
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((s) => (s.startsWith('**') && s.endsWith('**') ? run(s.slice(2, -2), { ...o, b: true }) : run(s, o)))
    .join('');

interface ParaOpt {
  style?: string;
  align?: 'left' | 'center' | 'right' | 'both';
  after?: number;
  before?: number;
  line?: number;
  keepNext?: boolean;
  pageBreakBefore?: boolean;
  shade?: string;
  borderBottom?: string;
  numId?: number;
  ind?: number;
  tabs?: string;
}
const pPr = (o: ParaOpt) =>
  `<w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.keepNext ? '<w:keepNext/>' : ''}${o.pageBreakBefore ? '<w:pageBreakBefore/>' : ''}${
    o.numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${o.numId}"/></w:numPr>` : ''
  }${o.borderBottom ? `<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${o.borderBottom}"/></w:pBdr>` : ''}${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}${o.tabs ?? ''}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 120}" w:line="${o.line ?? 290}" w:lineRule="auto"/>${
    o.ind ? `<w:ind w:left="${o.ind}"/>` : ''
  }${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>`;
const para = (runs: string, o: ParaOpt = {}) => `<w:p>${pPr(o)}${runs}</w:p>`;
const spacer = (after = 80) => `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/* --------------------------------- tabelas --------------------------------- */
const border = (c = LINE, sz = 4) => `w:val="single" w:sz="${sz}" w:space="0" w:color="${c}"`;
function cell(content: string, w: number, o: { fill?: string; borders?: string; margin?: number; vAlign?: string } = {}) {
  const m = o.margin ?? 90;
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.borders ?? `<w:tcBorders><w:top ${border()}/><w:left ${border()}/><w:bottom ${border()}/><w:right ${border()}/></w:tcBorders>`}${
    o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''
  }<w:tcMar><w:top w:w="50" w:type="dxa"/><w:left w:w="${m}" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/><w:right w:w="${m}" w:type="dxa"/></w:tcMar><w:vAlign w:val="${o.vAlign ?? 'center'}"/></w:tcPr>${content}</w:tc>`;
}
const tblWrap = (grid: number[], rows: string, layoutFixed = true) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/>${layoutFixed ? '<w:tblLayout w:type="fixed"/>' : ''}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid
    .map((g) => `<w:gridCol w:w="${g}"/>`)
    .join('')}</w:tblGrid>${rows}</w:tbl>`;

function table(b: TableBlock) {
  const n = b.head.length;
  const fr = b.widths ?? (n === 1 ? [1] : [Math.min(0.4, 1.6 / n + 0.1), ...Array(n - 1).fill((1 - Math.min(0.4, 1.6 / n + 0.1)) / (n - 1))]);
  const grid = fr.map((f) => Math.round(f * W));
  grid[n - 1] = W - grid.slice(0, n - 1).reduce((a, c) => a + c, 0);
  const sz = b.small ? 16 : 18;
  const left = (i: number) => (b.leftCols ? b.leftCols.includes(i) : i === 0);
  const head = `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${b.head
    .map((h, i) => cell(para(run(h, { b: true, color: 'FFFFFF', sz: sz - 1 }), { after: 0, line: 240, align: left(i) ? 'left' : 'center' }), grid[i], { fill: b.headColors?.[i] ?? INK }))
    .join('')}</w:tr>`;
  const body = b.rows
    .map((r, ri) => {
      const total = b.total && ri === b.rows.length - 1;
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r
        .map((v, i) => {
          const fill = total ? TOTAL_FILL : b.rowFill?.[ri] ?? b.colFill?.[i] ?? (ri % 2 ? ZEBRA : undefined);
          const bold = total || (b.colFill?.[i] === REC_FILL && i > 0);
          return cell(para(rich(v, { sz, b: bold }), { after: 0, line: 240, align: left(i) ? 'left' : 'right' }), grid[i], { fill });
        })
        .join('')}</w:tr>`;
    })
    .join('');
  return tblWrap(grid, head + body) + spacer(100);
}

const BOX: Record<string, { color: string; fill: string; title: string }> = {
  memo: { color: ACC, fill: MEMO_FILL, title: 'Memória de cálculo' },
  sw: { color: SW, fill: SW_FILL, title: 'Dado exportado do T2 MinePlanner' },
  read: { color: BLUE, fill: READ_FILL, title: 'Como ler' },
  note: { color: MUTED, fill: 'F1F1EF', title: 'Observação' },
};
function box(kind: keyof typeof BOX, lines: string[], title?: string) {
  const s = BOX[kind];
  const head = para(run(`${s.title}${title ? ` · ${title}` : ''}`.toUpperCase(), { b: true, color: s.color === SW ? SW : s.color === ACC ? ACCD : s.color, sz: 16, spacing: 20 }), { after: lines.length ? 70 : 0, line: 240 });
  const body = lines.map((l, i) => para(rich(l, { sz: 19 }), { after: i === lines.length - 1 ? 0 : 50, line: 276 })).join('');
  const none = 'w:val="nil"';
  const c = cell(head + body, W, {
    fill: s.fill,
    margin: 220,
    borders: `<w:tcBorders><w:top ${none}/><w:left w:val="single" w:sz="36" w:space="0" w:color="${s.color}"/><w:bottom ${none}/><w:right ${none}/></w:tcBorders>`,
  }).replace('<w:top w:w="50" w:type="dxa"/>', '<w:top w:w="130" w:type="dxa"/>').replace('<w:bottom w:w="50" w:type="dxa"/>', '<w:bottom w:w="130" w:type="dxa"/>');
  return tblWrap([W], `<w:tr><w:trPr><w:cantSplit/></w:trPr>${c}</w:tr>`) + spacer(120);
}

function kpis(items: { v: string; l: string }[]) {
  const w = Math.floor(W / items.length);
  const grid = items.map((_, i) => (i === items.length - 1 ? W - w * (items.length - 1) : w));
  const cells = items
    .map((it, i) =>
      cell(para(run(it.v, { b: true, sz: 40, color: ACCD }), { align: 'center', after: 40, line: 240 }) + para(run(it.l, { sz: 16, color: INK }), { align: 'center', after: 0, line: 240 }), grid[i], {
        fill: REC_FILL,
        margin: 120,
        borders: `<w:tcBorders><w:top w:val="single" w:sz="24" w:space="0" w:color="${ACC}"/><w:left w:val="single" w:sz="12" w:space="0" w:color="FFFFFF"/><w:bottom w:val="nil"/><w:right w:val="single" w:sz="12" w:space="0" w:color="FFFFFF"/></w:tcBorders>`,
      }),
    )
    .join('');
  return tblWrap(grid, `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`) + spacer(160);
}

/* --------------------------------- imagens --------------------------------- */
const drawing = (rid: string, id: number, wEmu: number, hEmu: number, name: string) =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${wEmu}" cy="${hEmu}"/><wp:docPr id="${id}" name="${x(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${x(
    name,
  )}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

/* --------------------------------- documento --------------------------------- */
export function buildDocx(d: ReportData, images: ImageSet = {}): Uint8Array {
  const doc = buildContent(d);
  const media: { name: string; data: Uint8Array; rid: string }[] = [];
  let imgId = 1;
  const imgRun = (key: string, maxWpx: number) => {
    const im = images[key];
    if (!im) return '';
    const rid = `rIdImg${media.length + 1}`;
    media.push({ name: `${key}.png`, data: im.data, rid });
    const scale = Math.min(1, maxWpx / im.w);
    return drawing(rid, imgId++, Math.round(im.w * scale * EMU_PX), Math.round(im.h * scale * EMU_PX), key);
  };

  const body: string[] = [];
  const o = d.opts;
  const rec = d.recommended;
  /* capa */
  body.push(para('', { shade: INK, after: 0, line: 240 }));
  body.push(para(run(`${o.client}${o.company ? ` · ${o.company}` : ''}`.toUpperCase(), { b: true, color: ACC, sz: 20, spacing: 50 }), { before: 2000, after: 200 }));
  body.push(para(run(o.title, { b: true, sz: 56, color: INK }), { after: 200, line: 260 }));
  body.push(para(run(o.subtitle || 'Memorial de cálculo, resultados simulados e escolha do equipamento', { sz: 30, color: MUTED }), { after: 500, borderBottom: ACC }));
  const kp: { v: string; l: string }[] = [];
  if (rec) {
    kp.push({ v: rec.tag, l: `${rec.name} é a recomendação` });
    kp.push({ v: fmt(rec.fleet), l: `caminhões (${rec.fleetSource})` });
    kp.push({ v: brl(rec.cost.perT), l: 'custo por tonelada' });
    kp.push(rec.dump ? { v: pct(rec.dump.occupancy), l: 'ocupação da descarga' } : { v: fmt(d.target.dayT), l: 't/dia de meta' });
  } else {
    kp.push({ v: fmt(d.target.monthT), l: 't/mês de meta' }, { v: fmt(d.statik.needed), l: 'caminhões (conta estática)' }, { v: pct(d.statik.ratio), l: 'atendimento' });
  }
  body.push(kpis(kp));
  body.push(para(run('Base de dados: ', { b: true, sz: 19 }) + run('Premissas Fundamentais, 2. Dimensionamento e Simulação do T2 MinePlanner.', { sz: 19, color: MUTED }), { before: 1200, after: 60 }));
  body.push(para(run('Mês de referência: ', { b: true, sz: 19 }) + run(d.periodLabel, { sz: 19, color: MUTED }), { after: 60 }));
  if (o.author) body.push(para(run('Responsável: ', { b: true, sz: 19 }) + run(o.author, { sz: 19, color: MUTED }), { after: 60 }));
  body.push(para(run('Data: ', { b: true, sz: 19 }) + run(dateBR(d.generatedAt), { sz: 19, color: MUTED }), { after: 60 }));
  body.push(pageBreak());
  /* sumário e legenda */
  body.push(para(run('Sumário', { b: true, sz: 36, color: INK }), { after: 200 }));
  body.push(
    `<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Clique com o botão direito e escolha “Atualizar campo” para montar o sumário.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
  );
  body.push(para(run('Legenda das caixas', { b: true, sz: 22 }), { before: 300, after: 120 }));
  body.push(box('memo', ['A conta passo a passo, com os números substituídos.']));
  body.push(box('sw', ['Número tirado direto do software (premissas e rodadas de simulação), sem recálculo.']));
  body.push(box('read', ['Interpretação do resultado em linguagem simples.']));
  if (d.configs.length) body.push(para(rich(`As configurações aparecem sempre na mesma cor e letra (${d.configs.map((c) => `**${c.tag}**`).join(', ')}); a coluna da recomendada vem realçada.`), {}));

  /* seções */
  let numCount = 0;
  const nums: number[] = [];
  for (const section of doc.sections) {
    for (const b of section) body.push(renderBlock(b));
  }
  function renderBlock(b: Block): string {
    switch (b.t) {
      case 'h1':
        return (
          (b.eyebrow ? para(run(b.eyebrow.toUpperCase(), { b: true, color: ACC, sz: 18, spacing: 40 }), { pageBreakBefore: true, keepNext: true, after: 0 }) : '') +
          para(run(b.text), { style: 'Heading1', pageBreakBefore: !b.eyebrow })
        );
      case 'h2':
        return para(run(b.text), { style: 'Heading2' });
      case 'p':
        return para(rich(b.text), { after: 120 });
      case 'small':
        return para(rich(b.text, { i: true, color: MUTED, sz: 17 }), { after: 160 });
      case 'bullets': {
        let id = 1;
        if (b.numbered) {
          numCount++;
          id = 10 + numCount;
          nums.push(id);
        }
        return b.items.map((it) => para(rich(it), { numId: id, after: 80, line: 290 })).join('');
      }
      case 'table':
        return table(b);
      case 'box':
        return box(b.kind, b.lines, b.title);
      case 'kpis':
        return kpis(b.items);
      case 'eq': {
        const r = imgRun(b.key, 600);
        return r ? para(r, { align: 'center', before: 120, after: 120, line: 240 }) : '';
      }
      case 'fig': {
        const r = imgRun(b.key, 600);
        return r ? para(r, { align: 'center', before: 120, after: 60, line: 240, keepNext: true }) + para(run(b.caption, { i: true, color: MUTED, sz: 17 }), { after: 160 }) : '';
      }
    }
  }

  const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:footerReference w:type="first" r:id="rIdFooterFirst"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:titlePg/></w:sectPr>`;
  const NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}${sect}</w:body></w:document>`;

  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${para(run(`${o.client ? `${o.client} · ` : ''}${o.title}`, { sz: 16, color: MUTED }), { align: 'right', after: 0, borderBottom: LINE })}</w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="${W}"/></w:tabs><w:spacing w:after="0"/></w:pPr>${run(`${o.company || 'T2 MinePlanner'} · gerado em ${dateBR(d.generatedAt)}`, { sz: 16, color: MUTED })}<w:r>${rPr({ sz: 16, color: MUTED })}<w:tab/><w:t xml:space="preserve">Página </w:t></w:r><w:r>${rPr({ sz: 16, color: ACC, b: true })}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rPr({ sz: 16, color: ACC, b: true })}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rPr({ sz: 16, color: ACC, b: true })}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rPr({ sz: 16, color: ACC, b: true })}<w:t>1</w:t></w:r><w:r>${rPr({ sz: 16, color: ACC, b: true })}<w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const footerFirst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p/></w:ftr>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:color w:val="${INK}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="290" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="6" w:color="${ACC}"/></w:pBdr><w:spacing w:before="60" w:after="200"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="${INK}"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="${BLUE}"/><w:sz w:val="25"/><w:szCs w:val="25"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="300"/></w:pPr></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
  const absNum = (id: number, fmtv: string, text: string, color: string) =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmtv}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="500" w:hanging="300"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/></w:rPr></w:lvl></w:abstractNum>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${absNum(0, 'bullet', '•', ACC)}${absNum(1, 'decimal', '%1.', ACC)}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${nums
    .map((n) => `<w:num w:numId="${n}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`)
    .join('')}</w:numbering>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="708"/><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdFooterFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>${media
    .map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`)
    .join('')}</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  return makeZip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: ROOT_RELS('word/document.xml') },
    { name: 'docProps/core.xml', data: core(o.title, o.company) },
    { name: 'docProps/app.xml', data: APP },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/settings.xml', data: settings },
    { name: 'word/header1.xml', data: header },
    { name: 'word/footer1.xml', data: footer },
    { name: 'word/footer2.xml', data: footerFirst },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ]);
}

export const ROOT_RELS = (main: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
export const core = (title: string, company: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>${x(company || 'T2 MinePlanner')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`;
export const APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>T2 MinePlanner</Application></Properties>`;
