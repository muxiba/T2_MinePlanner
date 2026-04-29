import React, { useState } from "react";
import { Route, DailyLog, DetailedPremises } from "../types";
import { Save, AlertTriangle, CheckCircle2, Info, Trash2, Download, Calendar as CalendarIcon, Clock, Truck, Plus } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface ProductionLoggingProps {
  routes: Route[];
  logs: Record<string, DailyLog[]>;
  setLogs: React.Dispatch<React.SetStateAction<Record<string, DailyLog[]>>>;
  results: any;
  premises: DetailedPremises;
  onReset?: () => void;
}

const ProductionLogging: React.FC<ProductionLoggingProps> = ({ routes, logs, setLogs, results, premises, onReset }) => {
  const [tempActuals, setTempActuals] = useState<Record<string, { mina?: string; planta?: string; rejeito?: string }>>({});
  const [loggingMode, setLoggingMode] = useState<'manual' | 'accumulated'>('manual');
  const [accumulatedValue, setAccumulatedValue] = useState<string>("");
  const [accumulatedDate, setAccumulatedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [showReplanned, setShowReplanned] = useState(false);

  const handleSaveActual = (dateStr: string) => {
    const data = tempActuals[dateStr];
    if (!data) return;

    const mina = parseFloat(data.mina || "0");
    const planta = parseFloat(data.planta || "0");
    const rejeito = parseFloat(data.rejeito || "0");

    // Find the first active route to store this log
    const targetRoute = routes.find(r => r.active);
    if (!targetRoute) return;

    const date = new Date(dateStr + 'T12:00:00Z').toISOString();

    setLogs(prev => {
      const routeLogs = prev[targetRoute.id] || [];
      // Remove existing log for this date if any
      const filteredLogs = routeLogs.filter(l => l.date.split('T')[0] !== dateStr);
      
      const newLog: DailyLog = { 
        date, 
        actualProduction: mina,
        actualPlanta: planta,
        actualRejeito: rejeito
      };

      return {
        ...prev,
        [targetRoute.id]: [...filteredLogs, newLog].sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        ),
      };
    });

    // Clear temp input
    setTempActuals(prev => {
      const next = { ...prev };
      delete next[dateStr];
      return next;
    });
  };

  const handleClearLog = (dateStr: string) => {
    setLogs(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(routeId => {
        next[routeId] = next[routeId].filter(l => l.date.split('T')[0] !== dateStr);
      });
      return next;
    });
  };

  const handleProcessAccumulated = () => {
    const totalROM = parseFloat(accumulatedValue);
    if (isNaN(totalROM) || totalROM <= 0) return;

    const targetDate = new Date(accumulatedDate + 'T12:00:00Z');
    const startOfMonthDate = new Date(premises.year, premises.month, 1);
    
    // Find how many days from start of month to target date (inclusive)
    const daysCount = Math.floor((targetDate.getTime() - startOfMonthDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    if (daysCount <= 0) return;

    const avgROM = totalROM / daysCount;
    const avgPlanta = avgROM * (premises.rmGlobal / 100);
    const avgRejeito = avgROM * (premises.rejeitoTotal / 100);

    // Find target route
    const targetRoute = routes.find(r => r.active);
    if (!targetRoute) return;

    setLogs(prev => {
      const next = { ...prev };
      const routeLogs = next[targetRoute.id] || [];
      
      // Filter out logs for all dates up to targetDate
      const filteredLogs = routeLogs.filter(l => {
        const logDate = new Date(l.date);
        return logDate > targetDate;
      });

      // Create new logs for each day up to targetDate
      const newLogs: DailyLog[] = [];
      for (let i = 0; i < daysCount; i++) {
        const d = new Date(startOfMonthDate);
        d.setDate(d.getDate() + i);
        d.setHours(12, 0, 0, 0);
        
        newLogs.push({
          date: d.toISOString(),
          actualProduction: avgROM,
          actualPlanta: avgPlanta,
          actualRejeito: avgRejeito
        });
      }

      next[targetRoute.id] = [...newLogs, ...filteredLogs].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      return next;
    });

    setAccumulatedValue("");
  };

  const updateTemp = (dateStr: string, field: 'mina' | 'planta' | 'rejeito', value: string) => {
    setTempActuals(prev => ({
      ...prev,
      [dateStr]: {
        ...(prev[dateStr] || {}),
        [field]: value
      }
    }));
  };

  const handleResetSimulation = () => {
    if (onReset) {
      onReset();
    } else {
      setLogs({});
    }
    setTempActuals({});
    setAccumulatedValue("");
    setShowReplanned(false);
  };

  const exportToCSV = () => {
    const headers = [
      "Data", 
      "Dia da Semana", 
      "Meta Mina (t)", 
      "Realizado Mina (t)", 
      "Meta Planta (t)", 
      "Realizado Planta (t)",
      ...(premises.processType === 'umido' ? ["Meta Rejeito (t)", "Realizado Rejeito (t)"] : [])
    ];
    const rows = results.dailyBreakdown.map((day: any) => {
      const dateObj = new Date(day.date);
      const row = [
        format(dateObj, 'dd/MM/yyyy'),
        format(dateObj, 'EEEE', { locale: ptBR }),
        (showReplanned ? day.requiredMina : day.plannedMina).toFixed(2),
        (day.actualMina || 0).toFixed(2),
        (showReplanned ? day.requiredPlanta : day.plannedPlanta).toFixed(2),
        (day.actualPlanta || 0).toFixed(2)
      ];

      if (premises.processType === 'umido') {
        row.push(
          (showReplanned ? day.requiredRejeito : day.plannedRejeito).toFixed(2),
          (day.actualRejeito || 0).toFixed(2)
        );
      }

      return row;
    });

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map((r: any) => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `lancamento_producao_${format(new Date(), 'yyyyMMdd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-8 rounded-[32px] shadow-sm border border-black/5">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Lançamento de Produção Diária</h3>
            <p className="text-sm text-black/40 mt-1">Acompanhamento diário e replanejamento automático de metas.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest opacity-60">Meta ROM - Mina (t/mês)</span>
              <span className="text-4xl font-black font-mono text-emerald-600 tracking-tighter">
                {results.plannedMonthlyROM.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t
              </span>
            </div>
            <div className="flex flex-col items-end border-l border-black/5 pl-6">
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest opacity-60">Meta Planta - Produto (t/mês)</span>
              <span className="text-4xl font-black font-mono text-blue-600 tracking-tighter">
                {results.plannedMonthlyPlanta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t
              </span>
            </div>
            {premises.processType === 'umido' && (
              <div className="flex flex-col items-end border-l border-black/5 pl-6">
                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest opacity-60">Meta Rejeito (t/mês)</span>
                <span className="text-4xl font-black font-mono text-amber-600 tracking-tighter">
                  {results.plannedMonthlyRejeito.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t
                </span>
              </div>
            )}
            <div className="flex flex-col items-end border-l border-black/5 pl-6">
              <span className="text-[10px] font-bold text-[#1A1A1A] uppercase tracking-widest opacity-60">Movimentação Total (t/dia)</span>
              <span className="text-4xl font-black font-mono text-[#1A1A1A] tracking-tighter">
                {results.movimentacaoTotalDiaria.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t
              </span>
            </div>
            <div className="flex flex-col gap-2 ml-4">
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black/60 border border-black/5 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-black/[0.02] transition-all"
              >
                <Download size={14} />
                Exportar Excel
              </button>
              <button
                onClick={handleResetSimulation}
                className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-red-100 transition-all"
              >
                <Trash2 size={14} />
                Limpar Simulação
              </button>
            </div>
          </div>
        </div>

        {/* Mode Selector & Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2 bg-[#F8F9FA] p-1.5 rounded-2xl w-fit border border-black/5">
            <button
              onClick={() => setLoggingMode('manual')}
              className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                loggingMode === 'manual' 
                  ? "bg-white text-black shadow-sm" 
                  : "text-black/40 hover:text-black/60"
              }`}
            >
              Lançamento Manual
            </button>
            <button
              onClick={() => setLoggingMode('accumulated')}
              className={`px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${
                loggingMode === 'accumulated' 
                  ? "bg-white text-black shadow-sm" 
                  : "text-black/40 hover:text-black/60"
              }`}
            >
              Lançamento por Acumulado
            </button>
          </div>

          <button
            onClick={() => setShowReplanned(!showReplanned)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border ${
              showReplanned 
                ? "bg-blue-500 text-white border-blue-600 shadow-lg shadow-blue-500/20" 
                : "bg-white text-black/60 border-black/5 hover:bg-black/[0.02]"
            }`}
          >
            {showReplanned ? (
              <>
                <CheckCircle2 size={16} />
                Exibindo Meta Replanejada
              </>
            ) : (
              <>
                <Info size={16} />
                Exibir Meta Replanejada
              </>
            )}
          </button>
        </div>

        {loggingMode === 'accumulated' && (
          <div className="mb-10 p-6 bg-emerald-50/50 rounded-3xl border border-emerald-100/50 flex flex-wrap items-end gap-6">
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-emerald-800/60 uppercase tracking-widest">Produção Acumulada ROM (t)</label>
              <input 
                type="number"
                value={accumulatedValue}
                onChange={(e) => setAccumulatedValue(e.target.value)}
                placeholder="Ex: 21000"
                className="bg-white border border-emerald-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 w-48"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-bold text-emerald-800/60 uppercase tracking-widest">Data do Acúmulo</label>
              <input 
                type="date"
                value={accumulatedDate}
                onChange={(e) => setAccumulatedDate(e.target.value)}
                className="bg-white border border-emerald-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <button
              onClick={handleProcessAccumulated}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-2.5 rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
            >
              Processar e Atualizar Médias
            </button>
            <div className="flex-1 min-w-[300px]">
              <p className="text-[11px] text-emerald-800/60 italic leading-relaxed">
                * Ao processar o acumulado, o sistema calculará a média diária até a data informada e preencherá todos os dias anteriores automaticamente.
              </p>
            </div>
          </div>
        )}

        {results.isTargetUnreachable && (
          <div className="mb-8 bg-red-600 text-white p-8 rounded-[32px] shadow-xl shadow-red-600/20">
            <div className="flex items-start gap-6">
              <div className="p-4 bg-white/20 rounded-2xl shrink-0">
                <AlertTriangle size={32} />
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <h3 className="text-xl font-bold uppercase tracking-tight">Capacidade Crítica: Meta Inalcançável</h3>
                  <p className="text-sm text-white/80 mt-1">
                    A demanda necessária para os dias restantes ({results.requiredHourlyProduction.toFixed(2)} t/h) excede o limite físico da planta ({premises.plantFeedRateTPH} t/h).
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-white/10">
                  <div className="bg-white/10 p-4 rounded-2xl">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Meta Original (ROM)</p>
                    <p className="text-xl font-mono font-bold">{results.plannedMonthlyROM.toLocaleString('pt-BR')} t</p>
                  </div>
                  <div className="bg-white/10 p-4 rounded-2xl">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Máximo Possível (ROM)</p>
                    <p className="text-2xl font-mono font-bold">{(results.plannedMonthlyROM - results.productionLoss).toLocaleString('pt-BR')} t</p>
                  </div>
                  <div className="bg-white/10 p-4 rounded-2xl">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Máximo Possível (Planta)</p>
                    <p className="text-2xl font-mono font-bold">{(results.plannedMonthlyPlanta - results.productionLossPlanta).toLocaleString('pt-BR')} t</p>
                  </div>
                  {premises.processType === 'umido' && (
                    <div className="bg-white/10 p-4 rounded-2xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Máximo Possível (Rejeito)</p>
                      <p className="text-2xl font-mono font-bold">{(results.plannedMonthlyRejeito - results.productionLossRejeito).toLocaleString('pt-BR')} t</p>
                    </div>
                  )}
                  <div className="bg-red-500 p-4 rounded-2xl border border-white/20">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Perda ROM</p>
                    <p className="text-2xl font-mono font-bold">{results.productionLoss.toLocaleString('pt-BR')} t</p>
                  </div>
                  <div className="bg-red-500 p-4 rounded-2xl border border-white/20">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Perda Planta</p>
                    <p className="text-2xl font-mono font-bold">{results.productionLossPlanta.toLocaleString('pt-BR')} t</p>
                  </div>
                  {premises.processType === 'umido' && (
                    <div className="bg-red-500 p-4 rounded-2xl border border-white/20">
                      <p className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Perda Rejeito</p>
                      <p className="text-2xl font-mono font-bold">{results.productionLossRejeito.toLocaleString('pt-BR')} t</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 text-[10px] font-bold uppercase tracking-widest opacity-60">
                  <span>Taxa Máxima Planta: {premises.plantFeedRateTPH} t/h</span>
                  <span>•</span>
                  <span>Jornada Efetiva: {results.effectiveHoursPerDayPlanta.toFixed(2)} h/dia</span>
                  <span>•</span>
                  <span>Dias Restantes: {results.remainingDays} dias</span>
                  {results.hourlyStockpile > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-amber-300">Potencial Pilha Pulmão: {results.hourlyStockpile.toFixed(1)} t/h</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto -mx-8 px-8">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F8F9FA] border-y border-black/5">
                <th className="px-4 py-4 text-[10px] font-bold text-black/40 uppercase tracking-widest">Dia</th>
                <th className="px-4 py-4 text-[10px] font-bold text-black/40 uppercase tracking-widest">Semana</th>
                
                <th className="px-4 py-4 text-[10px] font-bold text-black/40 uppercase tracking-widest text-right">
                  {showReplanned ? 'Meta Replanejada Mina (t)' : 'Planejado Mina (t)'}
                </th>
                <th className="px-4 py-4 text-[10px] font-bold text-emerald-600 uppercase tracking-widest text-right">Realizado Mina (t)</th>
                
                <th className="px-4 py-4 text-[10px] font-bold text-black/40 uppercase tracking-widest text-right">
                  {showReplanned ? 'Meta Replanejada Planta (t)' : 'Planejado Planta (t)'}
                </th>
                <th className="px-4 py-4 text-[10px] font-bold text-emerald-600 uppercase tracking-widest text-right">Realizado Planta (t)</th>
                
                {premises.processType === 'umido' && (
                  <>
                    <th className="px-4 py-4 text-[10px] font-bold text-black/40 uppercase tracking-widest text-right">
                      {showReplanned ? 'Meta Replanejada Rejeito (t)' : 'Planejado Rejeito (t)'}
                    </th>
                    <th className="px-4 py-4 text-[10px] font-bold text-emerald-600 uppercase tracking-widest text-right">Realizado Rejeito (t)</th>
                  </>
                )}
                
                <th className="px-4 py-4 text-[10px] font-bold text-black/40 uppercase tracking-widest text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {results.dailyBreakdown.map((day: any, idx: number) => {
                const dateObj = new Date(day.date);
                const dateStr = day.date.split('T')[0];
                const isToday = dateStr === new Date().toISOString().split('T')[0];
                const hasActual = day.actualMina !== null;

                return (
                  <tr key={idx} className={`hover:bg-black/[0.01] transition-all ${isToday ? 'bg-blue-50/30' : ''}`}>
                    <td className="px-4 py-4 text-sm font-mono font-bold text-black/80">
                      {format(dateObj, 'dd-MMM', { locale: ptBR })}
                    </td>
                    <td className="px-4 py-4 text-xs text-black/60 capitalize">
                      {format(dateObj, 'EEEE', { locale: ptBR })}
                    </td>
                    
                    {/* MINA */}
                    <td className={`px-4 py-4 text-sm font-mono text-right transition-all ${showReplanned ? 'text-blue-600 font-bold' : 'text-black/40'}`}>
                      {(showReplanned ? day.requiredMina : day.plannedMina).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {day.isPlantLimited && (
                          <AlertTriangle size={14} className="text-amber-500" title="Limite da Planta Atingido" />
                        )}
                        <input
                          type="number"
                          value={tempActuals[dateStr]?.mina ?? (hasActual ? day.actualMina : '')}
                          onChange={(e) => updateTemp(dateStr, 'mina', e.target.value)}
                          placeholder="0.00"
                          className={`w-24 bg-[#F8F9FA] border rounded-xl px-2 py-1.5 text-xs font-mono text-right focus:outline-none focus:ring-2 transition-all ${
                            hasActual ? 'border-emerald-200 text-emerald-700 font-bold bg-emerald-50/30' : 'border-black/5 focus:ring-emerald-500/20'
                          }`}
                        />
                      </div>
                    </td>

                    {/* PLANTA */}
                    <td className={`px-4 py-4 text-sm font-mono text-right transition-all ${showReplanned ? 'text-blue-600 font-bold' : 'text-black/40'}`}>
                      {(showReplanned ? day.requiredPlanta : day.plannedPlanta).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <input
                        type="number"
                        value={tempActuals[dateStr]?.planta ?? (hasActual ? day.actualPlanta : '')}
                        onChange={(e) => updateTemp(dateStr, 'planta', e.target.value)}
                        placeholder="0.00"
                        className={`w-24 bg-[#F8F9FA] border rounded-xl px-2 py-1.5 text-xs font-mono text-right focus:outline-none focus:ring-2 transition-all ${
                          hasActual ? 'border-emerald-200 text-emerald-700 font-bold bg-emerald-50/30' : 'border-black/5 focus:ring-emerald-500/20'
                        }`}
                      />
                    </td>

                    {/* REJEITO */}
                    {premises.processType === 'umido' && (
                      <>
                        <td className={`px-4 py-4 text-sm font-mono text-right transition-all ${showReplanned ? 'text-blue-600 font-bold' : 'text-black/40'}`}>
                          {(showReplanned ? day.requiredRejeito : day.plannedRejeito).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-4 text-right">
                          <input
                            type="number"
                            value={tempActuals[dateStr]?.rejeito ?? (hasActual ? day.actualRejeito : '')}
                            onChange={(e) => updateTemp(dateStr, 'rejeito', e.target.value)}
                            placeholder="0.00"
                            className={`w-24 bg-[#F8F9FA] border rounded-xl px-2 py-1.5 text-xs font-mono text-right focus:outline-none focus:ring-2 transition-all ${
                              hasActual ? 'border-emerald-200 text-emerald-700 font-bold bg-emerald-50/30' : 'border-black/5 focus:ring-emerald-500/20'
                            }`}
                          />
                        </td>
                      </>
                    )}

                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {(tempActuals[dateStr] !== undefined) ? (
                          <button
                            onClick={() => handleSaveActual(dateStr)}
                            className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all shadow-sm"
                            title="Salvar"
                          >
                            <Save size={14} />
                          </button>
                        ) : hasActual ? (
                          <button
                            onClick={() => handleClearLog(dateStr)}
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Remover"
                          >
                            <Trash2 size={14} className="opacity-50 hover:opacity-100" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-[#F8F9FA] font-bold border-t border-black/10 text-[11px]">
              <tr>
                <td colSpan={2} className="px-4 py-4 text-xs uppercase tracking-widest text-black/40">Totais</td>
                
                {/* MINA TOTALS */}
                <td className={`px-4 py-4 text-sm font-mono text-right transition-all ${showReplanned ? 'text-blue-600 font-bold' : 'text-black/80'}`}>
                  {results.dailyBreakdown.reduce((acc: number, d: any) => acc + (showReplanned ? d.requiredMina : d.plannedMina), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-4 text-sm font-mono text-right text-emerald-700">
                  {results.totalActualProduction.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>

                {/* PLANTA TOTALS */}
                <td className={`px-4 py-4 text-sm font-mono text-right transition-all ${showReplanned ? 'text-blue-600 font-bold' : 'text-black/80'}`}>
                  {results.dailyBreakdown.reduce((acc: number, d: any) => acc + (showReplanned ? d.requiredPlanta : d.plannedPlanta), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-4 py-4 text-sm font-mono text-right text-emerald-700">
                  {results.dailyBreakdown.reduce((acc: number, d: any) => acc + (d.actualPlanta || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>

                {/* REJEITO TOTALS */}
                {premises.processType === 'umido' && (
                  <>
                    <td className={`px-4 py-4 text-sm font-mono text-right transition-all ${showReplanned ? 'text-blue-600 font-bold' : 'text-black/80'}`}>
                      {results.dailyBreakdown.reduce((acc: number, d: any) => acc + (showReplanned ? d.requiredRejeito : d.plannedRejeito), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-4 text-sm font-mono text-right text-emerald-700">
                      {results.dailyBreakdown.reduce((acc: number, d: any) => acc + (d.actualRejeito || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </td>
                  </>
                )}

                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-100 p-6 rounded-3xl flex items-start gap-4">
        <div className="p-2 bg-blue-500 text-white rounded-xl">
          <Info size={20} />
        </div>
        <div>
          <h4 className="font-bold text-blue-900">Como funciona o Replanejamento?</h4>
          <p className="text-sm text-blue-800/70 mt-1 leading-relaxed">
            Ao lançar a produção real de um dia, o sistema calcula automaticamente a diferença em relação à meta mensal. 
            O saldo remanescente é redistribuído equitativamente entre os dias restantes do mês, respeitando sempre o 
            <strong> limite de alimentação da planta ({premises.plantFeedRateTPH} t/h)</strong>. Se a meta se tornar inalcançável, 
            um alerta será exibido na coluna de realizado.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ProductionLogging;
