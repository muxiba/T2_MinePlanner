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

  const renderCalendarTable = (title: string, color: string) => (
    <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden">
      <div className={`p-4 ${color} text-white font-bold text-center flex items-center justify-center gap-2 relative`}>
        <CalendarIcon size={18} />
        {title}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-xl border border-white/10">
          <input 
            type="checkbox" 
            id="extra-fleet-toggle"
            checked={includeExtraFleet}
            onChange={(e) => setIncludeExtraFleet(e.target.checked)}
            className="w-4 h-4 rounded border-white/20 bg-transparent text-emerald-500 focus:ring-emerald-500"
          />
          <label htmlFor="extra-fleet-toggle" className="text-[10px] uppercase tracking-widest cursor-pointer select-none">Incluir Frota Extra</label>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead className="bg-[#F8F9FA] text-black/40 text-[10px] uppercase font-bold tracking-widest">
            <tr>
              <th className="px-4 py-3 border-b border-black/5 sticky left-0 bg-[#F8F9FA] z-10">Dia</th>
              <th className="px-4 py-3 border-b border-black/5">ROM Mina (t)</th>
              <th className="px-4 py-3 border-b border-black/5">Planta (t)</th>
              {premises.processType === 'umido' && <th className="px-4 py-3 border-b border-black/5">Rejeito (t)</th>}
              <th className="px-4 py-3 border-b border-black/5">Realizado Total (t)</th>
              <th className="px-4 py-3 border-b border-black/5 text-right">Meta Recalculada (Mina)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {days.map((day, idx) => {
              const dayData = premises.dailyCalendar.find(d => isSameDay(parseISO(d.date), day));
              const isMaintenanceMina = dayData?.isMaintenanceMina;
              const isMaintenancePlanta = dayData?.isMaintenancePlanta;
              const isMaintenance = isMaintenanceMina || isMaintenancePlanta;
              
              const isToday = isSameDay(day, today);
              
              // Base planned values come from the TARGET (Consumo Planta meta), not from fleet simulation
              const plannedMina = results.plannedDailyROM;
              const plannedPlanta = results.plannedDailyPlanta;
              const plannedRejeito = results.plannedDailyRejeito;

              // Extra impact per type of route
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

              const totalPlanned = plannedMina + plannedPlanta + plannedRejeito + extraMina + extraPlanta + extraRejeito;
              const actual = getActualForDay(day);
              
              // Recalculated target logic (Mina focus)
              const extraRemainingImpactMina = includeExtraFleet && results.remainingDays > 0 ? (extraMina * premises.calendarDays / results.remainingDays) : 0;
              const recalculated = (day >= today && results.daysPassed > 0) ? (results.requiredDailyProduction + extraRemainingImpactMina) : 0;
              const maxPossibleDaily = results.plantCapacityTPH * results.effectiveHoursPerDayPlanta;
              const isOverLimit = recalculated > maxPossibleDaily;

              return (
                <tr key={idx} className={`hover:bg-black/[0.01] ${isToday ? 'bg-emerald-50/50' : ''} ${isMaintenance ? 'bg-orange-50/40' : ''}`}>
                  <td className="px-4 py-2 text-sm font-mono sticky left-0 bg-white z-10 border-r border-black/5">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-bold">{format(day, 'dd')}</span>
                        {isMaintenance && <AlertCircle size={10} className="text-orange-500" />}
                      </div>
                      <span className="text-[10px] text-black/40 capitalize">{format(day, 'EEE', { locale: ptBR })}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm font-mono">
                    <div className="flex flex-col">
                      <span className="text-black/60">{(plannedMina + extraMina).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
                      {extraMina > 0 && <span className="text-[8px] text-blue-500 font-bold">+{extraMina.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm font-mono">
                    <div className="flex flex-col">
                      <span className="text-black/60">{(plannedPlanta + extraPlanta).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
                      {extraPlanta > 0 && <span className="text-[8px] text-blue-500 font-bold">+{extraPlanta.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>}
                    </div>
                  </td>
                  {premises.processType === 'umido' && (
                    <td className="px-4 py-2 text-sm font-mono">
                      <div className="flex flex-col">
                        <span className="text-black/60">{(plannedRejeito + extraRejeito).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>
                        {extraRejeito > 0 && <span className="text-[8px] text-blue-500 font-bold">+{extraRejeito.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</span>}
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-2 text-sm font-mono">
                    {actual > 0 ? (
                      <div className="flex flex-col">
                        <span className="font-bold text-emerald-600">{actual.toLocaleString('pt-BR')}</span>
                        <span className={`text-[10px] ${actual >= totalPlanned ? 'text-emerald-500' : 'text-red-500'}`}>
                          {((actual / totalPlanned) * 100).toFixed(1)}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-black/20">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-right">
                    {recalculated > 0 ? (
                      <div className="flex flex-col items-end">
                        <span className={`font-bold ${isOverLimit ? 'text-red-600' : recalculated > (plannedMina + extraMina) ? 'text-orange-500' : 'text-emerald-600'}`}>
                          {recalculated.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                        </span>
                        {isOverLimit && (
                          <span className="text-[8px] text-red-500 font-bold uppercase">Limite Planta</span>
                        )}
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
      const planned = results.totalDailyROM;
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
            <p className="text-sm text-black/40">Acompanhamento diário e replanejamento automático</p>
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

      <div className="grid grid-cols-1 gap-8">
        {renderCalendarTable("Planejamento vs Realizado", "bg-[#151619]")}
      </div>

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
                <span className="text-2xl font-mono font-bold">{premises.fleetCapacityMinaTPH} t/h</span>
                <span className="text-[10px] text-white/40">Disponível</span>
              </div>
            </div>
            <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-xs font-bold text-white/40 uppercase tracking-widest block mb-2">
                {premises.processType === 'umido' ? 'Frota Baia + Terminal' : 'Frota Terminal'}
              </span>
              <div className="flex justify-between items-end">
                <span className="text-2xl font-mono font-bold">
                  {(premises.processType === 'umido' ? premises.fleetCapacityBaiaTPH : 0) + premises.fleetCapacityTerminalTPH} t/h
                </span>
                <span className="text-[10px] text-white/40">Disponível</span>
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
