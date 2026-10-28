import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from './zip';
import { buildContent } from './content';
import { buildDocx } from './docx';
import { buildPptx } from './pptx';
import { buildXlsx } from './xlsx';
import type { ReportData } from './data';
import { fmt, pct } from './theme';

const dec = new TextDecoder();

/** lê os nomes das entradas de um ZIP "stored" */
function names(zip: Uint8Array) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: string[] = [];
  let p = 0;
  while (p + 4 <= zip.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const n = dv.getUint16(p + 26, true);
    out.push(dec.decode(zip.subarray(p + 30, p + 30 + n)));
    p += 30 + n + size;
  }
  return out;
}
function entry(zip: Uint8Array, name: string) {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let p = 0;
  while (p + 4 <= zip.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true);
    const n = dv.getUint16(p + 26, true);
    if (dec.decode(zip.subarray(p + 30, p + 30 + n)) === name) return dec.decode(zip.subarray(p + 30 + n, p + 30 + n + size));
    p += 30 + n + size;
  }
  return '';
}

const cycle = { loadMin: 4.5, loadedMin: 38.3, weighMin: 2.5, dumpMin: 3, emptyMin: 25.6, queueMin: 10, otherMin: 1, cycleMin: 84.9 };
const cfg = (id: string, tag: string, payload: number, fleet: number, perT: number) => ({
  id,
  tag,
  name: `Caminhão ${tag} <${payload} t>`,
  color: 'C8641E',
  payloadT: payload,
  dumpMin: 2.5,
  maneuverMin: 0.5,
  costFixedPerH: 30,
  costVarPerH: 150,
  price: 1.4e6,
  cycle,
  tph: (payload * 60) / 84.9,
  circuits: [{ name: 'Mina → Usina', destination: 'Usina', tonnes: 300000, payloadT: payload, tph: (payload * 60) / 84.9, productiveH: 256.9, truckT: 6000, exact: fleet - 0.4, trucks: fleet, needTph: 1100, ...cycle }],
  staticTrucks: fleet,
  staticExact: fleet - 0.4,
  dump: { destination: 'Usina', stations: 2, capacityTph: 1364, needTph: 850, occupancy: 0.62, capacityOne: 682 },
  matrix: [],
  fleet,
  fleetSource: 'estático' as const,
  cost: { fixedMonth: 1e6, varMonth: 1.5e6, total: 2.5e6, perT, invest: fleet * 1.4e6 },
});

function sample(): ReportData {
  const a = cfg('A', 'A', 34, 52, 8.5);
  const b = cfg('B', 'B', 42, 44, 7.6);
  return {
    opts: { title: 'Frota & teste', client: 'Cliente "X"', company: 'Empresa' },
    generatedAt: '2026-10-27T12:00:00Z',
    periodLabel: 'julho/2027',
    transport: true,
    labels: { target: 'Meta de transporte', delivered: 'Entregue' },
    premises: [{ label: 'Dias', value: '', unit: 'dias', raw: 26 }],
    hours: { workDays: 26, calendarDays: 31, hoursPerDay: 13, df: 0.95, uf: 0.8, eo: 1, effectiveH: 256.88, calendarH: 744 },
    target: { monthT: 300000, dayT: 11538, tpd: 11538, periodT: 300000, flows: [{ name: 'Mina → Usina', t: 300000, tpd: 11538 }] },
    statik: {
      movements: [{ name: 'Mina → Usina', kind: 'ROM', material: '', distance: 21000, massT: 300000, payloadT: 34, cycle, effectiveH: 256.88, tph: 24, truckMonthT: 6165, exact: 48.7, needed: 49, allocated: 49, ratio: 1.01 }],
      needed: 49,
      allocated: 49,
      premiseFleet: 55,
      meets: true,
      ratio: 1.01,
      bottleneck: null,
    },
    sim: { available: true, configsCount: 2, scenarios: [{ id: 's1', name: 'Base', text: '13 h/dia' }], replications: 10, days: 6, warmupH: 2, targetTpd: 11538 },
    configs: [a, b],
    recommended: b,
    recommendedWhy: ['menor custo'],
    conclusion: 'Recomendamos B.',
    notes: ['Confirmar a moega'],
    stateLabels: {} as ReportData['stateLabels'],
  } as ReportData;
}

describe('zip', () => {
  it('calcula o CRC-32 padrão', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('lista as entradas na ordem', () => {
    expect(names(makeZip([{ name: 'a.txt', data: 'oi' }, { name: 'pasta/b.xml', data: '<x/>' }]))).toEqual(['a.txt', 'pasta/b.xml']);
  });
});

describe('formatação', () => {
  it('usa o padrão brasileiro', () => {
    expect(fmt(12345.678, 1)).toBe('12.345,7');
    expect(pct(0.623)).toBe('62%');
  });
});

describe('conteúdo do relatório', () => {
  it('monta resumo, passos, custos e conclusão com memórias de cálculo', () => {
    const doc = buildContent(sample());
    const titles = doc.sections.map((s) => (s[0].t === 'h1' ? s[0].text : ''));
    expect(titles[0]).toBe('A resposta em uma página');
    expect(titles).toContain('Custo por tonelada e investimento');
    expect(titles[titles.length - 1]).toBe('A escolha e por quê');
    expect(doc.sections.flat().filter((b) => b.t === 'box' && b.kind === 'memo').length).toBeGreaterThan(3);
    expect(doc.equations).toContain('eq_frota');
  });
});

describe('arquivos do Office', () => {
  it('Word: partes obrigatórias e texto escapado', () => {
    const z = buildDocx(sample());
    expect(names(z)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml']));
    const xml = entry(z, 'word/document.xml');
    expect(xml).toContain('CLIENTE &quot;X&quot;');
    expect(xml).toContain('Caminhão B &lt;42 t&gt;');
    expect(xml).not.toContain('<42 t>');
  });
  it('apresentação: um slide por passo e a escolha no fim', () => {
    const z = buildPptx(sample());
    const slides = names(z).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides.length).toBeGreaterThanOrEqual(6);
    expect(entry(z, `ppt/slides/slide${slides.length}.xml`)).toContain('A ESCOLHA');
  });
  it('Excel: fórmulas vivas com valor calculado', () => {
    const z = buildXlsx(sample());
    const ns = names(z);
    expect(ns).toEqual(expect.arrayContaining(['xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']));
    const wb = entry(z, 'xl/workbook.xml');
    expect(wb).toContain('name="Resumo"');
    expect(wb).toContain('name="Configurações"');
    const sheets = ns.filter((n) => n.startsWith('xl/worksheets/sheet')).map((n) => entry(z, n));
    expect(sheets.some((s) => s.includes('<f>ROUNDUP('))).toBe(true);
    expect(sheets.join('')).not.toMatch(/<f>[^<]*NaN/);
  });
});
