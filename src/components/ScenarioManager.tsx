import React, { useState } from 'react';
import { Save, Trash2, RefreshCw, Plus } from 'lucide-react';
import { Route, DetailedPremises, Scenario } from '../types';

interface ScenarioManagerProps {
  routes: Route[];
  premises: DetailedPremises;
  scenarios: Scenario[];
  setScenarios: React.Dispatch<React.SetStateAction<Scenario[]>>;
  setRoutes: (routes: Route[]) => void;
  setPremises: (premises: DetailedPremises) => void;
}

const ScenarioManager: React.FC<ScenarioManagerProps> = ({ 
  routes, 
  premises, 
  scenarios, 
  setScenarios, 
  setRoutes, 
  setPremises 
}) => {
  const [scenarioName, setScenarioName] = useState('');

  const handleSave = () => {
    if (!scenarioName.trim()) return;
    
    const newScenario: Scenario = {
      id: Math.random().toString(36).substr(2, 9),
      name: scenarioName,
      routes: JSON.parse(JSON.stringify(routes)),
      premises: JSON.parse(JSON.stringify(premises)),
      timestamp: Date.now(),
    };
    
    setScenarios([...scenarios, newScenario]);
    setScenarioName('');
  };

  const handleLoad = (scenario: Scenario) => {
    setRoutes(scenario.routes);
    setPremises(scenario.premises);
  };

  const handleDelete = (id: string) => {
    setScenarios(scenarios.filter(s => s.id !== id));
  };

  return (
    <div className="space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
          <Save size={24} className="text-emerald-500" />
          Salvar Cenário Atual
        </h3>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Nome do cenário (ex: Plano A - 7 Caminhões)"
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            className="flex-1 bg-[#F8F9FA] border border-black/5 rounded-xl px-6 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
          />
          <button
            onClick={handleSave}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3 px-8 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            <Plus size={18} />
            Salvar
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {scenarios.map((scenario) => (
          <div key={scenario.id} className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h4 className="font-bold text-black/80 group-hover:text-emerald-600 transition-colors">{scenario.name}</h4>
                <p className="text-[10px] font-bold text-black/30 uppercase tracking-widest mt-1">
                  {new Date(scenario.timestamp).toLocaleString('pt-BR')}
                </p>
              </div>
              <button
                onClick={() => handleDelete(scenario.id)}
                className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-all"
              >
                <Trash2 size={16} />
              </button>
            </div>
            
            <div className="space-y-3 mb-6">
              <div className="flex justify-between text-xs">
                <span className="text-black/40 font-medium">Rotas Ativas</span>
                <span className="font-mono font-bold">{scenario.routes.filter(r => r.active).length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-black/40 font-medium">Meta ROM</span>
                <span className="font-mono font-bold">{scenario.premises.targetMonthlyROM.toLocaleString('pt-BR')} t</span>
              </div>
            </div>

            <button
              onClick={() => handleLoad(scenario)}
              className="w-full flex items-center justify-center gap-2 bg-[#F8F9FA] hover:bg-emerald-50 hover:text-emerald-600 text-black/60 py-3 rounded-xl text-sm font-bold transition-all border border-black/5"
            >
              <RefreshCw size={16} />
              Carregar Cenário
            </button>
          </div>
        ))}
        
        {scenarios.length === 0 && (
          <div className="col-span-full py-20 text-center bg-white rounded-3xl border border-dashed border-black/10">
            <div className="w-16 h-16 bg-black/5 rounded-full flex items-center justify-center mx-auto mb-4">
              <Save size={32} className="text-black/20" />
            </div>
            <p className="text-sm font-medium text-black/40">Nenhum cenário salvo ainda.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScenarioManager;
