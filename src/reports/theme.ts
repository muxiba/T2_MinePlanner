/** Padrão visual dos relatórios: paleta, caixas e formatação de números (pt-BR). */

export const INK = '1E2B30';
export const MUTED = '5E6B70';
export const ACC = 'C8641E';
export const ACCD = 'A8521A';
export const BLUE = '2B5F80';
export const PAPER = 'F5F2EC';
export const LINE = 'DDD5C7';
export const SW = '1F6F63';
/** fundos: memória de cálculo, dado do software, como ler, recomendada */
export const MEMO_FILL = 'F6F2EA';
export const SW_FILL = 'E5F2EF';
export const READ_FILL = 'E3EDF3';
export const REC_FILL = 'FBE9D9';
export const TOTAL_FILL = 'EFE7D8';
export const ZEBRA = 'FAF8F4';

/** cores das configurações (A, B, C…): cinza, laranja, azul, verde, vinho, ocre */
export const CONFIG_COLORS = ['7D8A90', 'C8641E', '2B5F80', '3E8E6A', '8A4F7D', 'B08A2E'];
export const lighten = (hex: string, f = 0.82) => {
  const n = parseInt(hex, 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * f);
  return [ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
};

export const FONT = 'Arial';
export const MATH_FONT = '"Cambria Math", "STIX Two Math", "Times New Roman", serif';

/* ------------------------------- números ------------------------------- */
const nf = (d: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const cache = [0, 1, 2, 3, 4].map(nf);
export const fmt = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : cache[Math.min(4, d)].format(v));
export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${fmt(v * 100, d)}%`);
export const brl = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `R$ ${fmt(v, d)}`);
export const mi = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `R$ ${fmt(v / 1e6, d)} mi`);
export const minutes = (v: number) => `${fmt(v, 1)} min`;
export const dateBR = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
};
