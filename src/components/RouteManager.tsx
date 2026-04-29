import React from 'react';
import { Plus, PlusCircle, Trash2, Edit2, Check, Truck, MapPin, Clock, Activity, AlertTriangle, RefreshCw, Download } from 'lucide-react';
import { Route, DetailedPremises } from '../types';
import ExtraFleetManager from './ExtraFleetManager';

interface RouteManagerProps {
  routes: Route[];
  setRoutes: React.Dispatch<React.SetStateAction<Route[]>>;
  results: any;
  premises: DetailedPremises;
  setPremises: React.Dispatch<React.SetStateAction<DetailedPremises>>;
}

const RouteManager: React.FC<RouteManagerProps> = ({ routes, setRoutes, results, premises, setPremises }) => {
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const categorizeRoute = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('baia') || n.includes('rejeito')) return 'rejeito';
    if (n.includes('terminal') || n.includes('produto')) return 'produto';
    if (n.includes('estéril') || n.includes('esteril')) return 'esteril';
    return 'rom';
  };

  const calculateCycle = (distance: number) => {
    const speedLoadedMmin = (premises.velocidadeCheio * 1000) / 60;
    const speedEmptyMmin = (premises.velocidadeVazio * 1000) / 60;
    const tLoaded = distance / speedLoadedMmin;
    const tEmpty = distance / speedEmptyMmin;
    const total = premises.loadingTime + tLoaded + premises.weighingTimeLoaded + premises.dumpingTime + tEmpty + premises.weighingTimeEmpty;
    return total || 0;
  };

  const getDerivedMass = (route: Route) => {
    const routeResult = results.routeResults?.find((r: any) => r.id === route.id);
    return routeResult?.targetMass || 0;
  };

  const handleSyncAll = () => {
    const updatedRoutes = routes.map(route => {
      const routeResult = results.routeResults.find((r: any) => r.id === route.id);
      if (routeResult && routeResult.suggestedTrucks > 0) {
        // Sync with rounded up value and clear manual override
        return { ...route, truckCount: Math.ceil(routeResult.suggestedTrucks), isManualOverride: false };
      }
      return route;
    });
    setRoutes(updatedRoutes);
  };

  const exportToCSV = () => {
    const headers = [
      "Nome", 
      "Ativa", 
      "Caminhões", 
      "Capacidade (t)", 
      "DMT (m)", 
      "Ciclo (min)", 
      "DF (%)", 
      "EO (%)", 
      "Prod. Unitária (t/h)", 
      "Caminhões Sugeridos",
      "Frota (Viagem / Hora)",
      "Prod. Horária (t/h)",
      "Massa - Base Úmida (t)",
      "Horas Nec. (h)",
      "Dias Nec. (dias)",
      "Prod. Unitária (t/h/caminhão)",
      "Nec. Total (Horas/1 Caminhão)",
      "Demanda Horária (t/h)"
    ];
    const rows = routes.map(route => {
      const routeResult = results.routeResults?.find((r: any) => r.id === route.id);
      return [
        route.name,
        route.active ? "Sim" : "Não",
        route.truckCount,
        route.truckCapacity,
        route.distance,
        route.cycleTime,
        route.mechanicalAvailability,
        route.operationalEfficiency,
        routeResult?.unitaryProductivity?.toFixed(2) || "0.00",
        routeResult?.suggestedTrucks?.toFixed(2) || "0.00",
        routeResult?.fullFleetTripsPerHour?.toFixed(2) || "0.00",
        routeResult?.fullFleetHourlyProduction?.toFixed(2) || "0.00",
        routeResult?.wetMass?.toFixed(2) || "0.00",
        routeResult?.fullFleetHoursNeeded?.toFixed(2) || "0.00",
        routeResult?.fullFleetDaysNeeded?.toFixed(2) || "0.00",
        routeResult?.unitaryProductivity?.toFixed(2) || "0.00",
        routeResult?.totalHoursOneTruck?.toFixed(2) || "0.00",
        routeResult?.requiredHourlyDemand?.toFixed(2) || "0.00"
      ];
    });

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `gestao_rotas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddRoute = () => {
    const name = prompt("Nome da Nova Frente/Rota:", `Frente ${routes.length + 1}`);
    if (name === null) return; // Cancelled

    const category = categorizeRoute(name || "");
    let initialMass = 0;
    
    if (category === 'rom') {
      const currentRomSum = routes.filter(r => r.active && categorizeRoute(r.name) === 'rom').reduce((acc, r) => acc + (r.targetMass || 0), 0);
      initialMass = Math.max(0, premises.targetMonthlyROM - currentRomSum);
    } else if (category === 'esteril') {
      const currentWasteSum = routes.filter(r => r.active && categorizeRoute(r.name) === 'esteril').reduce((acc, r) => acc + (r.targetMass || 0), 0);
      initialMass = Math.max(0, premises.targetMonthlyWasteRock - currentWasteSum);
    }

    const newRoute: Route = {
      id: Math.random().toString(36).substr(2, 9),
      name: name || `Nova Rota ${routes.length + 1}`,
      active: true,
      truckCount: 1,
      truckCapacity: premises.truckCapacity,
      distance: 1000,
      cycleTime: 20,
      mechanicalAvailability: 85,
      operationalEfficiency: 72,
      processType: premises.processType,
      targetMass: initialMass > 0 ? initialMass : undefined,
    };
    setRoutes([newRoute, ...routes]);
    setEditingId(newRoute.id);
  };

  const handleMassChange = (routeId: string, name: string, value: number) => {
    const category = categorizeRoute(name);
    let validatedValue = value;

    if (category === 'rom') {
      const otherRomMass = routes
        .filter(r => r.id !== routeId && r.active && categorizeRoute(r.name) === 'rom')
        .reduce((acc, r) => acc + (r.targetMass || 0), 0);
      
      const limit = premises.targetMonthlyROM;
      if (otherRomMass + value > limit) {
        validatedValue = Math.max(0, limit - otherRomMass);
        alert(`Atenção: A soma das frentes de ROM não pode ultrapassar o limite de ${limit.toLocaleString()} t.\n\nValor ajustado para o saldo restante: ${validatedValue.toLocaleString()} t.`);
      }
    } else if (category === 'esteril') {
      const otherWasteMass = routes
        .filter(r => r.id !== routeId && r.active && categorizeRoute(r.name) === 'esteril')
        .reduce((acc, r) => acc + (r.targetMass || 0), 0);
      
      const limit = premises.targetMonthlyWasteRock;
      if (otherWasteMass + value > limit) {
        validatedValue = Math.max(0, limit - otherWasteMass);
        alert(`Atenção: A soma das frentes de Estéril não pode ultrapassar o limite de ${limit.toLocaleString()} t.\n\nValor ajustado para o saldo restante: ${validatedValue.toLocaleString()} t.`);
      }
    }

    handleUpdateRoute(routeId, { targetMass: validatedValue });
  };

  const handleUpdateRoute = (id: string, updates: Partial<Route>) => {
    setRoutes(routes.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const handleDeleteRoute = (id: string) => {
    setRoutes(routes.filter(r => r.id !== id));
  };

  const totalTrucksUsed = routes.reduce((acc, curr) => acc + curr.truckCount, 0);
  const extraTrucks = Math.max(0, premises.truckCount - totalTrucksUsed);

  const romRoutes = routes.filter(r => r.active && categorizeRoute(r.name) === 'rom');
  const wasteRoutes = routes.filter(r => r.active && categorizeRoute(r.name) === 'esteril');

  const romMassSum = romRoutes.reduce((acc, r) => acc + (r.targetMass || 0), 0);
  const wasteMassSum = wasteRoutes.reduce((acc, r) => acc + (r.targetMass || 0), 0);

  const romOverload = romMassSum > premises.targetMonthlyROM;
  const wasteOverload = premises.hasWasteRock && wasteMassSum > premises.targetMonthlyWasteRock;

  const visibleRoutes = routes.filter(r => {
    if (premises.processType === 'seco' && categorizeRoute(r.name) === 'rejeito') return false;
    if (!premises.hasWasteRock && categorizeRoute(r.name) === 'esteril') return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-black/80">Gestão de Rotas de Transporte</h3>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-black/40">Frota Total: {premises.truckCount}</span>
            <div className="w-1 h-1 rounded-full bg-black/10" />
            <span className={`text-[10px] font-bold uppercase tracking-widest ${totalTrucksUsed > premises.truckCount ? 'text-red-500' : 'text-emerald-500'}`}>Usados: {totalTrucksUsed}</span>
            <div className="w-1 h-1 rounded-full bg-black/10" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Extra: {extraTrucks}</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {results.isPlantOverloaded && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl border border-red-100 animate-pulse">
              <AlertTriangle size={18} />
              <span className="text-xs font-bold uppercase tracking-wider">Limite da Planta Excedido</span>
            </div>
          )}
          <button
            onClick={exportToCSV}
            className="flex items-center gap-2 bg-white text-black/60 border border-black/5 px-6 py-2.5 rounded-xl font-bold transition-all hover:bg-black/[0.02]"
          >
            <Download size={18} />
            Exportar Excel
          </button>
          <button
            onClick={handleSyncAll}
            className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-blue-500/20"
            title="Sincronizar todas as rotas com os caminhões sugeridos"
          >
            <RefreshCw size={18} />
            Sincronizar Sugestão
          </button>
          <button
            onClick={handleAddRoute}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
          >
            <Plus size={18} />
            Adicionar Frente/Rota
          </button>
        </div>
      </div>

      {(romOverload || wasteOverload || totalTrucksUsed > premises.truckCount) && (
        <div className="bg-red-50 border-2 border-red-200 rounded-[32px] p-6 flex items-start gap-4 animate-pulse">
          <div className="p-3 bg-red-100 text-red-600 rounded-2xl">
            <AlertTriangle size={24} />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-black text-red-900 uppercase tracking-widest">Inconsistência no Cenário</h4>
            <div className="text-xs font-medium text-red-700/80 leading-relaxed">
              {romOverload && <p>• A soma das massas de ROM ({romMassSum.toLocaleString()} t) excede o Consumo da Planta ({premises.targetMonthlyROM.toLocaleString()} t).</p>}
              {wasteOverload && <p>• A soma das massas de Estéril ({wasteMassSum.toLocaleString()} t) excede a Meta de Estéril ({premises.targetMonthlyWasteRock.toLocaleString()} t).</p>}
              {totalTrucksUsed > premises.truckCount && (
                <p>• FROTA EXCEDIDA: Você está usando {totalTrucksUsed} caminhões, mas possui apenas {premises.truckCount} disponíveis.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <ExtraFleetManager 
          routes={routes} 
          premises={premises} 
          setPremises={setPremises} 
          results={results} 
        />

        {results.suggestions?.some((s: string) => s.includes('FROTA EXCEDIDA')) && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 space-y-3">
            <div className="flex items-center gap-3 text-amber-700 font-bold">
              <AlertTriangle size={20} />
              <span>Atenção: Dimensionamento de Frota</span>
            </div>
            <div className="space-y-1">
              {results.suggestions.filter((s: string) => s.includes('FROTA EXCEDIDA') || s.includes('Sugestão') || s.startsWith('- ')).map((s: string, i: number) => (
                <p key={i} className={`text-sm ${s.startsWith('- ') ? 'ml-6 text-amber-600 font-mono' : 'text-amber-800 font-medium'}`}>
                  {s}
                </p>
              ))}
            </div>
          </div>
        )}

        {visibleRoutes.map((route) => {
          const routeResult = results.routeResults?.find((r: any) => r.id === route.id);
          
          return (
            <div 
              key={route.id} 
              className={`bg-white rounded-3xl shadow-sm border transition-all ${
                editingId === route.id ? 'border-emerald-500 ring-4 ring-emerald-500/5' : 'border-black/5'
              }`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${route.active ? 'bg-emerald-50 text-emerald-500' : 'bg-black/5 text-black/20'}`}>
                      <Truck size={24} />
                    </div>
                    {editingId === route.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={route.name}
                          onChange={(e) => handleUpdateRoute(route.id, { name: e.target.value })}
                          className="text-lg font-bold bg-[#F8F9FA] border border-black/5 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          placeholder="Nome da Rota"
                        />
                        <div className="flex flex-col gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                          <label className="text-[10px] font-black text-emerald-700 uppercase tracking-widest flex items-center gap-2">
                            <PlusCircle size={12} /> Massa Mensal Planejada (t)
                          </label>
                          <input
                            type="number"
                            value={route.targetMass || ''}
                            onChange={(e) => handleMassChange(route.id, route.name, parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-emerald-200 rounded-lg px-3 py-2 text-sm font-mono font-bold text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            placeholder="Informe a massa para esta frente..."
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h4 className="text-lg font-bold text-black/80">{route.name}</h4>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${route.active ? 'bg-emerald-100 text-emerald-700' : 'bg-black/5 text-black/40'}`}>
                            {route.active ? 'Ativa' : 'Inativa'}
                          </span>
                          
                          {/* Display mass in view mode */}
                          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
                            Massa: {getDerivedMass(route).toLocaleString()} t
                          </span>

                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${route.processType === 'seco' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                            {route.processType === 'seco' ? 'A Seco' : 'A Úmido'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleUpdateRoute(route.id, { isManualOverride: !route.isManualOverride })}
                        className={`p-2.5 rounded-xl transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest ${route.isManualOverride ? 'bg-amber-500 text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'}`}
                        title={route.isManualOverride ? 'Modo Manual Ativado' : 'Modo Automático Ativado'}
                      >
                        {route.isManualOverride ? 'Manual' : 'Auto'}
                      </button>
                      <button
                        onClick={() => handleUpdateRoute(route.id, { active: !route.active })}
                        className={`p-2.5 rounded-xl transition-all ${route.active ? 'text-emerald-500 bg-emerald-50' : 'text-black/40 bg-black/5'}`}
                        title={route.active ? 'Desativar' : 'Ativar'}
                      >
                        <Activity size={18} />
                      </button>
                      <button
                        onClick={() => setEditingId(editingId === route.id ? null : route.id)}
                        className={`p-2.5 rounded-xl transition-all ${editingId === route.id ? 'bg-emerald-500 text-white' : 'bg-black/5 text-black/40 hover:bg-black/10'}`}
                      >
                        {editingId === route.id ? <Check size={18} /> : <Edit2 size={18} />}
                      </button>
                      <button
                        onClick={() => handleDeleteRoute(route.id)}
                        className="p-2.5 rounded-xl bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-8">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1.5">
                      <Truck size={12} /> Caminhões
                    </label>
                    {editingId === route.id ? (
                      <input
                        type="number"
                        value={route.truckCount}
                        onChange={(e) => handleUpdateRoute(route.id, { truckCount: parseInt(e.target.value) || 0, isManualOverride: true })}
                        className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    ) : (
                      <p className="text-lg font-mono font-bold">{route.truckCount}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1.5">
                      <Plus size={12} /> Cap. (t)
                    </label>
                    {editingId === route.id ? (
                      <input
                        type="number"
                        value={route.truckCapacity}
                        onChange={(e) => handleUpdateRoute(route.id, { truckCapacity: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    ) : (
                      <p className="text-lg font-mono font-bold">{route.truckCapacity}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1.5">
                      <MapPin size={12} /> DMT (m)
                    </label>
                    {editingId === route.id ? (
                      <input
                        type="number"
                        value={route.distance}
                        onChange={(e) => handleUpdateRoute(route.id, { distance: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    ) : (
                      <p className="text-lg font-mono font-bold">{route.distance}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1.5">
                      <Clock size={12} /> Ciclo Calculado (min)
                    </label>
                    <div className="w-full bg-black/5 border border-black/5 rounded-xl px-3 py-2 text-sm font-mono font-bold text-black/60">
                      {calculateCycle(route.distance).toFixed(2)}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1.5">
                      <Activity size={12} /> DF (%)
                    </label>
                    {editingId === route.id ? (
                      <input
                        type="number"
                        value={route.mechanicalAvailability}
                        onChange={(e) => handleUpdateRoute(route.id, { mechanicalAvailability: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    ) : (
                      <p className="text-lg font-mono font-bold">{route.mechanicalAvailability}%</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-1.5">
                      <Activity size={12} /> EO (%)
                    </label>
                    {editingId === route.id ? (
                      <input
                        type="number"
                        value={route.operationalEfficiency}
                        onChange={(e) => handleUpdateRoute(route.id, { operationalEfficiency: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-3 py-2 text-sm font-mono"
                      />
                    ) : (
                      <p className="text-lg font-mono font-bold">{route.operationalEfficiency}%</p>
                    )}
                  </div>
                </div>

                {routeResult && (
                  <div className="space-y-6 pt-6 border-t border-black/5">
                    <div>
                      <h5 className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Activity size={12} /> Dimensionamento Individual (Frota Total: {premises.truckCount})
                      </h5>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Frota (Viagem / Hora)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{routeResult.fullFleetTripsPerHour?.toFixed(2)}</p>
                        </div>
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Prod. Horária (t/h)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{routeResult.fullFleetHourlyProduction?.toFixed(2)}</p>
                        </div>
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Prod. Diária (t/dia)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{(routeResult.fullFleetHourlyProduction * (premises.contractedHoursMina || 24)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Prod. Mensal (t/mês)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{(routeResult.fullFleetHourlyProduction * results.effectiveHoursPerMonthMina).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Massa - Base Úmida (t)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{routeResult.wetMass?.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
                        </div>
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Horas Nec. (h)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{routeResult.fullFleetHoursNeeded?.toFixed(2)}</p>
                        </div>
                        <div className="bg-[#F8F9FA] rounded-2xl p-4">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest mb-1">Dias Nec. (dias)</p>
                          <p className="text-sm font-mono font-bold text-black/80">{routeResult.fullFleetDaysNeeded?.toFixed(2)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                        <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100/50">
                          <p className="text-[9px] font-bold text-blue-600/60 uppercase tracking-widest mb-1">Prod. Unitária (t/h/caminhão)</p>
                          <p className="text-sm font-mono font-bold text-blue-700">{routeResult.unitaryProductivity?.toFixed(2)}</p>
                        </div>
                        <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100/50">
                          <p className="text-[9px] font-bold text-blue-600/60 uppercase tracking-widest mb-1">Nec. Total (Horas/1 Caminhão)</p>
                          <p className="text-sm font-mono font-bold text-blue-700">{routeResult.totalHoursOneTruck?.toFixed(2)}</p>
                        </div>
                        <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100/50">
                          <p className="text-[9px] font-bold text-blue-600/60 uppercase tracking-widest mb-1">Demanda Horária (t/h)</p>
                          <p className="text-sm font-mono font-bold text-blue-700">{routeResult.requiredHourlyDemand?.toFixed(2)}</p>
                        </div>
                        <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100/50">
                          <div className="flex justify-between items-start mb-1">
                            <p className="text-[9px] font-bold text-emerald-600/60 uppercase tracking-widest">Caminhões Necessários</p>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleUpdateRoute(route.id, { truckCount: routeResult.suggestedTrucks, isManualOverride: false })}
                                className="text-[8px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded hover:bg-emerald-200 transition-colors"
                                title="Aplicar valor fracionado (Folga Teórica)"
                              >
                                Folga Teórica
                              </button>
                              <button
                                onClick={() => handleUpdateRoute(route.id, { truckCount: Math.ceil(routeResult.suggestedTrucks), isManualOverride: false })}
                                className="text-[8px] font-bold bg-emerald-600 text-white px-1.5 py-0.5 rounded hover:bg-emerald-700 transition-colors"
                                title="Arredondar para cima (Frota Física)"
                              >
                                Frota Física
                              </button>
                            </div>
                          </div>
                          <p className="text-sm font-mono font-bold text-emerald-700">{routeResult.suggestedTrucks?.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between p-6 bg-emerald-50/50 rounded-3xl border border-emerald-100/50">
                      <div className="space-y-1">
                        <h5 className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Sugestão de Alocação Otimizada</h5>
                        <p className="text-sm text-black/60">Baseado na produtividade exigida para este fluxo no mês.</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-[9px] font-bold text-black/40 uppercase tracking-widest">Caminhões Sugeridos</p>
                          <p className="text-2xl font-mono font-bold text-emerald-600">{routeResult.suggestedTrucks?.toFixed(2)}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button 
                            onClick={() => handleUpdateRoute(route.id, { truckCount: routeResult.suggestedTrucks, isManualOverride: false })}
                            className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-4 py-2 rounded-xl text-xs font-bold transition-all"
                          >
                            Aplicar Folga Teórica
                          </button>
                          <button 
                            onClick={() => handleUpdateRoute(route.id, { truckCount: Math.ceil(routeResult.suggestedTrucks), isManualOverride: false })}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all"
                          >
                            Aplicar Frota Física
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RouteManager;
