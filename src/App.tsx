import React, { useState, useMemo, useEffect, useRef } from "react";
import { 
  LayoutDashboard, 
  Truck, 
  Settings, 
  Calendar, 
  Save, 
  Download, 
  AlertTriangle,
  ClipboardList,
  RefreshCw,
  TrendingUp,
  ArrowRight,
  ArrowLeft,
  Play
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Route, DetailedPremises, Scenario, DailyLog } from "./types";
import { DEFAULT_PREMISES, INITIAL_ROUTES } from "./constants";
import { calculateTotalProduction } from "./utils/calculations";
import { generatePortableHTML } from "./utils/export";

// Components
import Dashboard from "./components/Dashboard";
import RouteManager from "./components/RouteManager";
import PremisesForm from "./components/PremisesForm";
import ProductionCalendar from "./components/ProductionCalendar";
import ScenarioManager from "./components/ScenarioManager";
import ProductionLogging from "./components/ProductionLogging";
import ReplanningView from "./components/ReplanningView";

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState("premises"); // Start with premises for the workflow
  const [workflowMode, setWorkflowMode] = useState(true);
  const [routes, setRoutes] = useState<Route[]>(INITIAL_ROUTES);
  const [premises, setPremises] = useState<DetailedPremises>(DEFAULT_PREMISES);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [productionLogs, setProductionLogs] = useState<Record<string, DailyLog[]>>({});
  const initialPremisesRef = useRef(premises);
  const isLoadedRef = useRef(false);

  // Recalculate results whenever routes, premises, or logs change
  const results = useMemo(() => 
    calculateTotalProduction(routes, premises, productionLogs), 
    [routes, premises, productionLogs]
  );

  // Persistence: Load from localStorage on mount
  useEffect(() => {
    try {
      const savedRoutes = localStorage.getItem('mineplanner_routes');
      const savedPremises = localStorage.getItem('mineplanner_premises');
      const savedLogs = localStorage.getItem('mineplanner_logs');
      
      if (savedRoutes) setRoutes(JSON.parse(savedRoutes));
      if (savedPremises) setPremises(JSON.parse(savedPremises));
      if (savedLogs) setProductionLogs(JSON.parse(savedLogs));
      
      isLoadedRef.current = true;
    } catch (e) {
      console.error("Erro ao carregar dados salvos:", e);
      isLoadedRef.current = true;
    }
  }, []);

  // Persistence: Save to localStorage on change
  useEffect(() => {
    if (!isLoadedRef.current) return;
    
    localStorage.setItem('mineplanner_routes', JSON.stringify(routes));
    localStorage.setItem('mineplanner_premises', JSON.stringify(premises));
    localStorage.setItem('mineplanner_logs', JSON.stringify(productionLogs));
  }, [routes, premises, productionLogs]);

  // Auto-sync suggested trucks when results change or on mount
  // This ensures the fleet is always optimized to meet the target
  useEffect(() => {
    if (results.routeResults?.length > 0) {
      const updatedRoutes = routes.map(route => {
        // Only sync if NOT manually overridden
        if (route.isManualOverride) return route;

        const routeResult = results.routeResults.find((r: any) => r.id === route.id);
        if (routeResult && routeResult.suggestedTrucks > 0) {
          const suggested = Math.ceil(routeResult.suggestedTrucks);
          // Only update if the value is different to avoid infinite loops
          if (route.truckCount !== suggested) {
            return { ...route, truckCount: suggested };
          }
        }
        return route;
      });

      // Only call setRoutes if at least one route actually changed
      const hasChanges = updatedRoutes.some((route, index) => route !== routes[index]);
      if (hasChanges) {
        setRoutes(updatedRoutes);
      }
    }
  }, [results.routeResults, routes]);

  // Monitor premises changes but don't force reset routes automatically
  // The user should control their own routes
  const prevPremisesRef = useRef(premises);
  useEffect(() => {
    prevPremisesRef.current = premises;
  }, [premises]);

  const resetSimulation = () => {
    setProductionLogs({});
    setPremises(initialPremisesRef.current);
  };

  const workflowSteps = [
    { id: "premises", label: "1. Premissas Fundamentais", icon: Settings },
    { id: "routes", label: "2. Dimensionamento de Frota", icon: Truck },
    { id: "dashboard", label: "3. Resultados & Simulação", icon: LayoutDashboard },
  ];

  const currentStepIndex = workflowSteps.findIndex(s => s.id === activeTab);

  const nextStep = () => {
    if (currentStepIndex < workflowSteps.length - 1) {
      setActiveTab(workflowSteps[currentStepIndex + 1].id);
    } else {
      setWorkflowMode(false);
      setActiveTab("dashboard");
    }
  };

  const prevStep = () => {
    if (currentStepIndex > 0) {
      setActiveTab(workflowSteps[currentStepIndex - 1].id);
    }
  };

  const exportToCSV = () => {
    const headers = ["Data", "Rota", "Produção Planejada (t/dia)", "Produção Realizada (t/dia)"];
    const rows: string[][] = [];
    
    routes.forEach((route, idx) => {
      const routeResult = results.routeResults[idx];
      rows.push([new Date().toLocaleDateString(), route.name, (routeResult?.dailyProduction || 0).toFixed(2), ""]);
    });

    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + rows.map(e => e.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `planejamento_producao_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToHTML = () => {
    try {
      generatePortableHTML(premises, routes, productionLogs, results);
    } catch (error) {
      console.error("Erro ao gerar exportação HTML:", error);
      alert("Ocorreu um erro ao gerar o arquivo. Por favor, tente novamente.");
    }
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "routes", label: "Rotas de Transporte", icon: Truck },
    { id: "premises", label: "Premissas Operacionais", icon: Settings },
    { id: "logging", label: "Lançamento Produção", icon: ClipboardList },
    { id: "replanning", label: "Replanejamento", icon: RefreshCw },
    { id: "calendar", label: "Calendário", icon: Calendar },
    { id: "scenarios", label: "Cenários", icon: Save },
  ];

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-[#151619] text-white flex flex-col shadow-xl z-20">
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
              <TrendingUp size={24} className="text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">T2MinePlanner</h1>
          </div>
          <p className="text-[10px] text-white/40 mt-2 uppercase tracking-widest font-mono">
            Production Engine v2.0
          </p>
        </div>
        
        <nav className="flex-1 py-4 overflow-y-auto">
          {(!workflowMode ? navItems : workflowSteps).map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-6 py-3.5 transition-all relative ${
                activeTab === item.id 
                  ? "text-emerald-400 bg-emerald-400/5 font-bold" 
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              {activeTab === item.id && (
                <motion.div 
                  layoutId="activeTab"
                  className="absolute left-0 w-1 h-full bg-emerald-500 rounded-r-full"
                />
              )}
              <item.icon size={18} className={activeTab === item.id ? "text-emerald-400" : "text-white/20"} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
          
          {!workflowMode ? (
            <div className="px-6 py-4 mt-4">
              <button 
                onClick={() => {
                  setWorkflowMode(true);
                  setActiveTab("premises");
                }}
                className="w-full flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 py-2.5 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all border border-emerald-500/20"
              >
                <Play size={12} />
                Ativar Modo Guia
              </button>
            </div>
          ) : (
             <div className="px-6 py-4 mt-4">
                <button 
                  onClick={() => setWorkflowMode(false)}
                  className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white/40 py-2 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all"
                >
                  Sair do Modo Guia
                </button>
             </div>
          )}
        </nav>

        <div className="p-6 border-t border-white/10 bg-black/20">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-3 h-3 rounded-full animate-pulse ${results.isTargetAtRisk ? 'bg-red-500' : 'bg-emerald-500'}`} />
            <span className="text-xs font-medium text-white/70">
              {results.isTargetAtRisk ? 'Meta em Risco' : 'Operação Normal'}
            </span>
          </div>
          <button 
            onClick={exportToCSV}
            className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white py-2.5 rounded-xl text-sm font-medium transition-all mb-2"
          >
            <Download size={16} />
            Exportar CSV
          </button>
          <button 
            onClick={exportToHTML}
            className="w-full flex items-center justify-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 py-2.5 rounded-xl text-sm font-medium transition-all"
          >
            <Download size={16} />
            Exportar HTML
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto relative">
        <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-black/5 px-8 py-4 flex justify-between items-center z-10">
          <div>
            <h2 className="text-2xl font-bold italic font-serif tracking-tight text-[#1A1A1A]">
              {workflowMode ? "Workflow de Simulação" : (navItems.find(i => i.id === activeTab)?.label)}
            </h2>
            <p className="text-xs text-black/40 font-mono">
              {workflowMode ? `Passo ${currentStepIndex + 1} de ${workflowSteps.length}: ${workflowSteps[currentStepIndex].label}` : new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest">ROM - Meta (t/dia)</span>
              <span className="text-xl font-mono font-bold text-emerald-600">
                {results.plannedDailyROM.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Planta - Meta (t/dia)</span>
              <span className="text-xl font-mono font-bold text-blue-600">
                {results.plannedDailyPlanta.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </span>
            </div>
            {premises.processType === 'umido' && (
              <div className="flex flex-col items-end">
                <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Rejeito - Meta (t/dia)</span>
                <span className="text-xl font-mono font-bold text-amber-600">
                  {results.plannedDailyRejeito.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                </span>
              </div>
            )}
            <div className="w-px h-8 bg-black/10" />
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-black/40 uppercase tracking-widest">Movimentação Total (t/dia)</span>
              <span className="text-xl font-mono font-bold text-[#1A1A1A]">
                {results.movimentacaoTotalDiaria.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
              </span>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {workflowMode && (
            <div className="mb-8 flex items-center justify-between bg-white p-4 rounded-2xl border border-black/5 shadow-sm">
               <div className="flex items-center gap-4">
                  {workflowSteps.map((step, idx) => (
                    <React.Fragment key={step.id}>
                      <div className={`flex items-center gap-2 ${activeTab === step.id ? 'text-emerald-600' : idx < currentStepIndex ? 'text-emerald-400' : 'text-black/20'}`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${activeTab === step.id ? 'border-emerald-600 bg-emerald-50' : idx < currentStepIndex ? 'border-emerald-400 bg-emerald-400 text-white' : 'border-black/10'}`}>
                          {idx + 1}
                        </div>
                        <span className="text-xs font-bold uppercase tracking-wider">{step.label.split('. ')[1]}</span>
                      </div>
                      {idx < workflowSteps.length - 1 && <div className="w-8 h-px bg-black/5" />}
                    </React.Fragment>
                  ))}
               </div>
               
               <div className="flex items-center gap-3">
                  {currentStepIndex > 0 && (
                    <button 
                      onClick={prevStep}
                      className="flex items-center gap-2 px-4 py-2 text-black/40 hover:text-black transition-all text-sm font-bold uppercase tracking-widest"
                    >
                      <ArrowLeft size={16} />
                      Voltar
                    </button>
                  )}
                  <button 
                    onClick={nextStep}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
                  >
                    {currentStepIndex === workflowSteps.length - 1 ? (
                      <>
                        <Play size={16} />
                        Finalizar & Ver Dashboard
                      </>
                    ) : (
                      <>
                        Próximo
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
               </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === "dashboard" && (
                <Dashboard 
                  results={results} 
                  premises={premises} 
                  routes={routes}
                  productionLogs={productionLogs}
                  setLogs={setProductionLogs} 
                  onReset={resetSimulation} 
                  onPremiseChange={setPremises}
                />
              )}
              {activeTab === "routes" && <RouteManager routes={routes} setRoutes={setRoutes} results={results} premises={premises} setPremises={setPremises} />}
              {activeTab === "premises" && (
                <PremisesForm 
                  premises={premises} 
                  setPremises={setPremises} 
                  setRoutes={setRoutes} 
                  results={results} 
                />
              )}
              {activeTab === "logging" && (
                <ProductionLogging 
                  routes={routes} 
                  logs={productionLogs} 
                  setLogs={setProductionLogs} 
                  results={results}
                  premises={premises}
                  onReset={resetSimulation}
                />
              )}
              {activeTab === "replanning" && <ReplanningView results={results} premises={premises} />}
              {activeTab === "calendar" && (
                <ProductionCalendar 
                  results={results} 
                  premises={premises} 
                  logs={productionLogs} 
                />
              )}
              {activeTab === "scenarios" && (
                <ScenarioManager 
                  routes={routes} 
                  premises={premises}
                  scenarios={scenarios} 
                  setScenarios={setScenarios}
                  setRoutes={setRoutes}
                  setPremises={setPremises}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default App;
