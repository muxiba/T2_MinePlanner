import React from 'react';
import { 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Activity,
  Zap,
  Clock,
  Truck,
  RefreshCw,
  Download,
  Filter,
  Scale,
  Target,
  PlusCircle,
  ArrowRight,
  Info,
  ChevronRight,
  Database,
  Factory,
  MapPin,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  BarElement,
  Title, 
  Tooltip, 
  Legend, 
  Filler,
  ArcElement
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { DetailedPremises, OperationalDiagnostic } from '../types';
import { generatePortableHTML } from '../utils/export';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface DashboardProps {
  results: any;
  premises: DetailedPremises;
  routes: any[];
  productionLogs: Record<string, any[]>;
  setLogs: React.Dispatch<React.SetStateAction<Record<string, any[]>>>;
  onReset?: () => void;
  onPremiseChange?: (newPremises: DetailedPremises) => void;
}

const InfoTooltip: React.FC<{ text: string }> = ({ text }) => (
  <div className="group relative inline-block ml-1">
    <Info size={12} className="text-black/20 cursor-help hover:text-blue-500 transition-colors" />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-3 bg-[#1A1A1A] text-white text-[10px] font-medium rounded-xl shadow-2xl z-50 leading-relaxed">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-[#1A1A1A]" />
    </div>
  </div>
);

const Dashboard: React.FC<DashboardProps> = ({ results, premises, routes, productionLogs, setLogs, onReset, onPremiseChange }) => {
  const initialPremises = React.useRef<DetailedPremises | null>(null);

  // Capture initial premises on mount for reset functionality
  React.useEffect(() => {
    if (!initialPremises.current) {
      initialPremises.current = JSON.parse(JSON.stringify(premises));
    }
  }, []);

  const handleResetSimulation = () => {
    if (initialPremises.current && onPremiseChange) {
      onPremiseChange(JSON.parse(JSON.stringify(initialPremises.current)));
    }
    if (onReset) {
      onReset();
    } else {
      setLogs({});
    }
  };

  // Helper to calculate required fleet automatically
  const autoCalculateFleet = (newTarget: number, newPlantRate: number) => {
    // We use the current ratio of trucks needed to target to estimate the new fleet
    // This provides an immediate visual feedback on the slider
    const currentTarget = premises.targetMonthlyROM;
    const currentNeeded = results.totalTrucksNeeded;

    if (currentTarget > 0 && currentNeeded > 0) {
      const trucksPerTon = currentNeeded / currentTarget;
      const estimatedTrucks = Math.ceil(newTarget * trucksPerTon);
      return isFinite(estimatedTrucks) ? Math.max(1, estimatedTrucks) : premises.truckCount;
    }
    
    // If we don't have a good ratio yet, try a very rough estimate (1 truck per 20k tons)
    // or just keep the current count
    if (newTarget > 0) {
      const roughEstimate = Math.ceil(newTarget / 20000);
      return Math.max(1, roughEstimate);
    }

    return premises.truckCount || 1;
  };

  const exportToCSV = () => {
    const headers = ["Indicador", "Possível", "Necessária"];
    const rows = [
      ["Movimentação Total - Base Úmida (t)", results.simulationResults.totalWetMassPossible.toFixed(2), results.simulationResults.totalWetMassNecessary.toFixed(2)],
      ["Produção (t/h)", results.simulationResults.productionHourlyPossible.toFixed(2), results.simulationResults.productionHourlyNecessary.toFixed(2)],
      ["Produção (t/dia)", results.simulationResults.productionDailyPossible.toFixed(2), results.simulationResults.productionDailyNecessary.toFixed(2)],
      ["", "", ""],
      ["KPIs", "Valor", "Unidade"],
      ["Produção ROM Total", results.totalMonthlyROM.toFixed(2), "t/mês"],
      ["Dias Efetivos (Mina)", results.effectiveCalendarDaysMina.toFixed(2), "dias/mês"],
      ["Utilização da Planta", results.plantUtilization.toFixed(1), "%"],
      ["Utilização da Frota", results.fleetUtilization.toFixed(1), "%"],
      ["", "", ""],
      ["Diagnóstico", "Status", "Descrição"],
      ["Análise Operacional", results.diagnostic.label, results.diagnostic.description],
      ["", "", ""],
      ["Rotas", "Produção (t/h)", "Frota Sugerida"],
      ...results.routeResults.map(r => [
        r.name,
        r.hourlyProduction.toFixed(2),
        r.suggestedTrucks.toFixed(1)
      ])
    ];

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `dashboard_simulacao_${new Date().toISOString().split('T')[0]}.csv`);
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
  const lineData = {
    labels: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'],
    datasets: [
      {
        label: 'Produção ROM (t)',
        data: [
          results.totalDailyROM * 7 * 0.9,
          results.totalDailyROM * 7 * 1.05,
          results.totalDailyROM * 7 * 0.95,
          results.totalDailyROM * 7
        ],
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
      },
      {
        label: 'Meta (t)',
        data: Array(4).fill(premises.targetMonthlyROM / 4),
        borderColor: '#000',
        borderDash: [5, 5],
        fill: false,
      }
    ],
  };

  const barData = {
    labels: results.routeResults.map((r: any) => r.name),
    datasets: [
      {
        label: 'Produção por Rota (t/dia)',
        data: results.routeResults.map((r: any) => r.dailyProduction),
        backgroundColor: '#3b82f6',
        borderRadius: 8,
      }
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          display: false,
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  };

  const diagnostic: OperationalDiagnostic = results.diagnostic;

  return (
    <div className="space-y-8">
      {/* Inviable Scenario Alert */}
      {diagnostic.isInviable && (
        <div className="bg-red-50 border-2 border-red-200 p-6 rounded-[32px] flex items-start gap-4 animate-pulse">
          <div className="p-3 bg-red-100 text-red-600 rounded-2xl">
            <AlertTriangle size={32} />
          </div>
          <div>
            <h3 className="text-xl font-black text-red-900 uppercase tracking-tight">Cenário Operacional Inviável</h3>
            <p className="text-red-700 font-medium">{diagnostic.inviabilityReason}</p>
            <p className="text-red-600/60 text-xs mt-2 uppercase font-bold tracking-widest">Ajuste as premissas de frota ou metas para prosseguir com um plano factível.</p>
          </div>
        </div>
      )}

      {/* Executive Status Header */}
      <div className={`p-8 rounded-[40px] shadow-2xl transition-all duration-500 border-l-[12px] ${
        diagnostic.status === 'balanced' ? 'bg-emerald-600 border-emerald-800 text-white shadow-emerald-600/20' :
        diagnostic.status === 'idle_fleet' ? 'bg-blue-600 border-blue-800 text-white shadow-blue-600/20' :
        diagnostic.status === 'plant_bottleneck' ? 'bg-amber-500 border-amber-700 text-white shadow-amber-500/20' :
        diagnostic.status === 'unbalanced' ? 'bg-orange-600 border-orange-800 text-white shadow-orange-600/20' :
        'bg-red-600 border-red-800 text-white shadow-red-600/20'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="p-5 bg-white/20 rounded-[32px] backdrop-blur-md">
              {diagnostic.status === 'balanced' ? <CheckCircle2 size={48} /> :
               diagnostic.status === 'idle_fleet' ? <Truck size={48} /> :
               diagnostic.status === 'plant_bottleneck' ? <Filter size={48} /> :
               <AlertTriangle size={48} />}
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70">Status Operacional</span>
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              </div>
              <h2 className="text-4xl font-black tracking-tighter uppercase">{diagnostic.label}</h2>
              <p className="text-lg opacity-80 font-medium max-w-2xl mt-2">{diagnostic.description}</p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <div className="text-right mb-4">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 mb-1">Eficiência Global</p>
              <p className="text-6xl font-black tracking-tighter">
                {diagnostic.indicators.productionEfficiency.toFixed(1)}%
              </p>
            </div>
            <div className="flex gap-2">
              <span className="px-4 py-2 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
                {premises.processType === 'umido' ? 'A Úmido' : 'A Seco'}
              </span>
              <span className="px-4 py-2 bg-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest backdrop-blur-sm">
                {premises.truckCount} Caminhões
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Strategic Indicators Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-shadow group">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform">
              <Truck size={24} />
            </div>
            <div className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${
              diagnostic.indicators.fleetUtilization > 95 ? 'bg-red-50 text-red-600' :
              diagnostic.indicators.fleetUtilization > 85 ? 'bg-emerald-50 text-emerald-600' :
              'bg-blue-50 text-blue-600'
            }`}>
              {diagnostic.indicators.fleetUtilization > 95 ? 'Crítico' : 'Otimizado'}
            </div>
          </div>
          <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
            Utilização da Frota
            <InfoTooltip text="Relação entre horas demandadas e horas disponíveis. Limitada a 100% para consistência física." />
          </div>
          <h4 className="text-3xl font-black tracking-tighter text-[#1A1A1A]">
            {diagnostic.indicators.fleetUtilization.toFixed(1)}%
            {diagnostic.indicators.fleetOverload > 0 && (
              <span className="text-[10px] font-black text-red-600 ml-2 block lg:inline">
                (+{diagnostic.indicators.fleetOverload.toFixed(0)}% Sobrecarga)
              </span>
            )}
          </h4>
          <div className="mt-4 w-full bg-black/5 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-1000 ${
                diagnostic.indicators.fleetOverload > 0 ? 'bg-red-500' : 
                diagnostic.indicators.fleetUtilization > 90 ? 'bg-amber-500' : 'bg-blue-500'
              }`} 
              style={{ width: `${diagnostic.indicators.fleetUtilization}%` }} 
            />
          </div>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-shadow group">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl group-hover:scale-110 transition-transform">
              <Filter size={24} />
            </div>
            <div className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${
              diagnostic.indicators.bottleneckIndex > 1 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
            }`}>
              {diagnostic.indicators.bottleneckIndex > 1 ? 'Gargalo' : 'Planta OK'}
            </div>
          </div>
          <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
            Índice de Gargalo
            <InfoTooltip text="Relação entre capacidade da planta e produção da mina. Valores > 1 indicam que a mina produz mais que a planta." />
          </div>
          <h4 className="text-3xl font-black tracking-tighter text-[#1A1A1A]">
            {diagnostic.indicators.bottleneckIndex.toFixed(2)}
          </h4>
          <p className="text-[10px] text-black/40 mt-2 italic">Cap. Planta / Prod. Mina</p>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-shadow group">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl group-hover:scale-110 transition-transform">
              <Scale size={24} />
            </div>
            <div className="px-2 py-1 bg-purple-50 text-purple-600 rounded-full text-[8px] font-black uppercase tracking-widest">
              Equilíbrio
            </div>
          </div>
          <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
            Índice de Balanço
            <InfoTooltip text="Mede o equilíbrio operacional entre a mina e a planta." />
          </div>
          <h4 className="text-3xl font-black tracking-tighter text-[#1A1A1A]">
            {diagnostic.indicators.balanceIndex.toFixed(2)}
          </h4>
          <p className="text-[10px] text-black/40 mt-2 italic">Mina vs Planta</p>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-shadow group">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl group-hover:scale-110 transition-transform">
              <Target size={24} />
            </div>
            <div className="px-2 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[8px] font-black uppercase tracking-widest">
              Meta
            </div>
          </div>
          <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
            Aproveitamento
            <InfoTooltip text="Percentual da produção que é efetivamente processada em relação à meta." />
          </div>
          <h4 className="text-3xl font-black tracking-tighter text-[#1A1A1A]">
            {diagnostic.indicators.productionEfficiency.toFixed(1)}%
          </h4>
          <p className="text-[10px] text-black/40 mt-2 italic">Realizado vs Meta</p>
        </div>

        <div className="bg-white p-6 rounded-[32px] border border-black/5 shadow-sm hover:shadow-md transition-shadow group">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl group-hover:scale-110 transition-transform">
              <PlusCircle size={24} />
            </div>
            <div className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${
              diagnostic.indicators.stockpileRateTPH > 0 ? 'bg-rose-50 text-rose-600' : 'bg-black/5 text-black/40'
            }`}>
              {diagnostic.indicators.stockpileRateTPH > 0 ? 'Pilha' : 'Equilibrado'}
            </div>
          </div>
          <div className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">
            Acúmulo por Gargalo
            <InfoTooltip text="Volume de material não processado devido à restrição de capacidade da planta (310 t/h)." />
          </div>
          <h4 className="text-3xl font-black tracking-tighter text-[#1A1A1A]">
            {diagnostic.indicators.stockpileRateTPH.toFixed(0)}
            <span className="text-sm font-bold ml-1 opacity-40 text-black">t/h</span>
          </h4>
          <p className="text-[10px] text-amber-600 mt-2 italic font-bold">Pilha Pulmão</p>
        </div>
      </div>

      {/* Operational Flow Visualization */}
      <div className="bg-white p-10 rounded-[40px] border border-black/5 shadow-sm">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-black/40 mb-10 flex items-center gap-2">
          <Activity size={16} /> Fluxo Operacional e Gargalos
        </h3>
        
        <div className="relative flex flex-col lg:flex-row items-center justify-between gap-12">
          {/* Connector Line */}
          <div className="absolute top-1/2 left-0 w-full h-0.5 bg-black/5 -translate-y-1/2 hidden lg:block z-0" />
          
          {/* Mine Stage */}
          <div className="relative z-10 flex flex-col items-center group">
            <div className="w-24 h-24 bg-[#151619] text-white rounded-[32px] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500">
              <Truck size={40} className="text-emerald-400" />
            </div>
            <div className="mt-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-black/40 mb-1">Mina</p>
              <p className="text-xl font-black tracking-tighter">{results.totalPossibleHourlyMovement.toFixed(0)} t/h</p>
              <p className="text-[10px] font-bold text-emerald-600 mt-1 uppercase tracking-widest">Produção Bruta</p>
            </div>
          </div>

          <ArrowRight className="text-black/10 hidden lg:block" size={32} />

          {/* Terminal Stage (Recebimento) */}
          <div className="relative z-10 flex flex-col items-center group">
            <div className="w-24 h-24 bg-blue-600 text-white rounded-[32px] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500">
              <MapPin size={40} />
            </div>
            <div className="mt-6 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-black/40 mb-1">Terminal (Recebimento)</p>
              <p className="text-xl font-black tracking-tighter">{results.totalPossibleHourlyMovement.toFixed(0)} t/h</p>
              <p className="text-[10px] font-bold text-blue-600 mt-1 uppercase tracking-widest">Fluxo Total Aparente</p>
            </div>
          </div>

          <ArrowRight className="text-black/10 hidden lg:block" size={32} />

          {/* Split Point: Planta vs Pilha */}
          <div className="relative z-10 flex flex-col gap-12">
            {/* Plant Stage */}
            <div className="flex items-center gap-6 group">
              <div className={`w-20 h-20 rounded-[24px] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500 ${
                results.plantUtilization > 100 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
              }`}>
                <Factory size={32} />
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-widest text-black/40 mb-1">Planta (Processamento)</p>
                <p className="text-xl font-black tracking-tighter">{Math.min(results.totalPossibleHourlyMovement, premises.plantFeedRateTPH).toFixed(0)} t/h</p>
                <p className={`text-[10px] font-bold mt-1 uppercase tracking-widest ${results.plantUtilization > 100 ? 'text-red-600' : 'text-blue-600'}`}>
                  {results.plantUtilization > 100 ? 'Capacidade Máxima' : 'Fluxo Efetivo'}
                </p>
              </div>
            </div>

            {/* Stockpile Stage (Gargalo) */}
            <div className="flex items-center gap-6 group">
              <div className={`w-20 h-20 rounded-[24px] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500 ${
                diagnostic.indicators.stockpileRateTPH > 0 ? 'bg-amber-100 text-amber-700 animate-pulse' : 'bg-black/5 text-black/20'
              }`}>
                <Database size={32} />
              </div>
              <div className="text-left">
                <div className="text-[10px] font-black uppercase tracking-widest text-black/40 mb-1">
                  Pilha Pulmão (Gargalo)
                  <InfoTooltip text="Material não processado devido à restrição de capacidade da planta. Acúmulo para processamento futuro." />
                </div>
                <p className={`text-xl font-black tracking-tighter ${diagnostic.indicators.stockpileRateTPH > 0 ? 'text-amber-700' : 'text-black/20'}`}>
                  {diagnostic.indicators.stockpileRateTPH.toFixed(0)} t/h
                </p>
                {diagnostic.indicators.stockpileRateTPH > 0 && (
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Material Não Processado</p>
                )}
              </div>
            </div>
          </div>

          <ArrowRight className="text-black/10 hidden lg:block" size={32} />

          {/* Destinations Stage (Output) */}
          <div className="relative z-10 flex flex-col gap-6">
            <div className="flex items-center gap-4 group">
              <div className="w-16 h-16 bg-emerald-600 text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500">
                <CheckCircle2 size={24} />
              </div>
              <div className="text-left">
                <p className="text-[8px] font-black uppercase tracking-widest text-black/40">Terminal (Produto)</p>
                <p className="text-sm font-black tracking-tighter">
                  {(Math.min(results.totalPossibleHourlyMovement, premises.plantFeedRateTPH) * (premises.rmGlobal/100)).toFixed(0)} t/h
                </p>
                <p className="text-[8px] font-bold text-emerald-600 uppercase tracking-widest">Produto Acabado</p>
              </div>
            </div>

            {premises.processType === 'umido' && (
              <div className="flex items-center gap-4 group">
                <div className="w-16 h-16 bg-rose-600 text-white rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-500">
                  <Trash2 size={24} />
                </div>
                <div className="text-left">
                  <p className="text-[8px] font-black uppercase tracking-widest text-black/40">Baia de Rejeito</p>
                  <p className="text-sm font-black tracking-tighter">
                    {(Math.min(results.totalPossibleHourlyMovement, premises.plantFeedRateTPH) * (premises.rejeitoTotal/100)).toFixed(0)} t/h
                  </p>
                  <p className="text-[8px] font-bold text-rose-600 uppercase tracking-widest">Resíduo Processo</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[8px] font-black text-black/40 uppercase tracking-widest">Entrada (Mina)</span>
              <span className="text-sm font-black font-mono">{results.totalPossibleHourlyMovement.toFixed(1)} t/h</span>
            </div>
            <div className="w-px h-6 bg-black/10" />
            <div className="flex flex-col">
              <span className="text-[8px] font-black text-black/40 uppercase tracking-widest">Saída Processada (Planta)</span>
              <span className="text-sm font-black font-mono">{Math.min(results.totalPossibleHourlyMovement, premises.plantFeedRateTPH).toFixed(1)} t/h</span>
            </div>
            <div className="w-px h-6 bg-black/10" />
            <div className="flex flex-col">
              <span className="text-[8px] font-black text-amber-600 uppercase tracking-widest">Acúmulo (Gargalo)</span>
              <span className="text-sm font-black font-mono text-amber-600">{diagnostic.indicators.stockpileRateTPH.toFixed(1)} t/h</span>
            </div>
          </div>
          <p className="text-[10px] font-bold text-amber-600 italic">O volume em pilha não representa produção real, apenas material aguardando processamento.</p>
        </div>
      </div>

      {/* Diagnostic & Recommendations Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Impacts Analysis */}
        <div className="bg-white p-10 rounded-[40px] border border-black/5 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-xl font-black tracking-tight uppercase">Análise de Impactos Operacionais</h3>
          </div>
          <div className="space-y-4">
            {diagnostic.impacts.map((impact, idx) => (
              <div key={idx} className="flex gap-4 p-5 bg-rose-50/30 rounded-3xl border border-rose-100/50 group hover:bg-rose-50 transition-colors">
                <div className="mt-1 text-rose-600 group-hover:scale-110 transition-transform">
                  <ChevronRight size={18} />
                </div>
                <p className="text-sm font-medium text-rose-900 leading-relaxed">{impact}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actionable Recommendations */}
        <div className="bg-white p-10 rounded-[40px] border border-black/5 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <Zap size={24} />
            </div>
            <h3 className="text-xl font-black tracking-tight uppercase">Recomendações Estratégicas</h3>
          </div>
          <div className="space-y-4">
            {diagnostic.recommendations.map((rec, idx) => (
              <div key={idx} className="flex gap-4 p-5 bg-emerald-50/30 rounded-3xl border border-emerald-100/50 group hover:bg-emerald-50 transition-colors">
                <div className="mt-1 text-emerald-600 group-hover:scale-110 transition-transform">
                  <CheckCircle2 size={18} />
                </div>
                <p className="text-sm font-medium text-emerald-900 leading-relaxed">{rec}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-8">
        {/* Fleet Feasibility & Suggestions */}
        <div className="bg-white rounded-[40px] p-10 border border-black/5 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h4 className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-500" /> Dimensionamento e Alocação de Frota
          </h4>
          {results.extraTrucks > 0 && (
            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full border border-blue-100">
              <Truck size={12} />
              <span className="text-[10px] font-bold uppercase tracking-widest">Frota Física Não Alocada: {results.extraTrucks}</span>
            </div>
          )}
        </div>
        {/* Key Simulation Highlights - Large Font as requested */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-8 rounded-3xl border border-black/5 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold text-black/40 uppercase tracking-widest mb-2">Máximo Possível (ROM)</span>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black text-emerald-600 tracking-tighter">
              {results.totalPossibleMonthlyMovement.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
            </span>
            <span className="text-xl font-bold text-emerald-600/40">t</span>
          </div>
          <p className="text-[10px] text-black/40 mt-2 uppercase tracking-widest">Produção Mensal Estimada</p>
        </div>
        
        <div className="bg-white p-8 rounded-3xl border border-black/5 shadow-sm flex flex-col items-center justify-center text-center">
          <span className="text-xs font-bold text-black/40 uppercase tracking-widest mb-2">Planta (Simulação)</span>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-black text-blue-600 tracking-tighter">
              {results.plannedMonthlyPlanta.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
            </span>
            <span className="text-xl font-bold text-blue-600/40">t</span>
          </div>
          <p className="text-[10px] text-black/40 mt-2 uppercase tracking-widest">Alimentação Mensal Planejada</p>
        </div>

        {premises.processType === 'umido' && (
          <div className="bg-white p-8 rounded-3xl border border-black/5 shadow-sm flex flex-col items-center justify-center text-center">
            <span className="text-xs font-bold text-black/40 uppercase tracking-widest mb-2">Rejeito (Simulação)</span>
            <div className="flex items-baseline gap-2">
              <span className="text-5xl font-black text-amber-600 tracking-tighter">
                {results.plannedMonthlyRejeito.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
              </span>
              <span className="text-xl font-bold text-amber-600/40">t</span>
            </div>
            <p className="text-[10px] text-black/40 mt-2 uppercase tracking-widest">Geração Mensal Estimada</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            {results.suggestions.map((suggestion: string, idx: number) => (
              <div 
                key={idx} 
                className={`p-4 rounded-2xl text-sm font-medium flex items-start gap-3 ${
                  suggestion.includes('FROTA INSUFICIENTE') || suggestion.includes('ALERTA')
                    ? 'bg-red-50 text-red-700 border border-red-100' 
                    : suggestion.includes('FROTA CAPAZ')
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : 'bg-blue-50 text-blue-700 border border-blue-100'
                }`}
              >
                <div className="mt-0.5">
                  {suggestion.includes('FROTA INSUFICIENTE') || suggestion.includes('ALERTA') ? (
                    <AlertTriangle size={16} />
                  ) : suggestion.includes('FROTA CAPAZ') ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-current opacity-20" />
                  )}
                </div>
                <p className="whitespace-pre-line">{suggestion}</p>
              </div>
            ))}
          </div>
          
          <div className="bg-[#F8F9FA] rounded-[32px] p-8 space-y-6 border border-black/5 shadow-sm">
            <h5 className="text-[10px] font-bold text-black/40 uppercase tracking-widest flex items-center gap-2">
              <Truck size={14} />
              Resumo da Frota
            </h5>
            <div className="space-y-4">
              <div className="flex justify-between items-center py-2 border-b border-black/5">
                <span className="text-sm text-black/60">Caminhões Disponíveis (Premissa)</span>
                <span className="text-lg font-mono font-black">{premises.truckCount}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-black/5">
                <span className="text-sm text-black/60">Caminhões Alocados (Fluxos)</span>
                <span className="text-lg font-mono font-black">{results.routeResults.reduce((acc: number, r: any) => acc + r.truckCount, 0)}</span>
              </div>
              <div className="flex justify-between items-center py-4 bg-blue-50/50 px-4 rounded-2xl border border-blue-100/50">
                <div className="flex flex-col">
                  <span className="text-xs text-blue-600 font-bold uppercase tracking-wider">Frota Física Não Alocada</span>
                  <span className="text-[10px] text-blue-600/40 italic">Equipamentos inteiros livres</span>
                </div>
                <span className="text-3xl font-mono font-black text-blue-700">{results.extraTrucks}</span>
              </div>
              <div className="flex justify-between items-center py-4 bg-amber-50/50 px-4 rounded-2xl border border-amber-100/50">
                <div className="flex flex-col">
                  <span className="text-xs text-amber-600 font-bold uppercase tracking-wider">Folga Teórica (Slack)</span>
                  <span className="text-[10px] text-amber-600/40 italic">Capacidade excedente (Meta vs Cap)</span>
                </div>
                <span className="text-3xl font-mono font-black text-amber-700">
                  {!isFinite(premises.truckCount - results.totalTrucksNeeded) 
                    ? "0.00" 
                    : (premises.truckCount - results.totalTrucksNeeded).toFixed(2)}
                </span>
              </div>
              
              <div className="pt-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-black/40 uppercase tracking-widest">Horas Efetivas Disponíveis</span>
                  <span className="text-sm font-mono font-bold">{results.effectiveHoursPerMonthMina.toFixed(1)}h</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-black/40 uppercase tracking-widest">Horas Efetivas Requeridas</span>
                  <span className="text-sm font-mono font-bold text-emerald-600">{results.totalEffectiveHoursNeeded.toFixed(1)}h</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-black/5 mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
              <Activity size={20} />
            </div>
            <h3 className="text-lg font-bold text-[#1A1A1A] tracking-tight">Resultado Simulação</h3>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportToHTML}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all"
            >
              <Download size={14} />
              Software Portátil (.html)
            </button>
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
              <RefreshCw size={14} />
              Limpar Simulação
            </button>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-black/5">
                <th className="py-4 px-4 text-[10px] font-bold text-black/40 uppercase tracking-widest">Indicador</th>
                <th className="py-4 px-4 text-[10px] font-bold text-blue-600 uppercase tracking-widest text-right">Movimentação Bruta (Mina)</th>
                <th className="py-4 px-4 text-[10px] font-bold text-emerald-600 uppercase tracking-widest text-right">Processamento Efetivo (Planta)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              <tr>
                <td className="py-6 px-4">
                  <p className="text-base font-bold text-black/80">Movimentação Total – Base Úmida (t)</p>
                  <p className="text-[10px] text-black/40 uppercase tracking-widest">Massa Total no Mês</p>
                </td>
                <td className="py-6 px-4 text-right font-mono font-black text-3xl text-blue-700">
                  {results.totalPossibleMonthlyMovement.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
                <td className="py-6 px-4 text-right font-mono font-black text-3xl text-emerald-700">
                  {results.simulationResults.totalWetMassNecessary.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
              </tr>
              <tr>
                <td className="py-6 px-4">
                  <p className="text-base font-bold text-black/80">Produção (t/h)</p>
                  <p className="text-[10px] text-black/40 uppercase tracking-widest">Produtividade Horária</p>
                </td>
                <td className="py-6 px-4 text-right font-mono font-black text-3xl text-blue-700">
                  {results.totalPossibleHourlyMovement.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
                <td className="py-6 px-4 text-right font-mono font-black text-3xl text-emerald-700">
                  {results.simulationResults.productionHourlyNecessary.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
              </tr>
              <tr>
                <td className="py-6 px-4">
                  <p className="text-base font-bold text-black/80">Produção (t/dia)</p>
                  <p className="text-[10px] text-black/40 uppercase tracking-widest">Produtividade Diária</p>
                </td>
                <td className="py-6 px-4 text-right font-mono font-black text-3xl text-blue-700">
                  {results.totalPossibleDailyMovement.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
                <td className="py-6 px-4 text-right font-mono font-black text-3xl text-emerald-700">
                  {results.simulationResults.productionDailyNecessary.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
              </tr>
              {results.allocatedExtraMonthlyProduction > 0 && (
                <tr className="bg-emerald-50/30">
                  <td className="py-4 px-4">
                    <p className="text-sm font-bold text-emerald-700">Produção via Alocação Extra (t/mês)</p>
                    <p className="text-[10px] text-emerald-600/60 uppercase tracking-widest">Frota Extra Alocada Temporariamente</p>
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-bold text-emerald-700">
                    {results.allocatedExtraMonthlyProduction.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-bold text-black/20">
                    -
                  </td>
                </tr>
              )}
              {results.hourlyStockpile > 0 && (
                <tr className="bg-amber-50/30">
                  <td className="py-4 px-4">
                    <p className="text-sm font-bold text-amber-700">Formação de Pilha Pulmão (t/mês)</p>
                    <p className="text-[10px] text-amber-600/60 uppercase tracking-widest">Excesso de Movimentação vs Planta</p>
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-bold text-amber-700">
                    {results.monthlyStockpile.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="py-4 px-4 text-right font-mono font-bold text-black/20">
                    -
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Interpretive Note */}
        <div className="mt-8 p-6 bg-blue-50/50 rounded-3xl border border-blue-100">
          <div className="flex gap-4">
            <div className="p-2 bg-blue-100 text-blue-600 rounded-xl h-fit">
              <Info size={20} />
            </div>
            <div>
              <h4 className="text-xs font-black uppercase tracking-widest text-blue-900 mb-2">Nota Interpretativa: Possível vs. Necessária</h4>
              <div className="space-y-3 text-[11px] text-blue-800/80 leading-relaxed font-medium">
                <p>
                  <strong className="text-blue-900">Movimentação Bruta (Mina):</strong> Representa o teto máximo de transporte que sua frota atual consegue entregar (até 580 t/h aparente).
                </p>
                <p>
                  <strong className="text-blue-900">Processamento Efetivo (Planta):</strong> Representa o volume que a planta consegue absorver (limitado a 310 t/h). O excedente é direcionado para a Pilha Pulmão.
                </p>
                <div className="pt-2 border-t border-blue-200/50">
                  <p className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span>Se <strong className="text-blue-900">Necessária &gt; Possível</strong>: A operação é fisicamente inviável com a frota atual. É necessário aumentar o número de caminhões ou reduzir a meta.</span>
                  </p>
                  <p className="flex items-center gap-2 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <span>Se <strong className="text-blue-900">Possível &gt; Necessária</strong>: Existe folga operacional. A frota é superior à demanda, permitindo absorver imprevistos ou aumentar a produção se a planta permitir.</span>
                  </p>
                </div>
                <p className="mt-4 text-[10px] italic text-blue-600/60">
                  * Nota: Se você aumentou a frota mas a coluna "Possível" ainda é menor que a "Necessária", verifique se o tempo de ciclo ou a disponibilidade mecânica estão limitando a produtividade unitária.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <TrendingUp size={24} />
            </div>
            {results.isTargetUnreachable ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 uppercase tracking-widest bg-red-50 px-2 py-1 rounded-full">
                <AlertTriangle size={10} /> Inalcançável
              </span>
            ) : results.isTargetAtRisk ? (
              <span className="flex items-center gap-1 text-[10px] font-bold text-orange-500 uppercase tracking-widest bg-orange-50 px-2 py-1 rounded-full">
                <AlertTriangle size={10} /> Risco
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 uppercase tracking-widest bg-emerald-50 px-2 py-1 rounded-full">
                <CheckCircle2 size={10} /> OK
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Produção ROM Total</p>
          <h4 className="text-2xl font-mono font-bold text-[#1A1A1A]">
            {results.simulatedMonthlyROM.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
            <span className="text-sm font-normal ml-1 opacity-40">t/mês</span>
          </h4>
          <div className="mt-4 pt-4 border-t border-black/5 grid grid-cols-3 gap-4">
            <div>
              <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">ROM</p>
              <p className="text-xs font-mono font-bold text-emerald-600">{results.simulatedDailyROM.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t/d</p>
            </div>
            <div>
              <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">Planta</p>
              <p className="text-xs font-mono font-bold text-blue-600">{results.simulatedDailyPlanta.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t/d</p>
            </div>
            {premises.processType === 'umido' && (
              <div>
                <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">Rejeito</p>
                <p className="text-xs font-mono font-bold text-red-600">{results.simulatedDailyRejeito.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t/d</p>
              </div>
            )}
          </div>
          <div className="mt-2 text-center">
            <p className="text-[8px] font-bold text-black/40 uppercase tracking-widest">Movimentação Total</p>
            <p className="text-sm font-mono font-bold text-black">{results.simulatedDailyTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} t/dia</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Activity size={24} />
            </div>
          </div>
          <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Dias Efetivos (Mina)</p>
          <h4 className="text-2xl font-mono font-bold text-[#1A1A1A]">
            {results.effectiveCalendarDaysMina.toFixed(2)}
            <span className="text-sm font-normal ml-1 opacity-40">dias/mês</span>
          </h4>
          <p className="text-[10px] font-medium text-black/40 mt-2">
            Total: {results.effectiveHoursPerMonthMina.toFixed(0)}h efetivas
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-2xl">
              <Zap size={24} />
            </div>
          </div>
          <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Status da Planta</p>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${results.plantUtilization > 100 ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
            <h4 className={`text-xl font-bold ${results.plantUtilization > 100 ? 'text-red-600' : 'text-emerald-600'}`}>
              {results.plantUtilization > 100 ? 'Gargalo' : 'Ocioso'}
            </h4>
          </div>
          <p className="text-[10px] font-medium text-black/40 mt-2">
            Utilização: {(results.plantUtilization || 0).toFixed(1)}%
          </p>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
              <Truck size={24} />
            </div>
            {results.isFleetOverloaded && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 uppercase tracking-widest bg-red-50 px-2 py-1 rounded-full">
                Déficit
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Status da Frota (Mina)</p>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${results.isFleetOverloaded ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
            <h4 className={`text-xl font-bold ${results.isFleetOverloaded ? 'text-red-600' : 'text-emerald-600'}`}>
              {results.isFleetOverloaded ? 'Sobrecarga' : 'Capacidade OK'}
            </h4>
          </div>
          <p className="text-[10px] font-medium text-black/40 mt-2">
            Caminhões: {results.routeResults.reduce((acc: number, r: any) => acc + r.truckCount, 0)} / {premises.truckCount}
          </p>
          <p className="text-[10px] font-medium text-black/40">
            Utilização: {(results.fleetUtilization || 0).toFixed(1)}%
          </p>
          <div className="mt-3 space-y-2">
            <div className="flex justify-between items-center text-[8px] font-bold uppercase tracking-widest text-black/40">
              <span>Mina</span>
              <span>{results.totalHourlyROM.toFixed(1)} / {results.maxFleetCapacityMinaTPH.toFixed(0)} t/h</span>
            </div>
            <div className="w-full bg-black/5 h-1 rounded-full overflow-hidden">
              <div className={`h-full ${results.totalHourlyROM > results.maxFleetCapacityMinaTPH ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${Math.min((results.totalHourlyROM / results.maxFleetCapacityMinaTPH) * 100, 100)}%` }} />
            </div>
            
            <div className="flex justify-between items-center text-[8px] font-bold uppercase tracking-widest text-black/40">
              <span>Terminal</span>
              <span>{(results.totalHourlyROM * (premises.rmGlobal/100)).toFixed(1)} / {results.maxFleetCapacityTerminalTPH.toFixed(0)} t/h</span>
            </div>
            <div className="w-full bg-black/5 h-1 rounded-full overflow-hidden">
              <div className={`h-full ${(results.totalHourlyROM * (premises.rmGlobal/100)) > results.maxFleetCapacityTerminalTPH ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(((results.totalHourlyROM * (premises.rmGlobal/100)) / results.maxFleetCapacityTerminalTPH) * 100, 100)}%` }} />
            </div>

            {premises.processType === 'umido' && (
              <>
                <div className="flex justify-between items-center text-[8px] font-bold uppercase tracking-widest text-black/40">
                  <span>Baia</span>
                  <span>{(results.totalHourlyROM * (premises.rejeitoTotal/100)).toFixed(1)} / {results.maxFleetCapacityBaiaTPH.toFixed(0)} t/h</span>
                </div>
                <div className="w-full bg-black/5 h-1 rounded-full overflow-hidden">
                  <div className={`h-full ${(results.totalHourlyROM * (premises.rejeitoTotal/100)) > results.maxFleetCapacityBaiaTPH ? 'bg-red-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(((results.totalHourlyROM * (premises.rejeitoTotal/100)) / results.maxFleetCapacityBaiaTPH) * 100, 100)}%` }} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mass Balance Indicator */}
        <div className="mt-12 pt-8 border-t border-black/5 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
              <Scale size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-black/40">Balanço de Massa</p>
              <p className="text-sm font-bold text-black/80">Entrada (Mina) = Saída (Destinos)</p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="text-center">
              <p className="text-[8px] font-black uppercase tracking-widest text-black/40 mb-1">Total Antes Planta</p>
              <p className="text-lg font-mono font-black text-blue-600">{results.totalHourlyROM.toFixed(0)} t/h</p>
            </div>
            <div className="w-px h-8 bg-black/10" />
            <div className="text-center">
              <p className="text-[8px] font-black uppercase tracking-widest text-black/40 mb-1">Total Depois Planta</p>
              <p className="text-lg font-mono font-black text-emerald-600">
                {(results.totalHourlyROM * (premises.rmGlobal/100) + (premises.processType === 'umido' ? results.totalHourlyROM * (premises.rejeitoTotal/100) : 0)).toFixed(0)} t/h
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Scenario Simulation Section */}
      {onPremiseChange && (
        <div className="bg-[#151619] text-white p-10 rounded-[40px] shadow-2xl border border-white/5">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-emerald-500 rounded-2xl">
                <RefreshCw size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-xl font-black tracking-tight uppercase">Simulação de Cenários Rápidos</h3>
                <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Ajuste as variáveis e veja o impacto em tempo real</p>
              </div>
            </div>
            <button 
              onClick={handleResetSimulation}
              className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/10"
            >
              Resetar Simulação
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {/* Target ROM Slider */}
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Meta Mensal (t)</label>
                <span className="text-xl font-mono font-black text-emerald-400">{premises.targetMonthlyROM.toLocaleString('pt-BR')}</span>
              </div>
              <input 
                type="range" 
                min={50000} 
                max={1000000} 
                step={10000}
                value={premises.targetMonthlyROM}
                onChange={(e) => {
                  const newTarget = Number(e.target.value);
                  const newFleet = autoCalculateFleet(newTarget, premises.plantFeedRateTPH);
                  onPremiseChange({ 
                    ...premises, 
                    targetMonthlyROM: newTarget,
                    truckCount: newFleet
                  });
                }}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex justify-between text-[8px] font-bold text-white/20 uppercase tracking-widest">
                <span>50k</span>
                <span>1M</span>
              </div>
            </div>

            {/* Plant Capacity Slider */}
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Capacidade Planta (t/h)</label>
                <span className="text-xl font-mono font-black text-blue-400">{premises.plantFeedRateTPH}</span>
              </div>
              <input 
                type="range" 
                min={100} 
                max={1000} 
                step={10}
                value={premises.plantFeedRateTPH}
                onChange={(e) => {
                  const newRate = Number(e.target.value);
                  const newFleet = autoCalculateFleet(premises.targetMonthlyROM, newRate);
                  onPremiseChange({ 
                    ...premises, 
                    plantFeedRateTPH: newRate,
                    truckCount: newFleet
                  });
                }}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
              />
              <div className="flex justify-between text-[8px] font-bold text-white/20 uppercase tracking-widest">
                <span>100 t/h</span>
                <span>1000 t/h</span>
              </div>
            </div>

            {/* Fleet Size Slider */}
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Frota (Caminhões)</label>
                <span className="text-xl font-mono font-black text-amber-400">{premises.truckCount}</span>
              </div>
              <input 
                type="range" 
                min={1} 
                max={100} 
                step={1}
                value={premises.truckCount}
                onChange={(e) => onPremiseChange({ ...premises, truckCount: Number(e.target.value) })}
                className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[8px] font-bold text-white/20 uppercase tracking-widest">
                <span>1 un</span>
                <span>100 un</span>
              </div>
              <p className="text-[8px] text-white/20 italic">
                * A frota é recalculada automaticamente ao alterar a meta ou planta, mas você pode ajustar manualmente.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <TrendingUp size={20} className="text-emerald-500" />
              Evolução Semanal
            </h3>
          </div>
          <div className="h-[300px]">
            <Line data={lineData} options={chartOptions} />
          </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-black/5">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-lg font-bold flex items-center gap-2">
              <Truck size={20} className="text-blue-500" />
              Produção por Rota
            </h3>
          </div>
          <div className="h-[300px]">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default Dashboard;
