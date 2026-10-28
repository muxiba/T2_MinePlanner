/**
 * Planilha (.xlsx) escrita direto em SpreadsheetML, no padrão do relatório: premissas em azul (entradas),
 * memórias de cálculo com fórmulas vivas (abas laranja), dados exportados da simulação (abas verdes),
 * coluna da recomendada realçada e os gráficos como imagem.
 */
import type { ReportData } from './data';
import type { ImageSet } from './docx';
import { APP, core } from './docx';
import { makeZip, x } from './zip';
import { ACC, ACCD, BLUE, INK, MEMO_FILL, MUTED, READ_FILL, REC_FILL, SW, SW_FILL, TOTAL_FILL, lighten } from './theme';

/* --------------------------------- estilos --------------------------------- */
interface StyleOpt {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  fill?: string;
  fmt?: string;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  border?: 'bottom' | 'box' | 'leftThick';
  borderColor?: string;
}
class Styles {
  fonts: string[] = ['<font><sz val="10"/><color rgb="FF1E2B30"/><name val="Arial"/></font>'];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  numFmts: string[] = [];
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private cache = new Map<string, number>();
  private idx(list: string[], s: string) {
    let i = list.indexOf(s);
    if (i < 0) {
      list.push(s);
      i = list.length - 1;
    }
    return i;
  }
  get(o: StyleOpt) {
    const key = JSON.stringify(o);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const font = this.idx(this.fonts, `<font>${o.bold ? '<b/>' : ''}${o.italic ? '<i/>' : ''}<sz val="${o.size ?? 10}"/><color rgb="FF${o.color ?? INK}"/><name val="Arial"/></font>`);
    const fill = o.fill ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const bc = o.borderColor ?? 'DDD5C7';
    const border = o.border
      ? this.idx(
          this.borders,
          o.border === 'leftThick'
            ? `<border><left style="thick"><color rgb="FF${bc}"/></left><right/><top/><bottom/><diagonal/></border>`
            : o.border === 'box'
              ? `<border><left style="thin"><color rgb="FF${bc}"/></left><right style="thin"><color rgb="FF${bc}"/></right><top style="thin"><color rgb="FF${bc}"/></top><bottom style="thin"><color rgb="FF${bc}"/></bottom><diagonal/></border>`
              : `<border><left/><right/><top/><bottom style="thin"><color rgb="FF${bc}"/></bottom><diagonal/></border>`,
        )
      : 0;
    let numFmtId = 0;
    if (o.fmt) {
      const i = this.idx(this.numFmts, o.fmt);
      numFmtId = 164 + i;
    }
    const align = o.align || o.wrap ? `<alignment${o.align ? ` horizontal="${o.align}"` : ''} vertical="center"${o.wrap ? ' wrapText="1"' : ''}/>` : '';
    this.xfs.push(`<xf numFmtId="${numFmtId}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${font ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${border ? ' applyBorder="1"' : ''}${align ? ' applyAlignment="1"' : ''}>${align}</xf>`);
    const id = this.xfs.length - 1;
    this.cache.set(key, id);
    return id;
  }
  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
      this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${x(f)}"/>`).join('')}</numFmts>` : ''
    }<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="${this.borders.length}">${this.borders.join(
      '',
    )}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

const F = {
  int: '#,##0;-#,##0;"-"',
  d1: '#,##0.0;-#,##0.0;"-"',
  d2: '#,##0.00;-#,##0.00;"-"',
  pct: '0.0%;-0.0%;"-"',
  pct0: '0%',
  brl: '"R$" #,##0.00',
  brl0: '"R$" #,##0',
  mi: '"R$" #,##0.0,,"mi"',
};

/* --------------------------------- planilha --------------------------------- */
type Val = string | number | { f: string; v: number | string } | null;
const colName = (c: number) => {
  let s = '';
  let n = c;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
export const ref = (r: number, c: number, abs = false) => (abs ? `$${colName(c)}$${r}` : `${colName(c)}${r}`);

class Sheet {
  cells = new Map<number, Map<number, { v: Val; s: number }>>();
  widths: number[] = [];
  heights = new Map<number, number>();
  merges: string[] = [];
  images: { key: string; r: number; c: number; w: number; h: number }[] = [];
  row = 1;
  constructor(
    public name: string,
    public tab: string,
  ) {}
  set(r: number, c: number, v: Val, s = 0) {
    if (!this.cells.has(r)) this.cells.set(r, new Map());
    this.cells.get(r)!.set(c, { v, s });
  }
  xml(drawingRel?: string) {
    const rows = [...this.cells.keys()].sort((a, b) => a - b);
    const data = rows
      .map((r) => {
        const cs = [...this.cells.get(r)!.entries()].sort((a, b) => a[0] - b[0]);
        const ht = this.heights.get(r);
        return `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ''}>${cs
          .map(([c, { v, s }]) => {
            const a = `r="${ref(r, c)}"${s ? ` s="${s}"` : ''}`;
            if (v === null || v === undefined || v === '') return `<c ${a}/>`;
            if (typeof v === 'number') return Number.isFinite(v) ? `<c ${a}><v>${v}</v></c>` : `<c ${a}/>`;
            if (typeof v === 'string') return `<c ${a} t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
            const cached = typeof v.v === 'number' ? (Number.isFinite(v.v) ? `<v>${v.v}</v>` : '') : `<v>${x(v.v)}</v>`;
            return `<c ${a}${typeof v.v === 'string' ? ' t="str"' : ''}><f>${x(v.f)}</f>${cached}</c>`;
          })
          .join('')}</row>`;
      })
      .join('');
    const cols = this.widths.length ? `<cols>${this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><tabColor rgb="FF${this.tab}"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${
      this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''
    }<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${drawingRel ? `<drawing r:id="${drawingRel}"/>` : ''}</worksheet>`;
  }
}

export function buildXlsx(d: ReportData, images: ImageSet = {}): Uint8Array {
  const st = new Styles();
  const S = {
    title: st.get({ bold: true, size: 14, color: 'FFFFFF', fill: INK }),
    memoTag: st.get({ bold: true, color: ACCD, fill: MEMO_FILL }),
    swTag: st.get({ bold: true, color: SW, fill: SW_FILL }),
    plainTag: st.get({ italic: true, color: MUTED }),
    head: st.get({ bold: true, color: 'FFFFFF', fill: INK, wrap: true, align: 'center' }),
    headL: st.get({ bold: true, color: 'FFFFFF', fill: INK, wrap: true, align: 'left' }),
    label: st.get({ border: 'bottom' }),
    labelB: st.get({ bold: true, border: 'bottom' }),
    text: st.get({ border: 'bottom', wrap: true }),
    note: st.get({ color: BLUE, fill: READ_FILL, wrap: true, border: 'leftThick', borderColor: BLUE }),
    memoLine: st.get({ color: INK, fill: MEMO_FILL, wrap: true, border: 'leftThick', borderColor: ACC }),
    kpi: st.get({ bold: true, size: 18, color: ACCD, fill: REC_FILL, align: 'center' }),
    kpiL: st.get({ size: 9, fill: REC_FILL, align: 'center', wrap: true }),
  };
  /** número: entrada (azul), fórmula (preto), ligação a outra aba (verde), total, recomendada */
  const num = (fmt: keyof typeof F, kind: 'in' | 'f' | 'link' | 'total' | 'rec' | 'sw' = 'f') =>
    st.get({
      fmt: F[fmt],
      color: kind === 'in' ? '0000FF' : kind === 'link' ? '008000' : INK,
      bold: kind === 'total' || kind === 'rec',
      fill: kind === 'total' ? TOTAL_FILL : kind === 'rec' ? REC_FILL : undefined,
      border: 'bottom',
    });
  const headC = (color: string) => st.get({ bold: true, color: 'FFFFFF', fill: color, wrap: true, align: 'center' });
  const sheets: Sheet[] = [];
  const add = (name: string, tab: string, title: string, tag: string, tagStyle: number, widths: number[]) => {
    const sh = new Sheet(name, tab);
    sh.widths = widths;
    for (let c = 1; c <= widths.length; c++) {
      sh.set(1, c, c === 1 ? title : null, S.title);
      sh.set(2, c, c === 1 ? tag : null, tagStyle);
    }
    sh.heights.set(1, 26);
    sh.heights.set(2, 20);
    sh.row = 4;
    sheets.push(sh);
    return sh;
  };
  const header = (sh: Sheet, cols: string[], colors: (string | undefined)[] = []) => {
    cols.forEach((h, i) => sh.set(sh.row, i + 1, h, colors[i] ? headC(colors[i]!) : i === 0 ? S.headL : S.head));
    sh.heights.set(sh.row, 30);
    sh.row++;
  };
  const noteRow = (sh: Sheet, text: string, cols: number, style = S.note) => {
    sh.set(sh.row, 1, text, style);
    for (let c = 2; c <= cols; c++) sh.set(sh.row, c, null, style);
    sh.merges.push(`${ref(sh.row, 1)}:${ref(sh.row, cols)}`);
    sh.heights.set(sh.row, Math.min(90, 16 * Math.ceil(text.length / (cols * 16)) + 6));
    sh.row++;
  };

  const cs = d.configs;
  const recIdx = cs.findIndex((c) => c === d.recommended);
  const ccol = (i: number) => 2 + i; // coluna da configuração i
  const isRec = (i: number) => i === recIdx;

  /* -------------------------------- Premissas -------------------------------- */
  const pr = add('Premissas', ACC, 'Premissas e meta', 'MEMÓRIA DE CÁLCULO · entradas em azul (mude para testar); fórmulas em preto; ligações a outra aba em verde', S.memoTag, [46, 18, 14, 50]);
  header(pr, ['Premissa', 'Valor', 'Unidade', 'Origem']);
  const P: Record<string, string> = {};
  const pin = (key: string, label: string, v: number, unit: string, fmt: keyof typeof F, origin: string) => {
    pr.set(pr.row, 1, label, S.label);
    pr.set(pr.row, 2, v, num(fmt, 'in'));
    pr.set(pr.row, 3, unit, S.label);
    pr.set(pr.row, 4, origin, S.text);
    P[key] = `Premissas!${ref(pr.row, 2, true)}`;
    pr.row++;
  };
  const pf = (key: string, label: string, f: string, v: number, unit: string, fmt: keyof typeof F, origin: string) => {
    pr.set(pr.row, 1, label, S.labelB);
    pr.set(pr.row, 2, { f, v }, num(fmt, 'total'));
    pr.set(pr.row, 3, unit, S.label);
    pr.set(pr.row, 4, origin, S.text);
    P[key] = `Premissas!${ref(pr.row, 2, true)}`;
    pr.row++;
  };
  const h = d.hours;
  pin('meta', d.labels.target, d.target.monthT, 't/mês', 'int', 'Premissas Fundamentais / 2. Dimensionamento');
  pin('dias', 'Dias de operação no mês', h.workDays, 'dias', 'd1', 'Calendário de produção');
  pin('hpd', 'Horas de operação por dia', h.hoursPerDay, 'h/dia', 'd1', 'Premissas Fundamentais');
  pin('df', 'Disponibilidade física (DF)', h.df, '%', 'pct', 'Premissas Fundamentais');
  pin('uf', 'Utilização (UF)', h.uf, '%', 'pct', 'Premissas Fundamentais');
  pin('eo', 'Eficiência operacional aplicada', h.eo, '%', 'pct', '1 = já incluída na UF');
  pin('calH', 'Horas de calendário no mês', h.calendarH, 'h', 'int', 'custo fixo corre o mês todo');
  pf('hef', 'Horas efetivas por caminhão no mês', `${P.dias.split('!')[1]}*${P.hpd.split('!')[1]}*${P.df.split('!')[1]}*${P.uf.split('!')[1]}*${P.eo.split('!')[1]}`, h.effectiveH, 'h', 'd1', 'dias × h/dia × DF × UF × EO');
  pf('metaDia', 'Meta por dia de operação', `${P.meta.split('!')[1]}/${P.dias.split('!')[1]}`, d.target.dayT, 't/dia', 'd1', 'meta ÷ dias');
  pf('metaHora', 'Meta por hora de operação', `${P.metaDia.split('!')[1]}/${P.hpd.split('!')[1]}`, d.target.dayT / Math.max(1, h.hoursPerDay), 't/h', 'd1', 'meta por dia ÷ horas por dia');
  pr.row++;
  header(pr, ['Outras premissas do software', 'Valor', 'Unidade', '']);
  for (const p of d.premises) {
    pr.set(pr.row, 1, p.label, S.label);
    pr.set(pr.row, 2, p.raw ?? p.value, p.raw !== undefined ? num(Number.isInteger(p.raw) ? 'int' : 'd1', 'sw') : S.label);
    pr.set(pr.row, 3, p.unit, S.label);
    pr.row++;
  }

  /* ------------------------------- Dimensionamento ------------------------------- */
  const dm = add('Dimensionamento', ACC, 'Frota pela conta estática (2. Dimensionamento)', 'MEMÓRIA DE CÁLCULO · tempos do ciclo vindos do software (azul); produção e frota em fórmulas', S.memoTag, [36, 12, 9, 9, 10, 9, 11, 10, 9, 9, 10, 10, 12, 10, 9]);
  header(dm, ['Movimentação', 'Massa (t/mês)', 'Carga (t)', 'Carga (min)', 'Viagem carr. (min)', 'Pesagem (min)', 'Basc.+man. (min)', 'Viagem vazio (min)', 'Fila (min)', 'Outras (min)', 'Ciclo (min)', 't/h por cam.', 't/mês por cam.', 'Frota exata', 'Frota']);
  const dm0 = dm.row;
  for (const m of d.statik.movements) {
    const r = dm.row;
    dm.set(r, 1, m.name, S.label);
    dm.set(r, 2, m.massT, num('int', 'in'));
    dm.set(r, 3, m.payloadT, num('d1', 'in'));
    [m.cycle.loadMin, m.cycle.loadedMin, m.cycle.weighMin, m.cycle.dumpMin, m.cycle.emptyMin, m.cycle.queueMin, m.cycle.otherMin].forEach((v, k) => dm.set(r, 4 + k, v, num('d2', 'in')));
    dm.set(r, 11, { f: `SUM(D${r}:J${r})`, v: m.cycle.cycleMin }, num('d2'));
    dm.set(r, 12, { f: `IF(K${r}>0,C${r}*60/K${r},0)`, v: m.tph }, num('d2'));
    dm.set(r, 13, { f: `L${r}*${P.hef}`, v: m.truckMonthT }, num('int', 'link'));
    dm.set(r, 14, { f: `IF(M${r}>0,B${r}/M${r},0)`, v: m.exact }, num('d2'));
    dm.set(r, 15, { f: `ROUNDUP(N${r}-0.000001,0)`, v: m.needed }, num('int', 'rec'));
    dm.row++;
  }
  const dmT = dm.row;
  dm.set(dmT, 1, 'Total', st.get({ bold: true, fill: TOTAL_FILL, border: 'bottom' }));
  dm.set(dmT, 2, { f: `SUM(B${dm0}:B${dmT - 1})`, v: d.statik.movements.reduce((a, m) => a + m.massT, 0) }, num('int', 'total'));
  dm.set(dmT, 14, { f: `SUM(N${dm0}:N${dmT - 1})`, v: d.statik.movements.reduce((a, m) => a + m.exact, 0) }, num('d2', 'total'));
  dm.set(dmT, 15, { f: `SUM(O${dm0}:O${dmT - 1})`, v: d.statik.needed }, num('int', 'total'));
  dm.row += 2;
  noteRow(dm, 'Como ler: ciclo = soma dos tempos; produção = carga × 60 ÷ ciclo; t/mês = produção × horas efetivas (Premissas); frota = massa ÷ t/mês, arredondada para cima em cada movimentação. A fila aqui é fixa; a simulação calcula a fila real.', 15);

  /* -------------------------------- Configurações -------------------------------- */
  let cf: Sheet | null = null;
  const CF: Record<string, number> = {};
  if (cs.length) {
    cf = add('Configurações', ACC, 'Configurações comparadas: ciclo, produção, frota e custo', 'MEMÓRIA DE CÁLCULO · valores do modelo de simulação em azul; contas em fórmulas', S.memoTag, [44, ...cs.map(() => 18), 40]);
    header(cf, ['Item', ...cs.map((c) => `${c.tag} · ${c.name}`), 'Fórmula'], [undefined, ...cs.map((c) => c.color)]);
    const rowIn = (key: string, label: string, vals: number[], fmt: keyof typeof F, desc: string) => {
      const r = cf!.row;
      cf!.set(r, 1, label, S.label);
      vals.forEach((v, i) => cf!.set(r, ccol(i), v, isRec(i) ? st.get({ fmt: F[fmt], color: '0000FF', bold: true, fill: REC_FILL, border: 'bottom' }) : num(fmt, 'in')));
      cf!.set(r, ccol(cs.length), desc, S.text);
      CF[key] = r;
      cf!.row++;
    };
    const rowF = (key: string, label: string, f: (col: string, i: number) => string, vals: number[], fmt: keyof typeof F, desc: string, bold = false) => {
      const r = cf!.row;
      cf!.set(r, 1, label, bold ? S.labelB : S.label);
      vals.forEach((v, i) => cf!.set(r, ccol(i), { f: f(colName(ccol(i)), i), v }, isRec(i) ? num(fmt, 'rec') : bold ? num(fmt, 'total') : num(fmt)));
      cf!.set(r, ccol(cs.length), desc, S.text);
      CF[key] = r;
      cf!.row++;
    };
    rowIn('carga', 'Carga útil (t)', cs.map((c) => c.payloadT), 'd1', 'configuração');
    rowIn('tCarga', 'Carga no ponto de carga (min)', cs.map((c) => c.cycle.loadMin), 'd2', 'média ponderada pelos circuitos');
    rowIn('tIda', 'Viagem carregado (min)', cs.map((c) => c.cycle.loadedMin), 'd2', 'perfil da via × tabela de velocidade');
    rowIn('tPesa', 'Pesagem (min)', cs.map((c) => c.cycle.weighMin), 'd2', 'circuito');
    rowIn('tDesc', 'Basculamento + manobra (min)', cs.map((c) => c.cycle.dumpMin), 'd2', 'configuração');
    rowIn('tVolta', 'Viagem vazio (min)', cs.map((c) => c.cycle.emptyMin), 'd2', 'perfil da via × tabela de velocidade');
    rowIn('tFila', 'Fila fixa e outras paradas (min)', cs.map((c) => c.cycle.queueMin + c.cycle.otherMin), 'd2', 'premissas');
    rowF('ciclo', 'Ciclo total (min)', (c) => `SUM(${c}${CF.tCarga}:${c}${CF.tFila})`, cs.map((c) => c.cycle.cycleMin), 'd2', 'soma das etapas', true);
    rowF('tph', 'Produção de 1 caminhão (t/h)', (c) => `IF(${c}${CF.ciclo}>0,${c}${CF.carga}*60/${c}${CF.ciclo},0)`, cs.map((c) => c.tph), 'd2', 'carga × 60 ÷ ciclo', true);
    const prodH = cs[0].circuits[0]?.productiveH ?? h.effectiveH;
    const tonnes = cs[0].circuits.reduce((a, c) => a + c.tonnes, 0);
    rowIn('hProd', 'Horas efetivas do caminhão no período (h)', cs.map(() => prodH), 'd1', 'simulação: dias × h/dia × DF × UF');
    rowIn('ton', 'Toneladas do período (t)', cs.map(() => tonnes), 'int', 'soma dos circuitos');
    rowF('exato', 'Frota exata (conta estática)', (c) => `IF(${c}${CF.tph}>0,${c}${CF.ton}/(${c}${CF.tph}*${c}${CF.hProd}),0)`, cs.map((c) => c.staticExact), 'd2', 'toneladas ÷ (produção × horas)');
    rowIn('estatica', 'Frota estática (inteira por circuito)', cs.map((c) => c.staticTrucks), 'int', 'software: cada circuito arredondado para cima');
    rowIn('minima', 'Frota mínima simulada', cs.map((c) => c.minFleet?.total ?? c.staticTrucks), 'int', cs.some((c) => c.minFleet) ? 'aba Frota mínima (simulação)' : 'sem rodada: igual à estática');
    rowIn('fix', 'Custo fixo (R$/h calendário)', cs.map((c) => c.costFixedPerH), 'brl', 'configuração');
    rowIn('var', 'Custo operacional (R$/h trabalhada)', cs.map((c) => c.costVarPerH), 'brl', 'configuração');
    rowIn('preco', 'Preço de compra (R$)', cs.map((c) => c.price), 'brl0', 'financeiro da simulação');
    rowF('cFix', 'Custo fixo do mês (R$)', (c) => `${c}${CF.minima}*${c}${CF.fix}*${P.calH}`, cs.map((c) => c.cost.fixedMonth), 'brl0', 'frota × R$/h × horas do mês');
    rowF('cVar', 'Custo operacional do mês (R$)', (c) => `${c}${CF.minima}*${c}${CF.hProd}*${c}${CF.var}`, cs.map((c) => c.cost.varMonth), 'brl0', 'frota × horas efetivas × R$/h');
    rowF('cTot', 'Custo total do mês (R$)', (c) => `${c}${CF.cFix}+${c}${CF.cVar}`, cs.map((c) => c.cost.total), 'brl0', 'fixo + operacional', true);
    rowF('rpt', 'Custo por tonelada (R$/t)', (c) => `IF(${c}${CF.ton}>0,${c}${CF.cTot}/${c}${CF.ton},0)`, cs.map((c) => c.cost.perT), 'brl', 'custo ÷ toneladas', true);
    rowF('inv', 'Investimento na frota (R$)', (c) => `${c}${CF.minima}*${c}${CF.preco}`, cs.map((c) => c.cost.invest), 'mi', 'frota × preço');
    rowIn('pontos', 'Pontos de descarga (destino mais ocupado)', cs.map((c) => c.dump?.stations ?? 1), 'int', cs[0].dump?.destination ?? '');
    rowIn('chegada', 'Chegada média na descarga (t/h)', cs.map((c) => c.dump?.needTph ?? 0), 'd1', 'toneladas ÷ horas de operação');
    rowF('cap', 'Capacidade da descarga (t/h)', (c) => `IF(${c}${CF.tDesc}>0,${c}${CF.pontos}*${c}${CF.carga}*60/${c}${CF.tDesc},0)`, cs.map((c) => c.dump?.capacityTph ?? 0), 'int', 'pontos × carga × 60 ÷ (basculamento + manobra)');
    rowF('ocup', 'Ocupação da descarga', (c) => `IF(${c}${CF.cap}>0,${c}${CF.chegada}/${c}${CF.cap},0)`, cs.map((c) => c.dump?.occupancy ?? 0), 'pct', 'acima de 80–85% a fila cresce rápido', true);
    cf.row++;
    noteRow(cf, `Como ler: ${d.conclusion}`, cs.length + 2);
  }

  /* --------------------------------- Simulação --------------------------------- */
  const hasRun = cs.some((c) => c.matrix.length);
  if (hasRun) {
    const sm = add('Simulação', SW, 'Simulação: matriz configuração × cenário', `DADO EXPORTADO DO T2 MINEPLANNER · rodada da aba Relatórios${d.sim.runAt ? ` de ${new Date(d.sim.runAt).toLocaleDateString('pt-BR')}` : ''} · ${d.sim.replications} repetições, ${d.sim.days} dias`, S.swTag, [30, 30, 10, 12, 12, 10, 10, 11, 11, 11, 11]);
    sm.set(sm.row, 1, 'Meta do sistema (t/dia)', S.labelB);
    sm.set(sm.row, 3, d.sim.targetTpd, num('int', 'in'));
    const metaRef = ref(sm.row, 3, true);
    sm.row += 2;
    header(sm, ['Configuração', 'Cenário', 'Frota', 't/dia', 'IC95 mín.', 'IC95 máx.', '% da meta', 'Ciclo (min)', 'Fila carga (min)', 'Fila desc. (min)', 'R$/t']);
    for (const c of cs)
      for (const r of c.matrix) {
        const rr = sm.row;
        const fill = lighten(c.color, 0.86);
        const sn = (fmt: keyof typeof F) => st.get({ fmt: F[fmt], fill, border: 'bottom' });
        sm.set(rr, 1, `${c.tag} · ${c.name}`, st.get({ fill, border: 'bottom' }));
        sm.set(rr, 2, r.scenario, st.get({ fill, border: 'bottom' }));
        sm.set(rr, 3, r.trucks, sn('int'));
        sm.set(rr, 4, r.tpd, sn('int'));
        sm.set(rr, 5, r.lo, sn('int'));
        sm.set(rr, 6, r.hi, sn('int'));
        sm.set(rr, 7, { f: `D${rr}/${metaRef}`, v: r.tpd / d.sim.targetTpd }, st.get({ fmt: F.pct0, fill, bold: true, border: 'bottom' }));
        sm.set(rr, 8, r.cycleMin, sn('d1'));
        sm.set(rr, 9, r.queueLoadMin, sn('d1'));
        sm.set(rr, 10, r.queueDumpMin, sn('d1'));
        sm.set(rr, 11, r.costPerT, sn('brl'));
        sm.row++;
      }
    sm.row++;
    noteRow(sm, 'Como ler: todas as linhas usam a frota de cada circuito do modelo; o que muda é a configuração e a condição operacional. % da meta = t/dia ÷ meta do sistema.', 11);
    if (images.simTpd) sm.images.push({ key: 'simTpd', r: sm.row + 1, c: 1, w: 760, h: 760 * (images.simTpd.h / images.simTpd.w) });
  }

  /* -------------------------------- Frota mínima -------------------------------- */
  if (cs.some((c) => c.minFleet) || d.sweep) {
    const fm = add('Frota mínima', SW, 'Frota mínima simulada', 'DADO EXPORTADO DO T2 MINEPLANNER · busca da frota mínima', S.swTag, [40, ...cs.map(() => 16), 4, 14, 14, 14, 14]);
    if (cs.some((c) => c.minFleet)) {
      header(fm, ['Circuito', ...cs.map((c) => `${c.tag} · ${c.name}`)], [undefined, ...cs.map((c) => c.color)]);
      const circuits = cs.find((c) => c.minFleet)!.minFleet!.circuits;
      const r0 = fm.row;
      circuits.forEach((cc, k) => {
        fm.set(fm.row, 1, cc.name, S.label);
        cs.forEach((c, i) => fm.set(fm.row, ccol(i), c.minFleet?.circuits[k]?.trucks ?? null, isRec(i) ? num('int', 'rec') : num('int')));
        fm.row++;
      });
      fm.set(fm.row, 1, 'Frota mínima simulada', st.get({ bold: true, fill: TOTAL_FILL, border: 'bottom' }));
      cs.forEach((c, i) => fm.set(fm.row, ccol(i), { f: `SUM(${colName(ccol(i))}${r0}:${colName(ccol(i))}${fm.row - 1})`, v: c.minFleet?.total ?? 0 }, num('int', 'total')));
      fm.row++;
      fm.set(fm.row, 1, 'Conta estática', S.label);
      cs.forEach((c, i) => fm.set(fm.row, ccol(i), cf ? { f: `Configurações!${colName(ccol(i))}${CF.estatica}`, v: c.staticTrucks } : c.staticTrucks, num('int', 'link')));
      fm.row++;
      fm.set(fm.row, 1, 'Redução contra a primeira opção', S.label);
      cs.forEach((c, i) => fm.set(fm.row, ccol(i), { f: `${colName(ccol(i))}${fm.row - 2}/$B$${fm.row - 2}-1`, v: (c.minFleet?.total ?? 0) / (cs[0].minFleet?.total || 1) - 1 }, num('pct')));
      fm.row += 2;
      if (images.fleets) {
        fm.images.push({ key: 'fleets', r: fm.row, c: 1, w: 700, h: 700 * (images.fleets.h / images.fleets.w) });
        fm.row += Math.ceil((700 * (images.fleets.h / images.fleets.w)) / 20) + 1;
      }
    }
    if (d.sweep) {
      const sw = d.sweep;
      fm.row++;
      fm.set(fm.row, 1, `Curva da frota mínima – ${sw.config}${sw.circuit ? ` · ${sw.circuit}` : ''} · ${sw.scenario}`, S.labelB);
      fm.row++;
      const c0 = cs.length + 3;
      header(fm, ['Caminhões', 't/dia', 'IC95 mín.', 'IC95 máx.', '% da meta']);
      for (const p of sw.points) {
        const r = fm.row;
        fm.set(r, 1, p.trucks, num('int'));
        fm.set(r, 2, p.tpd, num('int'));
        fm.set(r, 3, p.lo, num('int'));
        fm.set(r, 4, p.hi, num('int'));
        fm.set(r, 5, { f: `IF(${sw.target}>0,B${r}/${sw.target},0)`, v: sw.target > 0 ? p.tpd / sw.target : 0 }, num('pct'));
        fm.row++;
      }
      void c0;
      if (images.sweep) fm.images.push({ key: 'sweep', r: fm.row + 1, c: 1, w: 700, h: 700 * (images.sweep.h / images.sweep.w) });
    }
  }

  /* ---------------------------------- Decisão ---------------------------------- */
  if (d.decision) {
    const dc = d.decision;
    const ds = add('Decisão', SW, 'Decisão no horizonte do plano', `DADO EXPORTADO DO T2 MINEPLANNER · resultados e decisão · ${dc.periods} períodos · ${(dc.rate * 100).toFixed(1).replace('.', ',')}% a.a. · critério ${dc.criterion}`, S.swTag, [44, 10, 10, 16, 16, 16, 14, 10]);
    header(ds, ['Opção', 'Atende', 'Pico', 'Investimento', 'VPL dos custos', 'VPL das toneladas', 'Custo nivelado', 'Trocas']);
    for (const r of dc.rows) {
      const rr = ds.row;
      const chosen = r.id === dc.chosenId;
      const k = (fmt: keyof typeof F) => (chosen ? num(fmt, 'rec') : num(fmt));
      ds.set(rr, 1, r.name, chosen ? st.get({ bold: true, fill: REC_FILL, border: 'bottom' }) : S.label);
      ds.set(rr, 2, r.allOk ? 'sim' : 'não', S.label);
      ds.set(rr, 3, r.peakTrucks, k('int'));
      ds.set(rr, 4, r.capex, k('mi'));
      ds.set(rr, 5, r.npvCost, k('mi'));
      ds.set(rr, 6, r.npvTonnes, k('int'));
      ds.set(rr, 7, { f: `IF(F${rr}>0,E${rr}/F${rr},0)`, v: r.costPerT }, k('brl'));
      ds.set(rr, 8, r.replacements, k('int'));
      ds.row++;
    }
    ds.row++;
    noteRow(ds, 'Memória: custo nivelado = VPL dos custos ÷ VPL das toneladas (valores descontados no meio de cada período).', 8, S.memoLine);
    if (dc.chosenPeriods.length) {
      ds.row++;
      header(ds, ['Período da opção escolhida', 'Caminhões', 'Compras', 'Trocas', 'Toneladas', 'Custo (R$)', 'R$/t', '']);
      for (const p of dc.chosenPeriods) {
        const r = ds.row;
        ds.set(r, 1, p.label, S.label);
        ds.set(r, 2, p.trucks, num('int'));
        ds.set(r, 3, p.bought, num('int'));
        ds.set(r, 4, p.replaced, num('int'));
        ds.set(r, 5, p.tonnes, num('int'));
        ds.set(r, 6, p.total, num('brl0'));
        ds.set(r, 7, { f: `IF(E${r}>0,F${r}/E${r},0)`, v: p.tonnes > 0 ? p.total / p.tonnes : 0 }, num('brl'));
        ds.row++;
      }
    }
    if (dc.sens.length) {
      ds.row++;
      header(ds, ['Sensibilidade (±20%)', 'Com −20%', 'Com +20%', 'Muda?']);
      for (const s of dc.sens) {
        ds.set(ds.row, 1, s.label, S.label);
        ds.set(ds.row, 2, s.low, num('d2'));
        ds.set(ds.row, 3, s.high, num('d2'));
        ds.set(ds.row, 4, s.changes ? 'sim' : 'não', S.label);
        ds.row++;
      }
    }
  }

  /* ---------------------------------- Resumo ---------------------------------- */
  const rs = new Sheet('Resumo', ACC);
  rs.widths = [44, ...cs.map(() => 20), 4];
  const ncol = Math.max(4, cs.length + 1);
  for (let c = 1; c <= ncol; c++) rs.set(1, c, c === 1 ? `${d.opts.client ? `${d.opts.client} · ` : ''}${d.opts.title}` : null, S.title);
  rs.heights.set(1, 28);
  rs.set(2, 1, d.recommended ? `Recomendação: ${d.recommended.tag} · ${d.recommended.name}` : 'Resumo do dimensionamento', st.get({ bold: true, size: 11, color: ACCD }));
  rs.heights.set(2, 22);
  rs.row = 4;
  if (d.recommended && cf) {
    const i = recIdx;
    const col = colName(ccol(i));
    const kp: [Val, string, keyof typeof F | null][] = [
      [d.recommended.tag, 'configuração recomendada', null],
      [{ f: `Configurações!${col}${CF.minima}`, v: d.recommended.fleet }, 'caminhões', 'int'],
      [{ f: `Configurações!${col}${CF.rpt}`, v: d.recommended.cost.perT }, 'R$ por tonelada', 'brl'],
      [{ f: `Configurações!${col}${CF.ocup}`, v: d.recommended.dump?.occupancy ?? 0 }, 'ocupação da descarga', 'pct0'],
    ];
    kp.forEach(([v, l, fmt], k) => {
      rs.set(4, k + 1, v, fmt ? st.get({ bold: true, size: 18, color: ACCD, fill: REC_FILL, align: 'center', fmt: F[fmt] }) : S.kpi);
      rs.set(5, k + 1, l, S.kpiL);
    });
    rs.heights.set(4, 36);
    rs.heights.set(5, 26);
    rs.row = 7;
    const hd = ['Indicador', ...cs.map((c) => `${c.tag} · ${c.name}`)];
    hd.forEach((t, k) => rs.set(rs.row, k + 1, t, k ? headC(cs[k - 1].color) : S.headL));
    rs.heights.set(rs.row, 30);
    rs.row++;
    const line = (label: string, key: string, fmt: keyof typeof F, vals: number[]) => {
      rs.set(rs.row, 1, label, S.label);
      cs.forEach((c, k) => rs.set(rs.row, ccol(k), { f: `Configurações!${colName(ccol(k))}${CF[key]}`, v: vals[k] }, isRec(k) ? st.get({ fmt: F[fmt], color: '008000', bold: true, fill: REC_FILL, border: 'bottom' }) : num(fmt, 'link')));
      rs.row++;
    };
    line('Ciclo estático (min)', 'ciclo', 'd1', cs.map((c) => c.cycle.cycleMin));
    line('Produção de 1 caminhão (t/h)', 'tph', 'd1', cs.map((c) => c.tph));
    line('Frota estática', 'estatica', 'int', cs.map((c) => c.staticTrucks));
    line('Frota mínima simulada', 'minima', 'int', cs.map((c) => c.fleet));
    line('Custo por tonelada (R$/t)', 'rpt', 'brl', cs.map((c) => c.cost.perT));
    line('Investimento na frota', 'inv', 'mi', cs.map((c) => c.cost.invest));
    line('Ocupação da descarga', 'ocup', 'pct0', cs.map((c) => c.dump?.occupancy ?? 0));
    rs.row++;
  } else {
    const rows: [string, number, keyof typeof F][] = [
      [d.labels.target, d.target.monthT, 'int'],
      ['Caminhões necessários (estático)', d.statik.needed, 'int'],
      ['Atendimento do sistema', d.statik.ratio, 'pct'],
    ];
    for (const [l, v, f] of rows) {
      rs.set(rs.row, 1, l, S.label);
      rs.set(rs.row, 2, v, num(f));
      rs.row++;
    }
    rs.row++;
  }
  const legend: [string, string, number][] = [
    ['MEMÓRIA DE CÁLCULO', 'abas laranja: contas com fórmulas vivas', st.get({ bold: true, size: 9, color: ACCD, fill: MEMO_FILL, border: 'leftThick', borderColor: ACC })],
    ['DADO EXPORTADO DO T2 MINEPLANNER', 'abas verdes: valores das rodadas de simulação', st.get({ bold: true, size: 9, color: SW, fill: SW_FILL, border: 'leftThick', borderColor: SW })],
    ['COMO LER', 'caixas azuis: interpretação do resultado', st.get({ bold: true, size: 9, color: BLUE, fill: READ_FILL, border: 'leftThick', borderColor: BLUE })],
  ];
  for (const [t, desc, sty] of legend) {
    rs.set(rs.row, 1, t, sty);
    rs.set(rs.row, 2, desc, st.get({ size: 9, color: MUTED }));
    rs.row++;
  }
  rs.set(rs.row + 1, 1, 'Cores das células: azul = dado de entrada · preto = fórmula · verde = fórmula que puxa outra aba · fundo laranja-claro = opção recomendada.', st.get({ italic: true, size: 9, color: MUTED }));
  rs.row += 3;
  noteRow(rs, d.conclusion, ncol);
  if (d.notes.length) for (const n of d.notes) noteRow(rs, `• ${n}`, ncol, st.get({ wrap: true, color: INK }));
  if (images.cost) rs.images.push({ key: 'cost', r: rs.row + 1, c: 1, w: 640, h: 640 * (images.cost.h / images.cost.w) });
  sheets.unshift(rs);

  /* --------------------------------- Gráficos --------------------------------- */
  const figs = (['cycleStatic', 'cycleRoutes', 'cycleSim', 'decisionPeriods'] as const).filter((k) => images[k]);
  if (figs.length) {
    const gr = add('Gráficos', INK, 'Gráficos do relatório', 'Imagens geradas pelo T2 MinePlanner com os mesmos números das outras abas', S.plainTag, [14, 14, 14, 14, 14, 14, 14, 14]);
    let r = 4;
    for (const k of figs) {
      const im = images[k]!;
      const w = 760;
      const hh = w * (im.h / im.w);
      gr.images.push({ key: k, r, c: 1, w, h: hh });
      r += Math.ceil(hh / 20) + 2;
    }
  }

  /* ---------------------------------- pacote ---------------------------------- */
  const files: { name: string; data: string | Uint8Array }[] = [];
  const media = new Set<string>();
  sheets.forEach((sh, i) => {
    let drawingRel: string | undefined;
    if (sh.images.length) {
      drawingRel = 'rIdDr';
      const n = i + 1;
      const anchors = sh.images
        .map((im, k) => {
          media.add(im.key);
          return `<xdr:oneCellAnchor><xdr:from><xdr:col>${im.c - 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${im.r - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(im.w * 9525)}" cy="${Math.round(im.h * 9525)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="${im.key}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdI${k}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
        })
        .join('');
      files.push({
        name: `xl/drawings/drawing${n}.xml`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`,
      });
      files.push({
        name: `xl/drawings/_rels/drawing${n}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sh.images
          .map((im, k) => `<Relationship Id="rIdI${k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${im.key}.png"/>`)
          .join('')}</Relationships>`,
      });
      files.push({
        name: `xl/worksheets/_rels/sheet${n}.xml.rels`,
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`,
      });
    }
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sh.xml(drawingRel) });
  });
  for (const k of media) files.push({ name: `xl/media/${k}.png`, data: images[k]!.data });
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets
    .map((s, i) => `<sheet name="${x(s.name)}" sheetId="${i + 1}" r:id="rIdS${i + 1}"/>`)
    .join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map((_, i) => `<Relationship Id="rIdS${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('')}<Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')}${files
    .filter((f) => f.name.startsWith('xl/drawings/drawing'))
    .map((f) => `<Override PartName="/${f.name}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`)
    .join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  return makeZip([
    { name: '[Content_Types].xml', data: types },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core(d.opts.title, d.opts.company) },
    { name: 'docProps/app.xml', data: APP },
    { name: 'xl/workbook.xml', data: workbook },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: st.xml() },
    ...files,
  ]);
}
