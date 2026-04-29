import React from "react";
import { DetailedPremises } from "../types";
import { TrendingUp, AlertTriangle, CheckCircle2, ArrowRight, Download } from "lucide-react";

interface ReplanningViewProps {
  results: any;
  premises: DetailedPremises;
}

const ReplanningView: React.FC<ReplanningViewProps> = ({ results, premises }) => {
  const { 
    totalActualProduction, 
    remainingTarget, 
    requiredDailyProduction, 
    totalDailyROM,
    isTargetAtRisk,
    suggestions,
    remainingDays,
    daysPassed
  } = results;

  const progressPercent = (totalActualProduction / premises.targetMonthlyROM) * 100;

  const exportToCSV = () => {
    const headers = ["Indicador", "Valor"];
    const rows = [
      ["Produção Acumulada (t)", totalActualProduction.toFixed(2)],
      ["Meta Mensal (t)", premises.targetMonthlyROM.toFixed(2)],
      ["Progresso (%)", progressPercent.toFixed(2)],
      ["Saldo Restante (t)", remainingTarget.toFixed(2)],
      ["Nova Meta Diária (t/dia)", requiredDailyProduction.toFixed(2)],
      ["Dias Restantes", remainingDays],
      ["Dias Decorridos", daysPassed],
      ["Status", results.isTargetUnreachable ? "Inalcançável" : results.isTargetAtRisk ? "Risco" : "OK"]
    ];

    const csvContent = "\uFEFF" + rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `replanejamento_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-black/80">Replanejamento de Produção</h2>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-2 bg-white text-black/60 border border-black/5 px-6 py-2.5 rounded-xl font-bold transition-all hover:bg-black/[0.02]"
        >
          <Download size={18} />
          Exportar Excel
        </button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Progress Card */}
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-black/5 relative overflow-hidden">
          <div className="relative z-10">
            <h3 className="text-xl font-bold mb-8 flex items-center gap-2">
              <TrendingUp size={24} className="text-emerald-500" />
              Progresso da Meta Mensal
            </h3>
            
            <div className="flex items-end justify-between mb-4">
              <div className="space-y-1">
                <span className="text-xs font-bold text-black/40 uppercase tracking-widest">Produção Acumulada</span>
                <div className="text-4xl font-mono font-bold text-emerald-600">
                  {totalActualProduction.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t
                </div>
              </div>
              <div className="text-right space-y-1">
                <span className="text-xs font-bold text-black/40 uppercase tracking-widest">Meta Mensal</span>
                <div className="text-2xl font-mono font-bold text-black/80">
                  {premises.targetMonthlyROM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t
                </div>
              </div>
            </div>
            
            <div className="w-full bg-[#F8F9FA] h-6 rounded-full overflow-hidden border border-black/5 p-1">
              <div 
                className="h-full bg-emerald-500 rounded-full transition-all duration-1000 relative"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 to-white/20 animate-pulse" />
              </div>
            </div>
            
            <div className="mt-4 flex justify-between text-xs font-bold text-black/40 uppercase tracking-widest">
              <span>{(progressPercent || 0).toFixed(1)}% Concluído</span>
              <span>Faltam {remainingTarget.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t</span>
            </div>
          </div>
          
          {/* Decorative background element */}
          <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-emerald-50 rounded-full blur-3xl opacity-50" />
        </div>

        {/* Daily Target Card */}
        <div className={`p-8 rounded-3xl shadow-sm border flex flex-col justify-between ${results.isTargetUnreachable ? 'bg-red-600 text-white border-red-700' : results.isTargetAtRisk ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div>
            <div className="flex items-center justify-between mb-6">
              <h3 className={`text-sm font-bold uppercase tracking-widest ${results.isTargetUnreachable ? 'text-white' : results.isTargetAtRisk ? 'text-red-600' : 'text-emerald-600'}`}>
                {results.isTargetUnreachable ? 'Meta Inalcançável' : 'Nova Meta Diária'}
              </h3>
              {results.isTargetUnreachable ? <AlertTriangle size={20} className="text-white" /> : results.isTargetAtRisk ? <AlertTriangle size={20} className="text-red-500" /> : <CheckCircle2 size={20} className="text-emerald-500" />}
            </div>
            
            <div className="space-y-1">
              <div className={`text-4xl font-mono font-bold ${results.isTargetUnreachable ? 'text-white' : results.isTargetAtRisk ? 'text-red-700' : 'text-emerald-700'}`}>
                {results.isTargetUnreachable ? (results.plantCapacityTPH * results.effectiveHoursPerDayPlanta).toLocaleString('pt-BR', { minimumFractionDigits: 0 }) : requiredDailyProduction.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t
              </div>
              <p className={`text-xs font-medium ${results.isTargetUnreachable ? 'text-white/60' : results.isTargetAtRisk ? 'text-red-600/60' : 'text-emerald-600/60'}`}>
                {results.isTargetUnreachable ? `Capacidade Máxima da Planta (${results.plantCapacityTPH} t/h)` : 'Produção necessária por dia restante'}
              </p>
            </div>
          </div>
          
          <div className="mt-8 pt-6 border-t border-black/5 space-y-3">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest opacity-60">
              <span>{results.isTargetUnreachable ? 'Perda ROM' : 'Capacidade Atual'}</span>
              <span>{results.isTargetUnreachable ? `${results.productionLoss.toLocaleString('pt-BR')} t` : `${totalDailyROM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t/dia`}</span>
            </div>
            {results.isTargetUnreachable && (
              <>
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest opacity-60">
                  <span>Perda Planta</span>
                  <span>{results.productionLossPlanta.toLocaleString('pt-BR')} t</span>
                </div>
                {premises.processType === 'umido' && (
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest opacity-60">
                    <span>Perda Rejeito</span>
                    <span>{results.productionLossRejeito.toLocaleString('pt-BR')} t</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Suggestions and Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
          <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
            <ArrowRight size={20} className="text-emerald-500" />
            Análise de Ajustes Necessários
          </h3>
          
          {suggestions.length > 0 ? (
            <div className="space-y-4">
              {suggestions.map((suggestion: string, idx: number) => (
                <div key={idx} className="flex items-start gap-4 p-4 bg-orange-50 rounded-2xl border border-orange-100">
                  <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
                    <AlertTriangle size={16} className="text-white" />
                  </div>
                  <p className="text-sm font-medium text-orange-800 leading-relaxed">
                    {suggestion}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center">
                <CheckCircle2 size={32} className="text-emerald-500" />
              </div>
              <div className="space-y-1">
                <p className="font-bold text-black/80">Meta Sob Controle</p>
                <p className="text-sm text-black/40">A capacidade atual é suficiente para atingir a meta mensal.</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-[#151619] p-8 rounded-3xl shadow-xl text-white">
          <h3 className="text-lg font-bold mb-6 text-emerald-400">Resumo de Replanejamento</h3>
          <div className="space-y-6">
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-white/60">Dias Restantes</span>
              <span className="font-mono font-bold text-lg">
                {results.remainingDays} dias
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-white/60">Dias Decorridos</span>
              <span className="font-mono font-bold text-lg text-emerald-400">
                {results.daysPassed} dias
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-white/60">Déficit de Produção</span>
              <span className="font-mono font-bold text-lg text-red-400">
                {Math.max(0, requiredDailyProduction - totalDailyROM).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t/dia
              </span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-white/10">
              <span className="text-sm text-white/60">Eficiência Necessária</span>
              <span className="font-mono font-bold text-lg">
                {(Math.min(100, (requiredDailyProduction / (totalDailyROM / (premises.eoMina / 100))) * 100) || 0).toFixed(1)}%
              </span>
            </div>
          </div>
          
          <div className="mt-8 p-4 bg-white/5 rounded-2xl border border-white/10">
            <p className="text-xs text-white/40 leading-relaxed">
              * O cálculo de replanejamento considera a produção acumulada lançada no módulo de "Lançamento de Produção" e distribui o saldo restante pelos dias operacionais que ainda não possuem lançamentos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReplanningView;
