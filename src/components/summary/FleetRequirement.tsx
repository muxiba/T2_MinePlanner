import React, { useMemo, useState } from 'react';
import { FileDown, FileText } from 'lucide-react';
import type { DetailedPremises, Route } from '@/types';
import { buildFleetReport, type FleetReport } from '@/engine/fleetReport';
import { downloadMemo, f0, f1, f2, fbrl, fp, kv, memoDocument, note, p, table, t } from '@/sim/memo';

/** Frota necessária: o resultado consolidado do planejamento (caminhões por tipo e movimentação, carga por local, horas e custo). */

const t0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('pt-BR') : '—');
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const typesTxt = (m: FleetReport['movements'][number]) => m.types.filter((x) => x.count > 0).map((x) => `${x.count}× ${x.name}`).join(' + ') || '—';

export function fleetReportHtml(rep: FleetReport, premises: DetailedPremises) {
  const T = rep.totals;
  return memoDocument({
    title: 'Frota necessária',
    subtitle: 'Caminhões por tipo em cada movimentação, equipamentos de carga por local, horas e custo do mês',
    meta: [
      ['Consumo da planta', `${f0(premises.targetMonthlyROM)} t/mês`],
      ['Frota', rep.mixed ? 'mista' : 'um tipo'],
    ],
    sections: [
      {
        title: 'Resumo',
        body: kv([
          ['Caminhões necessários', `${f0(T.trucksRequired)} (disponíveis: ${f0(T.trucksAvailable)})`],
          ['Equipamentos de carga necessários', f0(T.loadersRequired)],
          ['Massa transportada no mês', `${f0(T.massWetT)} t úmidas`],
          ['Horas efetivas de caminhão no mês', `${f0(T.truckHours)} h`],
          ['Custo do transporte no mês (estimado)', fbrl(T.costMonth)],
        ]),
      },
      {
        title: 'Caminhões por movimentação',
        body:
          table(
            ['Movimentação', 'Material', 'DMT (m)', 't úmida/mês', 'Ciclo (min)', 'Caminhões por tipo', 'Necessários', 'Capacidade/meta', 'Horas/mês', 'Custo/mês', 'R$/t'],
            rep.movements.map((m) => [t(m.name), t(m.material), f0(m.distance), f0(m.massWetT), f1(m.cycleMin), t(typesTxt(m)), `${f0(m.needed)} (${f2(m.neededExact)})`, fp(m.ratio), f0(m.truckHours), fbrl(m.costMonth), f2(m.costPerT)]),
            { foot: ['Total', '', '', f0(T.massWetT), '', '', f0(T.trucksRequired), '', f0(T.truckHours), fbrl(T.costMonth), f2(T.massWetT > 0 ? T.costMonth / T.massWetT : 0)] },
          ) + note('Necessários = meta úmida ÷ t/mês de um caminhão (carga útil × 60 ÷ ciclo × horas efetivas), arredondado para cima; em frota mista, a composição de cada movimentação. Custo = caminhões × custo horário do modelo × horas efetivas.'),
      },
      {
        title: 'Caminhões por tipo',
        body: table(['Modelo', 'Necessários', 'Disponíveis', 'Saldo'], rep.byType.map((b) => [t(b.name), f0(b.required), f0(b.available), f0(b.available - b.required)])),
      },
      {
        title: 'Equipamentos de carga por local',
        body: rep.loaders.length
          ? table(
              ['Local', 'Equipamento', 'Caçambadas', 'Carga (min)', 'Caminhões/mês', 'Horas de carga', 'Necessários', 'Disponíveis', 'Ocupação'],
              rep.loaders.map((l) => [t(l.where), t(l.loaderName), f1(l.passes), f1(l.loadMin), f0(l.trucksLoaded), f0(l.busyH), `${f0(l.needed)} (${f2(l.neededExact)})`, l.available === null ? '—' : f0(l.available), fp(l.utilization)]),
            )
          : p('Nenhum equipamento de carga escolhido nos locais (Premissas → Locais e movimentações → Carregamento dos caminhões).'),
      },
    ],
  });
}

const FleetRequirement: React.FC<{ routes: Route[]; premises: DetailedPremises }> = ({ routes, premises }) => {
  const rep = useMemo(() => buildFleetReport(routes, premises), [routes, premises]);
  const [busy, setBusy] = useState(false);
  const T = rep.totals;
  const pdf = async () => {
    setBusy(true);
    try {
      const { memoToPdf } = await import('@/sim/memoPdf');
      await memoToPdf(fleetReportHtml(rep, premises), 'frota-necessaria.pdf');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-black/[0.07] bg-white p-6" aria-labelledby="frota-necessaria">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="frota-necessaria" className="text-lg font-semibold tracking-tight">Frota necessária</h3>
          <p className="mt-1 max-w-3xl text-sm text-black/55">
            O resultado do planejamento: caminhões por tipo em cada movimentação, equipamentos de carga por local, horas e custo do mês. As entradas ficam nas Premissas Fundamentais.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => void pdf()} className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5 disabled:opacity-50">
            <FileDown size={15} /> PDF
          </button>
          <button type="button" onClick={() => downloadMemo(fleetReportHtml(rep, premises), 'frota-necessaria.html')} className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 px-3 py-1.5 text-sm font-medium hover:bg-black/5">
            <FileText size={15} /> HTML
          </button>
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ['Caminhões necessários', `${T.trucksRequired}`, `de ${T.trucksAvailable} disponíveis`, T.trucksRequired > T.trucksAvailable],
          ['Equipamentos de carga', `${T.loadersRequired}`, 'necessários nos locais', false],
          ['Massa no mês', `${t0(T.massWetT)} t`, 'úmidas transportadas', false],
          ['Horas de caminhão', `${t0(T.truckHours)} h`, 'efetivas no mês', false],
          ['Custo do transporte', brl(T.costMonth), `${n1(T.massWetT > 0 ? T.costMonth / T.massWetT : 0)} R$/t`, false],
        ].map(([k, v, s, bad]) => (
          <div key={k as string} className="rounded-xl bg-black/[0.03] px-3 py-2">
            <p className="text-[11px] text-black/50">{k}</p>
            <p className={`text-lg font-semibold tabular-nums ${bad ? 'text-red-700' : ''}`}>{v}</p>
            <p className="text-[11px] text-black/45">{s}</p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-black/45">
              <th className="py-1.5 pr-2 font-medium">Movimentação</th>
              <th className="py-1.5 pr-2 font-medium">Material</th>
              <th className="py-1.5 pr-2 text-right font-medium">t úmida/mês</th>
              <th className="py-1.5 pr-2 font-medium">Caminhões por tipo</th>
              <th className="py-1.5 pr-2 text-right font-medium">Necessários</th>
              <th className="py-1.5 pr-2 text-right font-medium">Capacidade / meta</th>
              <th className="py-1.5 pr-2 text-right font-medium">Horas/mês</th>
              <th className="py-1.5 text-right font-medium">Custo/mês</th>
            </tr>
          </thead>
          <tbody>
            {rep.movements.map((m) => (
              <tr key={m.id} className="border-b border-black/5">
                <td className="py-1.5 pr-2 font-medium">{m.name}</td>
                <td className="py-1.5 pr-2 text-black/60">{m.material}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t0(m.massWetT)}</td>
                <td className="py-1.5 pr-2">{typesTxt(m)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums"><b>{m.needed}</b> <span className="text-black/45">({m.neededExact.toLocaleString('pt-BR', { maximumFractionDigits: 2 })})</span></td>
                <td className={`py-1.5 pr-2 text-right tabular-nums ${m.ratio < 1 ? 'font-semibold text-red-700' : ''}`}>{Math.round(m.ratio * 100)}%</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{t0(m.truckHours)}</td>
                <td className="py-1.5 text-right tabular-nums">{brl(m.costMonth)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rep.byType.length > 1 && (
        <p className="mt-3 text-sm text-black/65">
          Por tipo: {rep.byType.map((b) => `${b.name} ${b.required} de ${b.available}`).join(' · ')}
        </p>
      )}
      {rep.loaders.length > 0 && (
        <p className="mt-2 text-sm text-black/65">
          Carga: {rep.loaders.map((l) => `${l.where} — ${l.needed}× ${l.loaderName} (${Math.round(l.utilization * 100)}% ocupado)`).join(' · ')}
        </p>
      )}
    </section>
  );
};

export default FleetRequirement;
