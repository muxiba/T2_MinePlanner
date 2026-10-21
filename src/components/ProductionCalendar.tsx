import React from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, isBefore, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { DetailedPremises, DailyLog } from '../types';
import { Calendar as CalendarIcon, Clock, Truck, AlertCircle, AlertTriangle, Download } from 'lucide-react';

interface ProductionCalendarProps {
  results: any;
  premises: DetailedPremises;
  logs: Record<string, DailyLog[]>;
}

const ProductionCalendar: React.FC<ProductionCalendarProps> = ({ results, premises, logs }) => {
  const [includeExtraFleet, setIncludeExtraFleet] = React.useState(false);
  const [view, setView] = React.useState<'mes' | 'tabela'>('mes');
  const today = new Date();
  const monthStart = startOfMonth(new Date(premises.year, premises.month));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  const horasCalendarioMina = premises.dailyCalendar?.reduce((acc, curr) => acc + curr.hoursMina, 0) || (days.length * 24);
  const horasCalendarioPlanta = premises.dailyCalendar?.reduce((acc, curr) => acc + curr.hoursPlanta, 0) || (days.length * 24);

  const getActualForDay = (day: Date) => {
    let total = 0;
    (Object.values(logs) as DailyLog[][]).forEach(routeLogs => {
      routeLogs.forEach(log => {
        if (isSameDay(new Date(log.date), day)) {
          total += log.actualProduction;
        }
      });
    });
    return total;
  };

  // Calculate extra daily impact
  const extraDailyImpact = includeExtraFleet ? (results.allocatedExtraMonthlyProduction / premises.calendarDays) : 0;
  const extraRemainingImpact = includeExtraFleet && results.remainingDays > 0 ? (results.allocatedExtraMonthlyProduction / results.remainingDays) : 0;

  /** Valores de um dia (mesma lógica de antes, só reunida para a grade e a tabela). */
  const computeDay = (day: Date) => {
    const dayData = premises.dailyCalendar.find(d => isSameDay(parseISO(d.date), day));
    const isMaintenanceMina = !!dayData?.isMaintenanceMina;
    const isMaintenancePlanta = !!dayData?.isMaintenancePlanta;
    const isToday = isSameDay(day, today);
    // Base planejada vem da META (consumo da planta), não da simulação da frota
    const plannedMina = results.plannedDailyROM;
    const plannedPlanta = results.plannedDailyPlanta;
    const plannedRejeito = results.plannedDailyRejeito;
    let extraMina = 0;
    let extraPlanta = 0;
    let extraRejeito = 0;
    if (includeExtraFleet) {
      (premises.extraAllocations || []).forEach(alloc => {
        const route = results.routeResults.find((r: any) => r.id === alloc.routeId);
        if (route) {
          const hourlyProd = (alloc.truckCount * route.unitaryProductivity * (route.mechanicalAvailability / 100) * (route.operationalEfficiency / 100));
          const dailyProd = hourlyProd * (results.effectiveHoursPerMonthMina / premises.calendarDays);
          const name = route.name.toLowerCase();
          if (name.includes('terminal')) extraPlanta += dailyProd;
          else if (name.includes('baia')) extraRejeito += dailyProd;
          else extraMina += dailyProd;
        }
      });
    }
    const actual = getActualForDay(day);
    const extraRemainingImpactMina = includeExtraFleet && results.remainingDays > 0 ? (extraMina * premises.calendarDays / results.remainingDays) : 0;
    const recalculated = (day >= today && results.daysPassed > 0) ? (results.requiredDailyProduction + extraRemainingImpactMina) : 0;
    const maxPossibleDaily = results.plantCapacityTPH * results.effectiveHoursPerDayPlanta;
    const isOverLimit = recalculated > maxPossibleDaily;
    // o realizado lançado é ROM da mina: compara com o ROM planejado do dia
    const romPlan = plannedMina + extraMina;
    const pct = actual > 0 && romPlan > 0 ? (actual / romPlan) * 100 : null;
    return { dayData, isMaintenanceMina, isMaintenancePlanta, isMaintenance: isMaintenanceMina || isMaintenancePlanta, isToday, plannedMina, plannedPlanta, plannedRejeito, extraMina, extraPlanta, extraRejeito, actual, recalculated, isOverLimit, romPlan, pct };
  };

  const fmt0 = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const extraToggle = (
    <label className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-black/60">
      <input type="checkbox" checked={includeExtraFleet} onChange={(e) => setIncludeExtraFleet(e.target.checked)} className="h-4 w-4 rounded text-emerald-500" />
      Incluir frota extra
    </label>
  );

  /** Grade do mês: um cartão por dia com planejado, realizado e meta recalculada. */
  const renderMonthGrid = () => {
    const lead = (monthStart.getDay() + 6) % 7; // segunda = 0
    const weekdays = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
    return (
      <div className="rounded-3xl border border-black/5 bg-white p-4 shadow-sm md:p-6">
        <div className="grid grid-cols-7 gap-1.5 md:gap-2">
          {weekdays.map((w) => (
            <div key={w} className="pb-1 text-center text-[10px] font-bold tracking-widest text-black/40 uppercase">{w}</div>
          ))}
          {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
          {days.map((day, idx) => {
            const d = computeDay(day);
            const future = !d.actual && d.recalculated > 0;
            const tone = d.pct === null ? '' : d.pct >= 100 ? 'border-emerald-200 bg-emerald-50' : d.pct >= 90 ? 'border-amber-200 bg-amber-50' : 'border-red-200 bg-red-50';
            return (
              <div
                key={idx}
                className={`min-h-[92px] rounded-xl border p-2 text-[11px] leading-tight ${tone || (d.isMaintenance ? 'border-orange-200 bg-orange-50/60' : 'border-black/5 bg-[#FAFBFB]')} ${d.isToday ? 'ring-2 ring-emerald-500' : ''}`}
                title={`${format(day, "EEEE, dd/MM", { locale: ptBR })}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-sm font-bold text-black/75">{format(day, 'dd')}</span>
                  {d.isMaintenance && (
                    <span className="rounded bg-orange-500 px-1 text-[9px] font-bold text-white uppercase" title={`Parada ${d.isMaintenanceMina ? 'mina' : ''}${d.isMaintenanceMina && d.isMaintenancePlanta ? ' e ' : ''}${d.isMaintenancePlanta ? 'planta' : ''}`}>
                      parada
                    </span>
                  )}
                </div>
                <p className="text-black/45">plano <span className="font-mono text-black/65">{fmt0(d.romPlan)}</span></p>
                {d.actual > 0 ? (
                  <p className="mt-0.5 font-mono font-bold text-black/80">
                    {fmt0(d.actual)} t <span className={d.pct! >= 100 ? 'text-emerald-700' : d.pct! >= 90 ? 'text-amber-700' : 'text-red-600'}>{Math.round(d.pct!)}%</span>
                  </p>
                ) : future ? (
                  <p className={`mt-0.5 font-mono font-bold ${d.isOverLimit ? 'text-red-600' : d.recalculated > d.romPlan ? 'text-amber-700' : 'text-emerald-700'}`}>
                    meta {fmt0(d.recalculated)}
                    {d.isOverLimit && <span className="block text-[9px] uppercase">acima da planta</span>}
                  </p>
                ) : (
                  <p className="mt-0.5 text-black/25">sem lançamento</p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-black/55">
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-emerald-200 bg-emerald-50" /> realizado ≥ 100% do plano</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-amber-200 bg-amber-50" /> 90–100%</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-red-200 bg-red-50" /> abaixo de 90%</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border border-orange-200 bg-orange-50" /> parada programada</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded ring-2 ring-emerald-500" /> hoje</span>
          <span>“meta” = meta recalculada pelo replanejamento (t de ROM)</span>
        </div>
      </div>
    );
  };

  const renderCalendarTable = () => (
    <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-[#F8F9FA] text-black/40 text-[10px] uppercase font-bold tracking-widest">
            <tr>
              <th className="px-4 py-3 border-b border-black/5 sticky left-0 bg-[#F8F9FA] z-10">Dia</th>
              <th className="px-4 py-3 border-b border-black/5">ROM mina planejado (t)</th>
              <th className="px-4 py-3 border-b border-black/5">Planta planejado (t)</th>
              {premises.processType === 'umido' && <th className="px-4 py-3 border-b border-black/5">Rejeito planejado (t)</th>}
              <th className="px-4 py-3 border-b border-black/5">ROM realizado (t)</th>
              <th className="px-4 py-3 border-b border-black/5 text-right">Meta recalculada (ROM)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {days.map((day, idx) => {
              const d = computeDay(day);
              return (
                <tr key={idx} className={`hover:bg-black/[0.01] ${d.isToday ? 'bg-emerald-50/50' : ''} ${d.isMaintenance ? 'bg-orange-50/40' : ''}`}>
                  <td className="px-4 py-2 text-sm font-mono sticky left-0 bg-white z-10 border-r border-black/5">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{format(day, 'dd')}</span>
                        {d.isMaintenance && <AlertCircle size={10} className="text-orange-500" />}
                      </div>
                      <span className="text-[10px] text-black/40 capitalize">{format(day, 'EEE', { locale: ptBR })}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm font-mono">
                    <div className="flex flex-col">
                      <span className="text-black/60">{fmt0(d.plannedMina + d.extraMina)}</span>
                      {d.extraMina > 0 && <span className="text-[8px] text-blue-500 font-bold">+{fmt0(d.extraMina)}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm font-mono">
                    <div className="flex flex-col">
                      <span className="text-black/60">{fmt0(d.plannedPlanta + d.extraPlanta)}</span>
                      {d.extraPlanta > 0 && <span className="text-[8px] text-blue-500 font-bold">+{fmt0(d.extraPlanta)}</span>}
                    </div>
                  </td>
                  {premises.processType === 'umido' && (
                    <td className="px-4 py-2 text-sm font-mono">
                      <div className="flex flex-col">
                        <span className="text-black/60">{fmt0(d.plannedRejeito + d.extraRejeito)}</span>
                        {d.extraRejeito > 0 && <span className="text-[8px] text-blue-500 font-bold">+{fmt0(d.extraRejeito)}</span>}
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-2 text-sm font-mono">
                    {d.actual > 0 ? (
                      <div className="flex flex-col">
                        <span className="font-bold text-emerald-600">{d.actual.toLocaleString('pt-BR')}</span>
                        {d.pct !== null && <span className={`text-[10px] ${d.pct >= 100 ? 'text-emerald-500' : 'text-red-500'}`}>{d.pct.toFixed(1)}% do plano</span>}
                      </div>
                    ) : (
                      <span className="text-black/20">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-right">
                    {d.recalculated > 0 ? (
                      <div className="flex flex-col items-end">
                        <span className={`font-bold ${d.isOverLimit ? 'text-red-600' : d.recalculated > d.romPlan ? 'text-orange-500' : 'text-emerald-600'}`}>
                          {fmt0(d.recalculated)}
                        </span>
                        {d.isOverLimit && <span className="text-[8px] text-red-500 font-bold uppercase">Limite Planta</span>}
                      </div>
                    ) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const exportToCSV = () => {
    const headers = ["Data", "Dia da Semana", "Planejado (t)", "Realizado (t)", "Desvio (t)", "Meta Recalculada (t)", "Parada Mina", "Parada Planta"];
    const rows = days.map(day => {
      const dayData = premises.dailyCalendar.find(d => isSameDay(parseISO(d.date), day));
      const actual = getActualForDay(day);
      const planned = results.plannedDailyROM;
      const deviation = actual - planned;
      const recalculated = (day >= today) ? results.requiredDailyProduction : 0;
      
      return [
        format(day, 'dd/MM/yyyy'),
        format(day, 'EEEE', { locale: ptBR }),
        planned.toFixed(2),
        actual.toFixed(2),
        deviation.toFixed(2),
        recalculated.toFixed(2),
        dayData?.isMaintenanceMina ? "Sim" : "Não",
        dayData?.isMaintenancePlanta ? "Sim" : "Não"
      ];
    });

    const csvContent = "\uFEFF" + [headers, ...rows].map(r => r.join(";")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `calendario_producao_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-500/20">
            <CalendarIcon size={24} />
          </div>
          <div>
            <h3 className="text-xl font-bold">Calendário de Produção</h3>
            <p className="text-sm text-black/40">Plano do dia (premissas), realizado (Lançamento Produção) e meta recalculada (Replanejamento)</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 bg-white text-black/60 border border-black/5 px-6 py-2.5 rounded-xl font-bold transition-all hover:bg-black/[0.02]"
          >
            <Download size={18} />
            Exportar Excel
          </button>
          
          {results.isTargetUnreachable && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl border border-red-700 animate-pulse">
              <AlertTriangle size={18} />
              <span className="text-sm font-bold uppercase tracking-wider">LIMITE DA PLANTA ATINGIDO: Meta Inalcançável</span>
            </div>
          )}
          
          {!results.isTargetUnreachable && results.isTargetAtRisk && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl border border-red-100">
              <AlertCircle size={18} />
              <span className="text-sm font-bold uppercase tracking-wider">Meta em Risco: Recalculando...</span>
            </div>
          )}
        </div>
      </div>

      {/* resumo do mês */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Meta do mês (ROM)', `${fmt0(premises.targetMonthlyROM)} t`],
          ['Realizado', `${fmt0(results.totalActualProduction)} t`],
          ['Saldo', `${fmt0(results.remainingTarget)} t`],
          ['Dias lançados / restantes', `${results.daysPassed} / ${results.remainingDays}`],
          ['Nova meta diária', `${fmt0(results.requiredDailyProduction)} t/dia`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-bold tracking-widest text-black/40 uppercase">{k}</p>
            <p className="mt-1 font-mono text-lg font-bold text-black/80">{v}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-black/10 bg-white p-1" role="tablist">
          {([['mes', 'Calendário do mês'], ['tabela', 'Tabela diária']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${view === k ? 'bg-[#151619] text-white' : 'text-black/55 hover:bg-black/[0.03]'}`}>
              {label}
            </button>
          ))}
        </div>
        {extraToggle}
      </div>

      {view === 'mes' ? renderMonthGrid() : renderCalendarTable()}

      <div className="bg-[#151619] p-8 rounded-3xl shadow-xl text-white">
        <h3 className="text-lg font-bold mb-6 text-emerald-400 flex items-center gap-2">
          <Clock size={20} />
          Resumo de Horas Efetivas e Taxas
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">Mina</h4>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-white/60">Horas Calendário</span>
              <span className="font-mono font-bold">{horasCalendarioMina.toFixed(2)}h</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-white/60">Horas Efetivas (DF x UF)</span>
              <span className="font-mono font-bold text-emerald-400">
                {results.effectiveHoursPerMonthMina.toFixed(2)}h
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-white/60">Taxa Horária Total</span>
              <span className={`font-mono font-bold ${results.isPlantOverloaded ? 'text-red-400' : 'text-emerald-400'}`}>
                {results.totalHourlyROM.toFixed(2)} t/h
              </span>
            </div>
          </div>
          <div className="space-y-4">
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">Planta</h4>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-white/60">Horas Calendário</span>
              <span className="font-mono font-bold">{horasCalendarioPlanta.toFixed(2)}h</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-white/60">Horas Efetivas (DF x UF)</span>
              <span className="font-mono font-bold text-blue-400">
                {results.effectiveHoursPerMonthPlanta.toFixed(2)}h
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-sm text-white/60">Utilização da Planta</span>
              <span className={`font-mono font-bold ${results.plantUtilization > 100 ? 'text-red-400' : 'text-blue-400'}`}>
                {results.plantUtilization.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
        
        {results.isPlantOverloaded && (
          <div className="mt-8 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4">
            <div className="p-2 bg-red-500 text-white rounded-xl">
              <AlertCircle size={20} />
            </div>
            <div>
              <p className="font-bold text-red-400">ALERTA DE PROCESSO: Capacidade da Planta Excedida</p>
              <p className="text-sm text-white/60">A produção total das rotas ({results.totalHourlyROM.toFixed(1)} t/h) ultrapassa o limite da planta ({premises.plantFeedRateTPH} t/h). O sistema limitou o planejamento automático à capacidade física.</p>
            </div>
          </div>
        )}

        <div className="mt-12 pt-8 border-t border-white/10">
          <h3 className="text-lg font-bold mb-6 text-orange-400 flex items-center gap-2">
            <Truck size={20} />
            Capacidade de Frota vs Demanda
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-xs font-bold text-white/40 uppercase tracking-widest block mb-2">Frota Mina</span>
              <div className="flex justify-between items-end">
                <span className="text-2xl font-mono font-bold">{Math.round(results.transportTph?.rom ?? premises.fleetCapacityMinaTPH).toLocaleString('pt-BR')} t/h</span>
                <span className="text-[10px] text-white/40">Necessário (úmida)</span>
              </div>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-xs font-bold text-white/40 uppercase tracking-widest block mb-2">
                {premises.processType === 'umido' ? 'Frota Baia + Terminal' : 'Frota Terminal'}
              </span>
              <div className="flex justify-between items-end">
                <span className="text-2xl font-mono font-bold">
                  {Math.round(results.transportTph ? (premises.processType === 'umido' ? results.transportTph.tailings : 0) + results.transportTph.product : (premises.processType === 'umido' ? premises.fleetCapacityBaiaTPH : 0) + premises.fleetCapacityTerminalTPH).toLocaleString('pt-BR')} t/h
                </span>
                <span className="text-[10px] text-white/40">Necessário (úmida)</span>
              </div>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-xs font-bold text-white/40 uppercase tracking-widest block mb-2">Utilização Total Frota</span>
              <div className="flex justify-between items-end">
                <span className={`text-2xl font-mono font-bold ${results.isFleetOverloaded ? 'text-red-400' : 'text-emerald-400'}`}>
                  {results.fleetUtilization.toFixed(1)}%
                </span>
                <span className="text-[10px] text-white/40">
                  {results.isFleetOverloaded ? 'Sobrecarga detectada' : 'Frota Otimizada'}
                </span>
              </div>
            </div>
          </div>
          
          {results.isFleetOverloaded && (
            <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4">
              <div className="p-2 bg-red-500 text-white rounded-xl">
                <AlertCircle size={20} />
              </div>
              <div>
                <p className="font-bold text-red-400">DÉFICIT DE FROTA DETECTADO</p>
                <p className="text-sm text-white/60">A frota atual não suporta o somatório das taxas horárias das rotas ativas. Risco de não atingir a meta ou necessidade de equipamentos adicionais.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductionCalendar;
