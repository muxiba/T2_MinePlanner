/**
 * Converte o memorial (HTML gerado por memo.ts) em PDF vetorial A4 com jsPDF + autotable:
 * texto selecionável, tabelas com cabeçalho repetido em cada página e numeração de páginas.
 * Lê a estrutura do HTML (seções, parágrafos, fórmulas, tabelas, listas, barras), então o PDF
 * tem sempre o mesmo conteúdo do memorial em HTML.
 */

type RGB = [number, number, number];
const INK: RGB = [21, 22, 25];
const MUTED: RGB = [95, 97, 104];
const ACCENT: RGB = [4, 120, 87];
const SOFT: RGB = [245, 247, 248];

/** A fonte padrão do PDF (WinAnsi) não tem alguns símbolos: troca por equivalentes. */
const clean = (s: string) =>
  s
    .replace(/ | /g, ' ')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/↔/g, '<->')
    .replace(/[−‒]/g, '-')
    .replace(/≈/g, '~')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/Σ/g, 'Soma')
    .replace(/…/g, '...')
    .replace(/³/g, '3')
    .replace(/²/g, '2')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\xff–—•]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const text = (el: Element | null | undefined) => clean(el?.textContent ?? '');

function hexToRgb(css: string): RGB {
  const m = css.match(/#([0-9a-f]{6})/i);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  const r = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)/);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : [42, 120, 214];
}

export async function memoToPdf(html: string, filename: string) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const autoTable = (autoTableMod as unknown as { default: (doc: unknown, opts: unknown) => void }).default;
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const CW = W - 2 * M;
  let y = M;
  // figuras SVG (desenho da rede) viram imagem PNG para o PDF
  const figs = new Map<Element, { url: string; w: number; h: number }>();
  for (const f of dom.querySelectorAll('figure.fig')) {
    const svg = f.querySelector('svg');
    if (!svg) continue;
    const w = Number(svg.getAttribute('width')) || 1000;
    const h = Number(svg.getAttribute('height')) || 600;
    try {
      figs.set(f, { url: await svgToPng(new XMLSerializer().serializeToString(svg), w * 2, h * 2), w, h });
    } catch {
      /* sem a figura, o resto do memorial sai normalmente */
    }
  }
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
  const need = (h: number) => {
    if (y + h > H - 16) {
      doc.addPage();
      y = M;
    }
  };
  const para = (t: string, size = 9, color: RGB = INK, style: 'normal' | 'bold' | 'italic' = 'normal', indent = 0) => {
    if (!t) return;
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(t, CW - indent) as string[];
    const lh = size * 0.42;
    for (const ln of lines) {
      need(lh);
      doc.text(ln, M + indent, y + lh * 0.8);
      y += lh;
    }
    y += 1.2;
  };

  /* capa */
  const cover = dom.querySelector('header.cover');
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 3, 'F');
  y = M + 2;
  para(text(cover?.querySelector('.k')).toUpperCase(), 8, ACCENT, 'bold');
  para(text(cover?.querySelector('h1')), 18, INK, 'bold');
  para(text(cover?.querySelector('.s')), 10, MUTED);
  const meta = [...(cover?.querySelectorAll('.meta > div') ?? [])].map((d) => `${text(d.querySelector('b'))}: ${clean((d.textContent ?? '').replace(d.querySelector('b')?.textContent ?? '', ''))}`);
  if (meta.length) para(meta.join('   |   '), 8.5, MUTED);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(0.6);
  doc.line(M, y + 1, W - M, y + 1);
  y += 5;

  const table = (el: HTMLTableElement) => {
    const head = [...el.querySelectorAll('thead th')].map((th) => text(th));
    const rowOf = (tr: Element) =>
      [...tr.querySelectorAll('td,th')].map((td) => ({ content: text(td), styles: { halign: td.classList.contains('n') ? 'right' : 'left', fontStyle: td.querySelector('b') ? 'bold' : 'normal', textColor: td.querySelector('.neg') ? [185, 28, 28] : INK } }));
    const body = [...el.querySelectorAll('tbody tr')].map(rowOf);
    const foot = [...el.querySelectorAll('tfoot tr')].map(rowOf);
    const wide = head.length > 9;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 16 },
      head: head.length ? [head] : undefined,
      body,
      foot: foot.length ? foot : undefined,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: wide ? 6.3 : 7.6, cellPadding: wide ? 1 : 1.5, lineColor: [227, 229, 232], lineWidth: 0.1, textColor: INK, overflow: 'linebreak' },
      headStyles: { fillColor: INK, textColor: [255, 255, 255], fontStyle: 'bold' },
      footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 251, 251] },
      showFoot: 'lastPage',
    });
    y = lastY() + 3;
  };

  const kv = (el: Element) => {
    const dts = [...el.querySelectorAll('dt')];
    const body = dts.map((dt) => [text(dt), text(dt.nextElementSibling)]);
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: 16 },
      body,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.4, textColor: INK, lineColor: [227, 229, 232], lineWidth: { bottom: 0.1 } },
      columnStyles: { 0: { textColor: MUTED, cellWidth: CW * 0.42 }, 1: { fontStyle: 'bold' } },
    });
    y = lastY() + 3;
  };

  const formula = (el: Element) => {
    const lines = [...el.querySelectorAll(':scope > div')].map((d) => text(d));
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.8);
    const wrapped = lines.flatMap((l) => doc.splitTextToSize(l, CW - 8) as string[]);
    const lh = 3.4;
    let i = 0;
    while (i < wrapped.length) {
      const room = Math.max(1, Math.floor((H - 16 - y - 6) / lh));
      if (room < 2) {
        doc.addPage();
        y = M;
        continue;
      }
      const chunk = wrapped.slice(i, i + room);
      const h = chunk.length * lh + 5;
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(M, y, CW, h, 1.5, 1.5, 'F');
      doc.setTextColor(226, 232, 240);
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.8);
      chunk.forEach((ln, k) => doc.text(ln, M + 4, y + 3.6 + k * lh + 1));
      y += h + 2.5;
      i += chunk.length;
    }
    doc.setTextColor(...INK);
  };

  const list = (el: Element) => {
    for (const li of el.querySelectorAll(':scope > li')) {
      const t = text(li);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.8);
      const lines = doc.splitTextToSize(t, CW - 5) as string[];
      const lh = 3.7;
      need(lh);
      doc.setTextColor(...ACCENT);
      doc.text('•', M + 1, y + lh * 0.8);
      doc.setTextColor(...INK);
      for (const ln of lines) {
        need(lh);
        doc.text(ln, M + 5, y + lh * 0.8);
        y += lh;
      }
      y += 0.6;
    }
    y += 1.5;
  };

  const bars = (el: Element) => {
    const rows = [...el.querySelectorAll('.bar')];
    const max = 1;
    for (const r of rows) {
      need(5);
      const label = text(r.querySelector('.bl'));
      const val = text(r.querySelector('.bv'));
      const i = r.querySelector('.bt i') as HTMLElement | null;
      const w = parseFloat(i?.style.width ?? '0') / 100;
      const color = hexToRgb(i?.getAttribute('style') ?? '');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(...INK);
      doc.text((doc.splitTextToSize(label, 62) as string[])[0], M, y + 3);
      doc.setFillColor(...SOFT);
      doc.roundedRect(M + 64, y + 0.6, CW - 64 - 26, 3.2, 1, 1, 'F');
      doc.setFillColor(...color);
      doc.roundedRect(M + 64, y + 0.6, Math.max(0.6, (CW - 64 - 26) * Math.min(max, w)), 3.2, 1, 1, 'F');
      doc.text(val, W - M, y + 3, { align: 'right' });
      y += 4.6;
    }
    y += 2;
  };

  const callout = (el: Element) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(text(el), CW - 8) as string[];
    const h = lines.length * 3.9 + 5;
    need(h);
    const warn = el.classList.contains('warn');
    doc.setFillColor(...((warn ? [255, 251, 235] : [236, 253, 245]) as RGB));
    doc.setDrawColor(...((warn ? [252, 211, 77] : [167, 243, 208]) as RGB));
    doc.roundedRect(M, y, CW, h, 1.5, 1.5, 'FD');
    doc.setTextColor(...INK);
    lines.forEach((ln, k) => doc.text(ln, M + 4, y + 4.3 + k * 3.9));
    y += h + 3;
  };

  const walk = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h2') {
      need(14);
      y += 2;
      doc.setFillColor(236, 253, 245);
      doc.rect(M, y, CW, 7.5, 'F');
      doc.setFillColor(...ACCENT);
      doc.rect(M, y, 1.2, 7.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...INK);
      doc.text(text(el), M + 4, y + 5.2);
      y += 10.5;
    } else if (tag === 'h3') {
      need(10);
      y += 1;
      para(text(el), 10, INK, 'bold');
    } else if (tag === 'p') para(text(el), el.classList.contains('note') ? 8 : 9, el.classList.contains('note') ? MUTED : INK);
    else if (tag === 'figure' && figs.has(el)) {
      const f = figs.get(el)!;
      let wmm = CW;
      let hmm = (CW * f.h) / f.w;
      const maxH = H - 16 - M - 4;
      if (hmm > maxH) {
        wmm = (wmm * maxH) / hmm;
        hmm = maxH;
      }
      need(hmm + 2);
      doc.addImage(f.url, 'PNG', M + (CW - wmm) / 2, y, wmm, hmm);
      y += hmm + 3;
    } else if (tag === 'table') table(el as HTMLTableElement);
    else if (tag === 'dl') kv(el);
    else if (tag === 'ul' || tag === 'ol') list(el);
    else if (el.classList.contains('formula')) formula(el);
    else if (el.classList.contains('bars')) bars(el);
    else if (el.classList.contains('callout')) callout(el);
    else for (const c of el.children) walk(c);
  };

  for (const sec of dom.querySelectorAll('section')) for (const c of sec.children) walk(c);

  const foot = dom.querySelector('footer');
  if (foot) {
    y += 3;
    para(text(foot), 7.5, MUTED);
  }

  // rodapé com numeração
  const n = doc.getNumberOfPages();
  const title = text(cover?.querySelector('h1'));
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.setDrawColor(227, 229, 232);
    doc.setLineWidth(0.2);
    doc.line(M, H - 11, W - M, H - 11);
    doc.text(`T2 Mine Planner · ${title}`, M, H - 7);
    doc.text(`Página ${i} de ${n}`, W - M, H - 7, { align: 'right' });
  }
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}

function svgToPng(xml: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new Error('sem canvas'));
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('figura inválida'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
}
