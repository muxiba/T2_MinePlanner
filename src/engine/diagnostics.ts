/**
 * Pente fino: o que impede uma mudança nas premissas (velocidade, equipamento de carga, DMT…) de mudar o resultado.
 * Cada item diz o que está travando e traz uma correção de um clique.
 */
import type { DetailedPremises, Route } from '../types';
import { catalogOf, loadUseKeys, loadUseOf } from './fleet';
import { mixedOn } from './mix';

export interface Diagnostic {
  id: string;
  level: 'trava' | 'aviso' | 'info';
  title: string;
  detail: string;
  fixLabel?: string;
  fix?: (routes: Route[], premises: DetailedPremises) => { routes?: Route[]; premises?: DetailedPremises };
}

const names = (rs: Route[]) => rs.slice(0, 4).map((r) => r.name).join(', ') + (rs.length > 4 ? ` e mais ${rs.length - 4}` : '');

export function diagnose(routes: Route[], premises: DetailedPremises): Diagnostic[] {
  const out: Diagnostic[] = [];
  const act = routes.filter((r) => r.active);
  const ids = (rs: Route[]) => new Set(rs.map((r) => r.id));

  const informed = act.filter((r) => r.cycleMode === 'informed' && (r.cycleTime || 0) > 0);
  if (informed.length) {
    const s = ids(informed);
    out.push({
      id: 'ciclo-informado',
      level: 'trava',
      title: `${informed.length} rota(s) com ciclo informado`,
      detail: `${names(informed)}: o ciclo foi fixado (por exemplo pelo botão “Usar no dimensionamento” da simulação). Velocidade, DMT, paradas e tempo de carga não mudam mais essas rotas.`,
      fixLabel: 'Voltar ao ciclo calculado',
      fix: (rs) => ({ routes: rs.map((r) => (s.has(r.id) ? { ...r, cycleMode: 'calculated' as const, isManualOverride: false, fleetMode: r.fleetMode === 'manual' || !r.fleetMode ? ('inteiro' as const) : r.fleetMode } : r)) }),
    });
  }

  const dedicated = act.filter((r) => !!r.loader);
  if (dedicated.length && (premises.nodes?.length ?? 0) > 0) {
    const s = ids(dedicated);
    out.push({
      id: 'carga-rota',
      level: 'trava',
      title: `${dedicated.length} rota(s) com equipamento de carga próprio`,
      detail: `${names(dedicated)}: usam o equipamento gravado na rota, não o do local. Trocar o modelo na tabela de equipamentos de carga não muda essas rotas.`,
      fixLabel: 'Usar o equipamento do local',
      fix: (rs) => ({ routes: rs.map((r) => (s.has(r.id) ? { ...r, loader: undefined } : r)) }),
    });
  }

  const fixedTimes = act.filter((r) => (r.loadMin !== undefined && r.loadMin >= 0) || (r.dumpMin !== undefined && r.dumpMin >= 0));
  if (fixedTimes.length) {
    const s = ids(fixedTimes);
    out.push({
      id: 'tempos-rota',
      level: 'aviso',
      title: `${fixedTimes.length} rota(s) com tempo de carga ou basculamento digitado`,
      detail: `${names(fixedTimes)}: o tempo digitado na rota vale no lugar do equipamento do local e das premissas.`,
      fixLabel: 'Limpar os tempos das rotas',
      fix: (rs) => ({ routes: rs.map((r) => (s.has(r.id) ? { ...r, loadMin: undefined, dumpMin: undefined } : r)) }),
    });
  }

  if (mixedOn(premises)) {
    const sp = (premises.fleetTypes ?? []).filter((t) => (t.speedLoaded ?? 0) > 0 || (t.speedEmpty ?? 0) > 0);
    if (sp.length)
      out.push({
        id: 'velocidade-tipo',
        level: 'aviso',
        title: `${sp.length} tipo(s) de caminhão com velocidade própria`,
        detail: 'Na frota por tipo, a velocidade do tipo vale no lugar da velocidade cheio/vazio das premissas. Mudar a velocidade das premissas não muda esses tipos.',
        fixLabel: 'Usar a velocidade das premissas',
        fix: (_rs, p) => ({ premises: { ...p, fleetTypes: (p.fleetTypes ?? []).map((t) => ({ ...t, speedLoaded: undefined, speedEmpty: undefined })) } }),
      });
    if ((premises.mixMode ?? 'auto') === 'estatistico')
      out.push({
        id: 'estatistico',
        level: 'info',
        title: 'Frota mista em modo estatístico',
        detail: 'As rotas sem botão ligado recebem fração de caminhão (caminhões compartilhados). Rotas com “Inteiro acima” recebem números inteiros.',
        fixLabel: 'Caminhões inteiros em todas',
        fix: (rs) => ({ routes: rs.map((r) => (r.active ? { ...r, fleetMode: 'inteiro' as const } : r)) }),
      });
  }

  const manual = act.filter((r) => (r.fleetMode ?? 'manual') === 'manual' && !(r.cycleMode === 'informed'));
  if (manual.length && !(mixedOn(premises) && (premises.mixMode ?? 'auto') === 'manual')) {
    const s = ids(manual);
    out.push({
      id: 'frota-manual',
      level: 'aviso',
      title: `${manual.length} rota(s) com caminhões digitados`,
      detail: `${names(manual)}: a necessidade é recalculada, mas os caminhões alocados não acompanham as premissas.`,
      fixLabel: 'Ajustar à meta (inteiro acima)',
      fix: (rs) => ({ routes: rs.map((r) => (s.has(r.id) ? { ...r, fleetMode: 'inteiro' as const, isManualOverride: false } : r)) }),
    });
  }

  // locais sem modelo de equipamento: tempo de carga vem das premissas
  const nodes = premises.nodes ?? [];
  const noClass: string[] = [];
  for (const n of nodes) {
    const keys = loadUseKeys(n, act);
    for (const k of keys) {
      const u = loadUseOf(n, k, keys);
      if (u.mode === 'own' && !u.classId && !premises.defaultLoaderClassId) noClass.push(n.name);
    }
  }
  const first = catalogOf(premises).loaders[0];
  if (noClass.length && first)
    out.push({
      id: 'carga-padrao',
      level: 'trava',
      title: 'Locais sem modelo de equipamento de carga',
      detail: `${[...new Set(noClass)].slice(0, 4).join(', ')}: sem modelo escolhido e sem equipamento padrão, o tempo de carga é o das premissas (${premises.loadingTime} min); trocar o porte do equipamento não muda nada.`,
      fixLabel: `Usar ${first.name} como padrão`,
      fix: (_rs, p) => ({ premises: { ...p, defaultLoaderClassId: first.id } }),
    });
  return out;
}
