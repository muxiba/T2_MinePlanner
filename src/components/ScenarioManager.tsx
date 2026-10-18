import React, { useState } from 'react';
import { Save, Trash2, RefreshCw, Plus, Download, Upload, FileJson } from 'lucide-react';
import { Route, DetailedPremises, Scenario } from '../types';

interface ScenarioManagerProps {
  routes: Route[];
  premises: DetailedPremises;
  scenarios: Scenario[];
  /** Salva um cenário no banco; retorna true em caso de sucesso. */
  onCreate: (name: string, routes: Route[], premises: DetailedPremises) => Promise<boolean>;
  onDelete: (id: string) => void | Promise<void>;
  setRoutes: (routes: Route[]) => void;
  setPremises: (premises: DetailedPremises) => void;
  error?: string | null;
}

const ScenarioManager: React.FC<ScenarioManagerProps> = ({
  routes,
  premises,
  scenarios,
  onCreate,
  onDelete,
  setRoutes,
  setPremises,
  error,
}) => {
  const [scenarioName, setScenarioName] = useState('');

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!scenarioName.trim() || saving) return;
    setSaving(true);
    const ok = await onCreate(scenarioName.trim(), structuredClone(routes), structuredClone(premises));
    setSaving(false);
    if (ok) setScenarioName('');
  };

  const handleLoad = (scenario: Scenario) => {
    setRoutes(scenario.routes);
    setPremises(scenario.premises);
  };

  const handleDelete = (scenario: Scenario) => {
    if (window.confirm(`Excluir o cenário "${scenario.name}"?`)) void onDelete(scenario.id);
  };

  const exportToJSON = (scenario: Scenario) => {
    const dataStr = JSON.stringify(scenario, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cenario_${scenario.name.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const importedScenario = JSON.parse(content);
        
        // Basic validation
        if (importedScenario.name && Array.isArray(importedScenario.routes) && importedScenario.premises) {
          void onCreate(String(importedScenario.name), importedScenario.routes, importedScenario.premises);
        } else {
          alert("Arquivo JSON inválido para cenários.");
        }
      } catch (err) {
        console.error("Erro ao importar cenário:", err);
        alert("Erro ao ler o arquivo. Verifique se é um JSON válido.");
      }
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  return (
    <div className="space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
          <Save size={24} className="text-emerald-500" />
          Salvar Cenário Atual
        </h3>
        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 flex gap-2">
            <input
              type="text"
              placeholder="Nome do cenário (ex: Plano A - 7 Caminhões)"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              className="flex-1 bg-[#F8F9FA] border border-black/5 rounded-xl px-6 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving || !scenarioName.trim()}
              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 px-8 rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Plus size={18} />
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
          
          <div className="flex items-center gap-2">
            <label className="cursor-pointer bg-white hover:bg-black/[0.02] text-black/60 font-bold py-3 px-6 rounded-xl border border-black/5 transition-all flex items-center gap-2">
              <Upload size={18} />
              Importar JSON
              <input 
                type="file" 
                className="hidden" 
                accept=".json"
                onChange={handleFileUpload} 
              />
            </label>
          </div>
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
                onClick={() => handleDelete(scenario)}
                aria-label={`Excluir cenário ${scenario.name}`}
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

            <div className="flex gap-2">
              <button
                onClick={() => handleLoad(scenario)}
                className="flex-1 flex items-center justify-center gap-2 bg-[#F8F9FA] hover:bg-emerald-50 hover:text-emerald-600 text-black/60 py-3 rounded-xl text-sm font-bold transition-all border border-black/5"
              >
                <RefreshCw size={16} />
                Carregar
              </button>
              <button
                onClick={() => exportToJSON(scenario)}
                className="px-4 flex items-center justify-center bg-white hover:bg-blue-50 hover:text-blue-600 text-black/40 py-3 rounded-xl text-sm font-bold transition-all border border-black/5"
                title="Exportar como JSON"
              >
                <Download size={16} />
              </button>
            </div>
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
