import React, { useState } from 'react';
import { Plus, Trash2, Truck, Clock, Info, TrendingUp } from 'lucide-react';
import { Route, DetailedPremises, ExtraFleetAllocation } from '../types';

interface ExtraFleetManagerProps {
  routes: Route[];
  premises: DetailedPremises;
  setPremises: React.Dispatch<React.SetStateAction<DetailedPremises>>;
  results: any;
}

const ExtraFleetManager: React.FC<ExtraFleetManagerProps> = ({ routes, premises, setPremises, results }) => {
  const [newAllocation, setNewAllocation] = useState<Partial<ExtraFleetAllocation>>({
    routeId: routes[0]?.id || '',
    truckCount: 1,
    durationHours: 24,
    description: ''
  });

  const isRejeitoRoute = (name: string) => {
    const n = name.toLowerCase();
    return n.includes('baia') || n.includes('rejeito');
  };

  const visibleActiveRoutes = routes.filter(r => {
    if (!r.active) return false;
    if (premises.processType === 'seco' && isRejeitoRoute(r.name)) return false;
    return true;
  });

  const totalTrucksUsed = routes.reduce((acc, curr) => acc + curr.truckCount, 0);
  const extraTrucksAvailable = Math.max(0, premises.truckCount - totalTrucksUsed);
  const maxMonthlyHours = results.effectiveHoursPerMonthMina || (premises.calendarDays * 24);
  
  // Total capacity pool in truck-hours
  const totalCapacityPool = extraTrucksAvailable * maxMonthlyHours;
  
  // Calculate used capacity from existing allocations
  const usedCapacity = (premises.extraAllocations || []).reduce((acc, curr) => acc + (curr.truckCount * curr.durationHours), 0);
  const remainingCapacity = Math.max(0, totalCapacityPool - usedCapacity);

  const handleAddAllocation = () => {
    if (!newAllocation.routeId || !newAllocation.truckCount || !newAllocation.durationHours) return;
    
    const requestedCapacity = newAllocation.truckCount * newAllocation.durationHours;
    if (requestedCapacity > remainingCapacity + 0.01) { // Small epsilon for float precision
      alert(`Capacidade insuficiente! Você tem apenas ${remainingCapacity.toFixed(1)} h-caminhão disponíveis.`);
      return;
    }

    const allocation: ExtraFleetAllocation = {
      id: Math.random().toString(36).substr(2, 9),
      routeId: newAllocation.routeId,
      truckCount: newAllocation.truckCount,
      durationHours: newAllocation.durationHours,
      description: newAllocation.description
    };

    setPremises(prev => ({
      ...prev,
      extraAllocations: [...(prev.extraAllocations || []), allocation]
    }));

    setNewAllocation({
      routeId: routes[0]?.id || '',
      truckCount: Math.min(1, extraTrucksAvailable),
      durationHours: 24,
      description: ''
    });
  };

  const handleRemoveAllocation = (id: string) => {
    setPremises(prev => ({
      ...prev,
      extraAllocations: (prev.extraAllocations || []).filter(a => a.id !== id)
    }));
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-black/5 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl">
            <Truck size={24} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-black/80">Alocação de Frota Extra (Folga Teórica)</h4>
            <p className="text-xs text-black/40">Distribua a capacidade excedente de {extraTrucksAvailable.toFixed(2)} caminhões.</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Capacidade Disponível</p>
          <p className="text-sm font-mono font-bold text-blue-600">{remainingCapacity.toFixed(1)} h-caminhão</p>
          <p className="text-[8px] text-black/30 uppercase font-bold">Total: {totalCapacityPool.toFixed(1)} h-c</p>
        </div>
      </div>

      {/* Add Allocation Form */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-[#F8F9FA] rounded-2xl border border-black/5">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Fluxo / Rota</label>
          <select
            value={newAllocation.routeId}
            onChange={(e) => setNewAllocation({ ...newAllocation, routeId: e.target.value })}
            className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          >
            {visibleActiveRoutes.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Caminhões</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={premises.truckCount}
            value={newAllocation.truckCount}
            onChange={(e) => setNewAllocation({ ...newAllocation, truckCount: parseFloat(e.target.value) || 0 })}
            className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Duração (Horas)</label>
          <input
            type="number"
            min="1"
            max={maxMonthlyHours}
            value={newAllocation.durationHours}
            onChange={(e) => setNewAllocation({ ...newAllocation, durationHours: parseInt(e.target.value) || 0 })}
            className="w-full bg-white border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={handleAddAllocation}
            disabled={
              !newAllocation.routeId || 
              (newAllocation.truckCount || 0) <= 0 || 
              (newAllocation.truckCount || 0) > extraTrucksAvailable + 0.01 || 
              (newAllocation.durationHours || 0) <= 0 ||
              ((newAllocation.truckCount || 0) * (newAllocation.durationHours || 0)) > remainingCapacity + 0.01
            }
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-black/10 disabled:text-black/20 text-white px-4 py-2 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20"
          >
            <Plus size={18} />
            Alocar
          </button>
        </div>
      </div>

      {extraTrucksAvailable <= 0 && (
        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100">
          <Info size={14} />
          <p className="text-[10px] font-bold uppercase tracking-wider">Toda a frota física já está alocada nos fluxos principais.</p>
        </div>
      )}

      {/* List of Allocations */}
      <div className="space-y-3">
        <h5 className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Alocações Ativas</h5>
        {premises.extraAllocations && premises.extraAllocations.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {premises.extraAllocations.map(allocation => {
              const route = routes.find(r => r.id === allocation.routeId);
              const routeResult = results.routeResults?.find((r: any) => r.id === allocation.routeId);
              
              // Calculate individual production for this allocation
              const hourlyProd = routeResult ? (allocation.truckCount * routeResult.unitaryProductivity * (route?.mechanicalAvailability || 85) / 100 * (route?.operationalEfficiency || 72) / 100) : 0;
              const totalProd = hourlyProd * allocation.durationHours;
              
              return (
                <div key={allocation.id} className="flex flex-col p-4 bg-white border border-black/5 rounded-2xl hover:border-blue-200 transition-all group">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-blue-50 text-blue-500 rounded-xl">
                        <Clock size={16} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-black/80">{route?.name || 'Rota Desconhecida'}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1">
                            <Truck size={10} /> {allocation.truckCount} Caminhões
                          </span>
                          <div className="w-1 h-1 rounded-full bg-black/10" />
                          <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1">
                            <Clock size={10} /> {allocation.durationHours} Horas
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveAllocation(allocation.id)}
                      className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 pt-3 border-t border-black/5">
                    <div>
                      <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">Taxa Horária</p>
                      <p className="text-xs font-mono font-bold text-blue-600">{hourlyProd.toFixed(2)} t/h</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">Produção p/ Período</p>
                      <p className="text-xs font-mono font-bold text-emerald-600">{totalProd.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t</p>
                    </div>
                    <div>
                      <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">Prod. Unitária</p>
                      <p className="text-xs font-mono font-bold text-black/60">{routeResult?.unitaryProductivity?.toFixed(2)} t/h/c</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 bg-black/[0.01] rounded-2xl border border-dashed border-black/10">
            <Info size={24} className="text-black/10 mb-2" />
            <p className="text-xs text-black/30 font-medium">Nenhuma alocação extra definida.</p>
          </div>
        )}
      </div>

      {results.allocatedExtraMonthlyProduction > 0 && (
        <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Impacto na Produção Mensal</span>
            </div>
            <span className="text-lg font-mono font-bold text-emerald-600">
              + {results.allocatedExtraMonthlyProduction.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExtraFleetManager;
