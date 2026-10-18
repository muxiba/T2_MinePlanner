/**
 * Empresa informada no cadastro que ainda não foi criada no banco (por exemplo,
 * quando o login exige confirmar o e-mail antes). Fica só neste navegador.
 */
const KEY = 't2mp.pendingCompany';

export interface PendingCompany {
  name: string;
  cnpj: string | null;
}

export function savePendingCompany(c: PendingCompany) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* armazenamento indisponível */
  }
}

export function readPendingCompany(): PendingCompany | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingCompany) : null;
  } catch {
    return null;
  }
}

export function clearPendingCompany() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignora */
  }
}
