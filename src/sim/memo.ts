/**
 * Memoriais de cálculo e metodologia para baixar (HTML pronto para imprimir ou salvar em PDF).
 * Cada memorial traz as premissas usadas, as fórmulas com os números do estudo, a metodologia
 * da simulação e os resultados, para conferência por quem não acompanhou o estudo.
 */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const f0 = (n: number) => (Number.isFinite(n) ? (Math.round(n) || 0).toLocaleString('pt-BR') : '—');
export const f1 = (n: number) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—');
export const f2 = (n: number) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
export const fp = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—');
export const fbrl = (n: number) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—');
export const fbrl2 = (n: number) => (Number.isFinite(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

export interface MemoSection {
  title: string;
  /** HTML do corpo (use os helpers abaixo) */
  body: string;
}

/** Parágrafo */
export const p = (html: string) => `<p>${html}</p>`;
/** Texto escapado */
export const t = (s: unknown) => esc(s);
/** Caixa de fórmula */
export const formula = (lines: string[]) => `<div class="formula">${lines.map((l) => `<div>${l}</div>`).join('')}</div>`;
/** Nota */
export const note = (html: string) => `<p class="note">${html}</p>`;
/** Lista */
export const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

/** Tabela; células numéricas alinhadas à direita (as que começam com dígito, sinal ou R$). */
export function table(head: string[], rows: (string | number)[][], opts: { foot?: (string | number)[]; first?: 'left' } = {}) {
  const NUM = /^[−\-+]?\s?(R\$\s?)?[−\-]?[\d.,]+(\s?(%|h|t|min|L|mi|p\.p\.|L\/h|L\/t|\/t))?(\s?[–→\/]\s?[−\-]?(R\$\s?)?[\d.,]+(\s?(%|h|t|mi|\/t))?)?(\s?mi)?$/;
  const num = (v: string | number) => typeof v === 'number' || NUM.test(String(v).replace(/<[^>]+>/g, '').replace(/\u00a0/g, ' ').trim());
  const td = (v: string | number, tag: 'td' | 'th') => `<${tag}${num(v) ? ' class="n"' : ''}>${typeof v === 'number' ? f0(v) : v}</${tag}>`;
  return `<table${head.length > 9 ? ' class="wide"' : ''}><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => td(v, 'td')).join('')}</tr>`).join('')}</tbody>${
    opts.foot ? `<tfoot><tr>${opts.foot.map((v) => td(v, 'td')).join('')}</tr></tfoot>` : ''
  }</table>`;
}

/** Pares chave–valor em duas colunas. */
export const kv = (pairs: [string, string][]) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

/** Barras horizontais simples (para composição de tempo e de custo). */
export function bars(rows: { label: string; value: number; color: string; text?: string }[]) {
  const max = Math.max(1e-9, ...rows.map((r) => r.value));
  return `<div class="bars">${rows
    .map(
      (r) =>
        `<div class="bar"><span class="bl">${r.label}</span><span class="bt"><i style="width:${Math.max(0.5, (r.value / max) * 100)}%;background:${r.color}"></i></span><span class="bv">${r.text ?? f1(r.value)}</span></div>`,
    )
    .join('')}</div>`;
}

export function memoDocument(opts: { title: string; subtitle: string; sections: MemoSection[]; meta?: [string, string][] }) {
  const date = new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
  const toc = opts.sections.map((s, i) => `<li><a href="#s${i + 1}">${esc(s.title)}</a></li>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)}</title>
<style>
:root{--ink:#151619;--muted:#5f6168;--line:#e3e5e8;--soft:#f5f7f8;--accent:#047857;--accent2:#2a78d6;}
*{box-sizing:border-box}
figure.fig{margin:8px 0;overflow-x:auto}figure.fig svg{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:8px}
body{margin:0;background:#eef0f2;color:var(--ink);font:13px/1.55 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:900px;margin:24px auto;background:#fff;padding:40px 48px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
header.cover{border-bottom:3px solid var(--accent);padding-bottom:16px;margin-bottom:20px}
header.cover .k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}
header.cover h1{margin:6px 0 4px;font-size:26px;line-height:1.2}
header.cover .s{color:var(--muted);font-size:14px}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.meta div{background:var(--soft);border-radius:8px;padding:8px 10px}
.meta b{display:block;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600}
nav ol{columns:2;margin:0;padding-left:18px;color:var(--muted)}
nav a{color:inherit;text-decoration:none}
section{margin-top:26px;break-inside:auto}
h2{font-size:17px;margin:0 0 10px;padding:6px 0 6px 12px;border-left:4px solid var(--accent);background:linear-gradient(90deg,#ecfdf5,transparent)}
h3{font-size:14px;margin:16px 0 6px}
p{margin:6px 0}
.note{color:var(--muted);font-size:12px}
ul{margin:6px 0;padding-left:20px}
.formula{background:#0f172a;color:#e2e8f0;border-radius:8px;padding:10px 14px;font:12px/1.7 "JetBrains Mono",ui-monospace,Consolas,monospace;margin:8px 0;white-space:pre-wrap}
.formula b{color:#6ee7b7;font-weight:600}
table{width:100%;border-collapse:collapse;margin:8px 0;font-size:12px}
thead th{background:var(--ink);color:#fff;font-weight:600;text-align:left;padding:6px 8px}
thead th:first-child{border-top-left-radius:6px}thead th:last-child{border-top-right-radius:6px}
td{padding:5px 8px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:nth-child(even) td{background:#fafbfb}
tfoot td{font-weight:700;border-top:2px solid var(--ink);background:var(--soft)}
.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
th.n{text-align:right}
table.wide{font-size:10.5px}table.wide td,table.wide th{padding:4px 5px}
.neg{color:#b91c1c}.pos{color:#047857}
dl.kv{display:grid;grid-template-columns:minmax(200px,40%) 1fr;margin:8px 0;border-top:1px solid var(--line)}
dl.kv dt,dl.kv dd{margin:0;padding:5px 8px;border-bottom:1px solid var(--line)}
dl.kv dt{color:var(--muted)}dl.kv dd{font-weight:600;font-variant-numeric:tabular-nums}
.bars{margin:8px 0}.bar{display:grid;grid-template-columns:230px 1fr 90px;gap:8px;align-items:center;margin:3px 0;font-size:12px}
.bt{background:var(--soft);border-radius:4px;height:12px;overflow:hidden}.bt i{display:block;height:100%;border-radius:4px}
.bv{text-align:right;font-variant-numeric:tabular-nums}
.callout{border:1px solid #a7f3d0;background:#ecfdf5;border-radius:8px;padding:10px 14px;margin:10px 0}
.warn{border-color:#fcd34d;background:#fffbeb}
footer{margin-top:30px;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}
.tools{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px;max-width:900px;margin:0 auto}
.tools button{border:0;border-radius:8px;padding:8px 14px;background:var(--ink);color:#fff;font:600 13px Inter,system-ui,sans-serif;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;max-width:none;box-shadow:none;border-radius:0;padding:0}.tools{display:none}section{break-inside:avoid-page}table{break-inside:auto}tr{break-inside:avoid}@page{size:A4;margin:14mm 12mm}}
</style></head><body>
<div class="tools"><button onclick="window.print()">Imprimir / salvar em PDF</button></div>
<div class="page">
<header class="cover"><div class="k">Memorial de cálculo e metodologia</div><h1>${esc(opts.title)}</h1><div class="s">${esc(opts.subtitle)}</div>
<div class="meta"><div><b>Emitido em</b>${esc(date)}</div>${(opts.meta ?? []).map(([k, v]) => `<div><b>${esc(k)}</b>${esc(v)}</div>`).join('')}</div></header>
<nav><ol>${toc}</ol></nav>
${opts.sections.map((s, i) => `<section id="s${i + 1}"><h2>${i + 1}. ${esc(s.title)}</h2>${s.body}</section>`).join('\n')}
<footer>Gerado pelo T2 Mine Planner. Os valores refletem as premissas e os dados cadastrados no momento da emissão. Resultados da simulação são estimativas estatísticas (médias de repetições com sorteios diferentes) e devem ser conferidos com dados de campo.</footer>
</div></body></html>`;
}

/** Baixa o memorial como arquivo .html (abre em qualquer navegador; “Imprimir / salvar em PDF” gera o PDF). */
export function downloadMemo(html: string, filename: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.html') ? filename : `${filename}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Abre o memorial em outra aba, pronto para imprimir. */
export function openMemo(html: string) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
