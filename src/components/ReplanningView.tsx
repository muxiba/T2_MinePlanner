import React, { useMemo, useState } from "react";
import { DetailedPremises } from "../types";
import { AlertTriangle, CheckCircle2, Download, Info, ChevronDown } from "lucide-react";

/**
 * Replanejamento: leitura do que já foi lançado em "Lançamento Produção" e da nova meta diária.
 * Só apresentação: todos os números vêm de calculateTotalProduction (results).
 */

interface ReplanningViewProps {
  results: any;
  premises: DetailedPremises;
}

const t0 = (n: number) => Math.round(n || 0).toLocaleString("pt-BR");
const p1 = (n: number) => `${(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const ReplanningView: React.FC<ReplanningViewProps> = ({ results, premises }) => {
  const {
    totalActualProduction,
    remainingTarget,
    requiredDailyProduction,
    totalDailyROM,
    suggestions,
    remainingDays,
    daysPassed,
  } = results;
  const [showAll, setShowAll] = useState(false);

  const target = premises.targetMonthlyROM || 0;
  const progressPercent = target > 0 ? (totalActualProduction / target) * 100 : 0;
  const days: any[] = results.dailyBreakdown ?? [];
  const loggedDays = days.filter((d) => d.actualMina !== null);
  const expectedToDate = loggedDays.reduce((a, d) => a + (d.plannedMina || 0), 0);
  const gapToDate = totalActualProduction - expectedToDate;
  const originalDaily = premises.calendarDays > 0 ? target / premises.calendarDays : 0;
  const plantDailyMax = (results.plantCapacityTPH || 0) * (results.effectiveHoursPerDayPlanta || 0);
  const dailyGap = Math.max(0, requiredDailyProduction - totalDailyROM);
  const unreachable = !!results.isTargetUnreachable;
  const atRisk = !unreachable && !!results.isTargetAtRisk;
  const status = unreachable ? "bad" : atRisk ? "warn" : "ok";

  const exportToCSV = () => {
    const rows = [
      ["Indicador", "Valor"],
      ["Meta mensal (t)", target.toFixed(2)],
      ["Realizado acumulado (t)", totalActualProduction.toFixed(2)],
      ["Previsto até agora (t)", expectedToDate.toFixed(2)],
      ["Progresso (%)", progressPercent.toFixed(2)],
      ["Saldo restante (t)", remainingTarget.toFixed(2)],
      ["Dias com lançamento", daysPassed],
      ["Dias restantes", remainingDays],
      ["Meta diária original (t/dia)", originalDaily.toFixed(2)],
      ["Nova meta diária (t/dia)", requiredDailyProduction.toFixed(2)],
      ["Capacidade da frota (t/dia)", totalDailyROM.toFixed(2)],
      ["Status", unreachable ? "Inalcançável" : atRisk ? "Risco" : "OK"],
    ];
    const csvContent = "﻿" + rows.map((r) => r.join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([csvContent], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `replanejamento_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // recomendações próprias do replanejamento ficam em destaque; o diagnóstico da frota fica recolhido
  const replanTips = (suggestions as string[]).filter((s) => /META INALCAN|demanda horária|Perda estimada|Aumentar frota|Melhorar Efici|ALERTA CR/i.test(s));
  const otherTips = (suggestions as string[]).filter((s) => !replanTips.includes(s));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-black/80">Replanejamento de produção</h2>
          <p className="max-w-3xl text-sm text-black/50">
            Usa o que foi lançado em <b>Lançamento Produção</b>. O saldo da meta do mês é dividido pelos dias que ainda não têm lançamento: essa é a nova meta diária.
          </p>
        </div>
        <button onClick={exportToCSV} className="flex items-center gap-2 rounded-xl border border-black/5 bg-white px-5 py-2.5 text-sm font-bold text-black/60 hover:bg-black/[0.02]">
          <Download size={16} /> Exportar Excel
        </button>
      </div>

      {/* ---------------------- conta do replanejamento ---------------------- */}
      <section className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <p className="mb-4 text-xs font-bold tracking-widest text-black/40 uppercase">Como a nova meta diária é calculada</p>
        <div className="flex flex-wrap items-stretch gap-2">
          <Step label="Meta do mês" value={`${t0(target)} t`} />
          <Op>−</Op>
          <Step label="Realizado (lançado)" value={`${t0(totalActualProduction)} t`} sub={`${daysPassed} dia(s) lançados`} tone="ok" />
          <Op>=</Op>
          <Step label="Saldo" value={`${t0(remainingTarget)} t`} />
          <Op>÷</Op>
          <Step label="Dias sem lançamento" value={`${remainingDays}`} sub={`de ${premises.calendarDays} no mês`} />
          <Op>=</Op>
          <Step
            label={unreachable ? "Nova meta diária (acima da planta)" : "Nova meta diária"}
            value={`${t0(requiredDailyProduction)} t/dia`}
            sub={`original: ${t0(originalDaily)} t/dia`}
            tone={status}
            big
          />
        </div>
      </section>

      {/* ------------------------------ status ------------------------------ */}
      <div
        className={`flex items-start gap-3 rounded-2xl border px-5 py-4 text-sm ${
          status === "bad" ? "border-red-200 bg-red-50 text-red-900" : status === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"
        }`}
        role="status"
      >
        {status === "ok" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
        <div>
          {unreachable ? (
            <>
              <b>A meta não cabe mais no mês.</b> Seriam {t0(requiredDailyProduction)} t/dia, mas a planta processa no máximo {t0(plantDailyMax)} t/dia ({results.plantCapacityTPH} t/h).
              Perda estimada de ROM: <b>{t0(results.productionLoss)} t</b>
              {premises.processType === "umido" ? ` (produto ${t0(results.productionLossPlanta)} t, rejeito ${t0(results.productionLossRejeito)} t)` : ""}.
            </>
          ) : atRisk ? (
            <>
              <b>Meta em risco.</b> A frota atual entrega {t0(totalDailyROM)} t/dia e a nova meta pede {t0(requiredDailyProduction)} t/dia: faltam <b>{t0(dailyGap)} t/dia</b>
              {totalDailyROM > 0 ? ` (+${p1((dailyGap / totalDailyROM) * 100)})` : ""}. Veja as ações abaixo ou ajuste a frota em 2. Dimensionamento de Frota.
            </>
          ) : (
            <>
              <b>Meta sob controle.</b> A frota entrega {t0(totalDailyROM)} t/dia e a nova meta pede {t0(requiredDailyProduction)} t/dia
              {totalDailyROM > 0 ? ` (folga de ${t0(totalDailyROM - requiredDailyProduction)} t/dia)` : ""}.
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ------------------------- progresso + gráfico ------------------------- */}
        <section className="space-y-5 rounded-3xl border border-black/5 bg-white p-6 shadow-sm lg:col-span-2">
          <div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-bold tracking-widest text-black/40 uppercase">Progresso do mês</p>
                <p className="font-mono text-3xl font-bold text-emerald-600">{p1(progressPercent)}</p>
              </div>
              <p className="text-right text-sm text-black/55">
                Previsto até agora: <b className="font-mono">{t0(expectedToDate)} t</b>
                <br />
                <span className={gapToDate >= 0 ? "text-emerald-700" : "text-red-600"}>
                  {gapToDate >= 0 ? "Adiantado" : "Atrasado"} {t0(Math.abs(gapToDate))} t
                </span>
              </p>
            </div>
            <div className="relative h-4 w-full overflow-hidden rounded-full bg-[#F1F3F4]">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(progressPercent, 100)}%` }} />
              {target > 0 && (
                <div className="absolute top-0 h-full w-0.5 bg-black/60" style={{ left: `${Math.min((expectedToDate / target) * 100, 100)}%` }} title="Previsto até agora" />
              )}
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-black/45">
              <span>{t0(totalActualProduction)} t realizadas</span>
              <span>▏ previsto até agora</span>
              <span>meta {t0(target)} t</span>
            </div>
          </div>

          <CumulativeChart days={days} target={target} />
        </section>

        {/* ------------------------------ resumo ------------------------------ */}
        <section className="space-y-1 rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-3 text-xs font-bold tracking-widest text-black/40 uppercase">Resumo</p>
          <Row label="Dias lançados / restantes" value={`${daysPassed} / ${remainingDays}`} />
          <Row label="Meta diária original" value={`${t0(originalDaily)} t/dia`} />
          <Row label="Nova meta diária" value={`${t0(requiredDailyProduction)} t/dia`} strong />
          <Row label="Capacidade atual da frota" value={`${t0(totalDailyROM)} t/dia`} />
          <Row label="Capacidade máxima da planta" value={`${t0(plantDailyMax)} t/dia`} />
          <Row label="Déficit diário" value={`${t0(dailyGap)} t/dia`} tone={dailyGap > 0 ? "bad" : undefined} />
          <Row
            label="Eficiência necessária"
            value={p1(Math.min(100, (requiredDailyProduction / (totalDailyROM / (premises.eoMina / 100))) * 100) || 0)}
            hint="Rendimento (DF × UF) que a frota precisaria para entregar a nova meta diária"
          />
        </section>
      </div>

      {/* ------------------------------ ações ------------------------------ */}
      <section className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
        <p className="mb-4 text-xs font-bold tracking-widest text-black/40 uppercase">Ações sugeridas</p>
        {replanTips.length ? (
          <ul className="space-y-2">
            {replanTips.map((s, i) => (
              <li key={i} className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                {s}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-black/60">
            <CheckCircle2 size={16} className="text-emerald-600" /> Nenhuma ação necessária: a capacidade atual atende a nova meta diária.
          </p>
        )}
        {otherTips.length > 0 && (
          <div className="mt-4">
            <button onClick={() => setShowAll((v) => !v)} className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline" aria-expanded={showAll}>
              <ChevronDown size={15} className={showAll ? "rotate-180" : ""} /> {showAll ? "Ocultar" : "Ver"} diagnóstico da frota
            </button>
            {showAll && (
              <ul className="mt-2 space-y-1 text-sm text-black/60">
                {otherTips.map((s, i) => (
                  <li key={i} className={s.startsWith("-") ? "pl-4" : ""}>
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="mt-4 flex items-start gap-2 text-xs text-black/45">
          <Info size={13} className="mt-0.5 shrink-0" /> Dias com lançamento usam o realizado; os demais recebem o saldo dividido igualmente, limitado à capacidade da planta no dia.
        </p>
      </section>
    </div>
  );
};

const Step: React.FC<{ label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad"; big?: boolean }> = ({ label, value, sub, tone, big }) => (
  <div
    className={`min-w-[130px] flex-1 rounded-2xl px-4 py-3 ${
      tone === "bad" ? "bg-red-50" : tone === "warn" ? "bg-amber-50" : big ? "bg-emerald-50" : "bg-[#F8F9FA]"
    }`}
  >
    <p className="text-[10px] font-bold tracking-widest text-black/45 uppercase">{label}</p>
    <p className={`font-mono font-bold ${big ? "text-2xl" : "text-lg"} ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "ok" || big ? "text-emerald-700" : "text-black/80"}`}>{value}</p>
    {sub && <p className="text-[11px] text-black/45">{sub}</p>}
  </div>
);

const Op: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center px-1 font-mono text-xl text-black/30" aria-hidden>
    {children}
  </div>
);

const Row: React.FC<{ label: string; value: string; strong?: boolean; tone?: "bad"; hint?: string }> = ({ label, value, strong, tone, hint }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-black/5 py-2 last:border-b-0" title={hint}>
    <span className="text-sm text-black/55">{label}</span>
    <span className={`font-mono text-sm ${strong ? "font-bold text-black/85" : "font-semibold"} ${tone === "bad" ? "text-red-600" : ""}`}>{value}</span>
  </div>
);

/** Acumulado do mês: previsto (plano), realizado (lançado) e projeção (realizado + nova meta diária). */
const CumulativeChart: React.FC<{ days: any[]; target: number }> = ({ days, target }) => {
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => {
    let plan = 0;
    let real = 0;
    let proj = 0;
    let lastLogged = -1;
    days.forEach((d, i) => d.actualMina !== null && (lastLogged = i));
    return days.map((d, i) => {
      plan += d.plannedMina || 0;
      if (d.actualMina !== null) real += d.actualMina;
      proj += d.actualMina !== null ? d.actualMina : d.requiredMina || 0;
      return { day: new Date(d.date).getUTCDate(), plan, real: i <= lastLogged ? real : null, proj: i >= lastLogged ? proj : null, logged: d.actualMina !== null };
    });
  }, [days]);
  if (!data.length) return null;
  const W = 640;
  const H = 220;
  const L = 52;
  const R = 12;
  const T = 12;
  const B = 26;
  const maxY = Math.max(target, ...data.map((d) => Math.max(d.plan, d.proj ?? 0, d.real ?? 0))) * 1.05 || 1;
  const x = (i: number) => L + (i / Math.max(1, data.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);
  const path = (k: "plan" | "real" | "proj") =>
    data
      .map((d, i) => (d[k] === null ? null : `${x(i)},${y(d[k] as number)}`))
      .filter(Boolean)
      .map((p, i) => `${i ? "L" : "M"}${p}`)
      .join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxY);
  const h = hover !== null ? data[hover] : null;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-black/60">
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 border-t-2 border-dashed border-black/35" /> Previsto</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 bg-emerald-600" /> Realizado</span>
        <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-5 bg-amber-500" /> Projeção com a nova meta</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Produção acumulada de ROM no mês" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-black/[0.07]" />
            <text x={L - 6} y={y(v) + 3} textAnchor="end" className="fill-black/40 text-[10px]">{v >= 1000 ? `${Math.round(v / 1000)} mil` : Math.round(v)}</text>
          </g>
        ))}
        {target > 0 && <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="currentColor" strokeWidth={1} className="text-black/40" strokeDasharray="2 3" />}
        {target > 0 && <text x={W - R} y={y(target) - 4} textAnchor="end" className="fill-black/50 text-[10px]">meta {t0(target)} t</text>}
        <path d={path("plan")} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="5 4" className="text-black/35" />
        <path d={path("proj")} fill="none" stroke="currentColor" strokeWidth={2} className="text-amber-500" />
        <path d={path("real")} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-emerald-600" />
        {data.map((d, i) => (i % Math.ceil(data.length / 10) === 0 || i === data.length - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" className="fill-black/40 text-[10px]">{d.day}</text>
        ))}
        {data.map((_, i) => (
          <rect key={i} x={x(i) - (W - L - R) / data.length / 2} y={T} width={(W - L - R) / data.length} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
        {h && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="currentColor" className="text-black/20" />}
      </svg>
      <p className="h-5 text-xs text-black/60">
        {h ? (
          <>Dia {h.day}: previsto {t0(h.plan)} t{h.real !== null ? ` · realizado ${t0(h.real)} t` : ""}{h.proj !== null ? ` · projeção ${t0(h.proj)} t` : ""}</>
        ) : (
          "Passe o mouse no gráfico para ver os valores do dia."
        )}
      </p>
    </div>
  );
};

export default ReplanningView;
