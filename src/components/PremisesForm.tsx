import React, { useMemo } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download } from "lucide-react";
import { DetailedPremises, Route } from "../types";

interface PremisesFormProps {
  premises: DetailedPremises;
  setPremises: (premises: DetailedPremises | ((prev: DetailedPremises) => DetailedPremises)) => void;
  setRoutes: (routes: Route[] | ((prev: Route[]) => Route[])) => void;
  results: any;
}

const months = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const years = [2024, 2025, 2026, 2027, 2028];

const PremisesForm: React.FC<PremisesFormProps> = ({ premises, setPremises, setRoutes, results }) => {
  // Initialize fleet capacities if they are zero (e.g. on first load or after reset)
  React.useEffect(() => {
    if (premises.fleetCapacityMinaTPH === 0 && premises.plantFeedRateTPH > 0) {
      const mina = premises.plantFeedRateTPH;
      const terminal = premises.plantFeedRateTPH * (premises.rmGlobal / 100);
      const baia = premises.plantFeedRateTPH * (premises.rejeitoTotal / 100);
      const total = mina + terminal + baia;
      
      setPremises(prev => ({
        ...prev,
        fleetCapacityMinaTPH: mina,
        fleetCapacityTerminalTPH: terminal,
        fleetCapacityBaiaTPH: baia,
        maxTotalFleetCapacityTPH: total
      }));
    }
  }, []);

  const handleChange = (field: keyof DetailedPremises, value: any) => {
    const newPremises = { ...premises, [field]: value };

    // Automatically calculate fleet capacities based on Plant Capacity
    if (field === "plantFeedRateTPH" || field === "rmGlobal" || field === "rejeitoTotal" || field === "processType" || field === "dfMina" || field === "ufMina" || field === "dfPlanta" || field === "ufPlanta") {
      const currentRM = field === "processType" && value === "seco" ? 100 : (field === "rmGlobal" ? value : newPremises.rmGlobal);
      const currentRejeito = field === "processType" && value === "seco" ? 0 : (field === "rejeitoTotal" ? value : newPremises.rejeitoTotal);
      
      newPremises.fleetCapacityMinaTPH = newPremises.plantFeedRateTPH;
      newPremises.fleetCapacityTerminalTPH = newPremises.plantFeedRateTPH * (currentRM / 100);
      newPremises.fleetCapacityBaiaTPH = newPremises.plantFeedRateTPH * (currentRejeito / 100);
      newPremises.maxTotalFleetCapacityTPH = newPremises.fleetCapacityMinaTPH + newPremises.fleetCapacityTerminalTPH + newPremises.fleetCapacityBaiaTPH;

      // Calculate EO as DF * UF
      newPremises.eoMina = (newPremises.dfMina / 100) * (newPremises.ufMina / 100) * 100;
      newPremises.eoPlanta = (newPremises.dfPlanta / 100) * (newPremises.ufPlanta / 100) * 100;
    }

    // Update daily calendar when contracted hours change
    if (field === "contractedHoursMina") {
      newPremises.dailyCalendar = newPremises.dailyCalendar.map(day => ({
        ...day,
        hoursMina: value
      }));
    }
    if (field === "contractedHoursPlanta") {
      newPremises.dailyCalendar = newPremises.dailyCalendar.map(day => ({
        ...day,
        hoursPlanta: value
      }));
    }

    // Automatically update all routes' truck capacity if the global truck capacity changes
    if (field === "truckCapacity") {
      // rotas sem valores próprios seguem a premissa (fonte única)
      setRoutes(prevRoutes => prevRoutes.map(route => (route.ownRates ? route : { ...route, truckCapacity: value })));
    }

    // Automatically deactivate and clear Rejeito routes if process type changes to 'seco'
    if (field === "processType") {
      setRoutes(prevRoutes => prevRoutes.map(route => {
        const name = route.name.toLowerCase();
        const isRejeito = name.includes('baia') || name.includes('rejeito');
        
        if (value === "seco" && isRejeito) {
          return { ...route, active: false, truckCount: 0, processType: value as 'umido' | 'seco' };
        }
        return { ...route, processType: value as 'umido' | 'seco' };
      }));
    }

    setPremises(newPremises);
  };

  const handleMonthYearChange = (month: number, year: number) => {
    const start = startOfMonth(new Date(year, month));
    const end = endOfMonth(start);
    const days = eachDayOfInterval({ start, end });
    
    const dailyCalendar = days.map(day => ({
      date: day.toISOString(),
      hoursMina: premises.contractedHoursMina,
      hoursPlanta: premises.contractedHoursPlanta,
    }));

    setPremises({ 
      ...premises, 
      month, 
      year, 
      calendarDays: days.length,
      dailyCalendar 
    });
  };

  const handleDailyHourChange = (index: number, field: "hoursMina" | "hoursPlanta", value: number) => {
    const newDailyCalendar = [...premises.dailyCalendar];
    newDailyCalendar[index] = { ...newDailyCalendar[index], [field]: value };
    setPremises({ ...premises, dailyCalendar: newDailyCalendar });
  };

  const handleDailyMaintenanceToggle = (index: number, field: "isMaintenanceMina" | "isMaintenancePlanta") => {
    const newDailyCalendar = [...premises.dailyCalendar];
    newDailyCalendar[index] = { 
      ...newDailyCalendar[index], 
      [field]: !newDailyCalendar[index][field],
    };
    setPremises({ ...premises, dailyCalendar: newDailyCalendar });
  };

  const exportToCSV = () => {
    const headers = ["Premissa", "Valor"];
    const rows = [
      ["Mês", months[premises.month]],
      ["Ano", premises.year],
      ["Consumo Planta (t/mês)", premises.targetMonthlyROM],
      ["Jornada Contratada Mina (h/dia)", premises.contractedHoursMina],
      ["Jornada Contratada Planta (h/dia)", premises.contractedHoursPlanta],
      ["DF Mina (%)", premises.dfMina],
      ["UF Mina (%)", premises.ufMina],
      ["EO Mina (%)", premises.eoMina],
      ["Capacidade Frota Mina (t/h)", premises.fleetCapacityMinaTPH],
      ["DF Planta (%)", premises.dfPlanta],
      ["UF Planta (%)", premises.ufPlanta],
      ["EO Planta (%)", premises.eoPlanta],
      ["Capacidade Máxima Planta (t/h)", premises.plantFeedRateTPH],
      ["RM Global (%)", premises.rmGlobal],
      ["Rejeito Total (%)", premises.rejeitoTotal],
      ["Umidade Natural (%)", premises.umidadeNatural],
      ["Perda Material (%)", premises.perdaMaterial],
      ["Número de Caminhões", premises.truckCount],
      ["Capacidade Caminhão (t)", premises.truckCapacity],
      ["Meta Estéril (t/mês)", premises.targetMonthlyWasteRock],
      ["Carregamento (min)", premises.loadingTime],
      ["Basculamento (min)", premises.dumpingTime],
      ["Pesagem Carregado (min)", premises.weighingTimeLoaded],
      ["Pesagem Vazio (min)", premises.weighingTimeEmpty],
      ["", ""],
      ["Calendário Mina", ""],
      ["Data", "Horas", "Parada"],
      ...premises.dailyCalendar.map(d => [format(parseISO(d.date), "dd/MM/yyyy"), d.hoursMina, d.isMaintenanceMina ? "Sim" : "Não"]),
      ["", ""],
      ["Calendário Planta", ""],
      ["Data", "Horas", "Parada"],
      ...premises.dailyCalendar.map(d => [format(parseISO(d.date), "dd/MM/yyyy"), d.hoursPlanta, d.isMaintenancePlanta ? "Sim" : "Não"])
    ];

    const csvContent = "\uFEFF" + rows.map(r => r.join(";")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `premissas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const stats = useMemo(() => {
    const horasCalendarioMina = premises.dailyCalendar.reduce((acc, curr) => acc + curr.hoursMina, 0);
    const horasCalendarioPlanta = premises.dailyCalendar.reduce((acc, curr) => acc + curr.hoursPlanta, 0);
    
    return {
      horasCalendarioMina,
      horasCalendarioPlanta,
      horasEfetivasMina: results.effectiveHoursPerMonthMina,
      horasEfetivasPlanta: results.effectiveHoursPerMonthPlanta,
      diasTrabalhoMina: results.effectiveCalendarDaysMina,
      diasTrabalhoPlanta: results.effectiveCalendarDaysPlanta,
      jornadaEfetivaMina: results.jornadaEfetivaMina,
      jornadaEfetivaPlanta: results.jornadaEfetivaPlanta
    };
  }, [premises, results]);

  const sections = [
    {
      title: "Período de Simulação",
      fields: [
        { label: "Mês", key: "month", type: "select", options: months.map((m, i) => ({ label: m, value: i })) },
        { label: "Ano", key: "year", type: "select", options: years.map(y => ({ label: y.toString(), value: y })) },
        { label: "Consumo Planta (t/mês)", key: "targetMonthlyROM" },
        { label: "Jornada Contratada Mina (h/dia)", key: "contractedHoursMina" },
        { label: "Jornada Contratada Planta (h/dia)", key: "contractedHoursPlanta" },
      ]
    },
    {
      title: "Mina",
      fields: [
        { label: "DF Equipamentos (%)", key: "dfMina" },
        { label: "UF Equipamentos (%)", key: "ufMina" },
        { label: "Rendimento DF × UF (%)", key: "eoMina", readOnly: true },
        { label: "Capacidade Frota Mina (t/h)", key: "fleetCapacityMinaTPH", readOnly: true },
      ]
    },
    {
      title: "Planta & Limite de Processamento",
      fields: [
        { label: "DF Equipamentos (%)", key: "dfPlanta" },
        { label: "UF Equipamentos (%)", key: "ufPlanta" },
        { label: "Rendimento DF × UF (%)", key: "eoPlanta", readOnly: true },
        { label: "Capacidade Máxima Planta (t/h)", key: "plantFeedRateTPH", highlight: true },
      ]
    },
    {
      title: "Processo",
      fields: [
        { 
          label: "Tipo de Processo", 
          key: "processType", 
          type: "select", 
          options: [
            { label: "A Úmido (Com Rejeito)", value: "umido" },
            { label: "A Seco (Sem Rejeito)", value: "seco" }
          ] 
        },
        { label: "RM Global (%)", key: "rmGlobal", disabled: premises.processType === 'seco' },
        { label: "Rejeito Total (%)", key: "rejeitoTotal", disabled: premises.processType === 'seco' },
        { label: "Umidade Natural (%)", key: "umidadeNatural" },
        { label: "Perda Material (%)", key: "perdaMaterial" },
        {
          label: "Conversão seca → úmida",
          key: "moistureMode",
          type: "select",
          options: [
            { label: "Seca × (1 + umidade + perda)", value: "somada" },
            { label: "Seca ÷ (1 − umidade) × (1 + perda)", value: "base_umida" },
          ],
        },
        { label: "Possui Estéril?", key: "hasWasteRock", type: "select", options: [{ label: "Sim", value: true }, { label: "Não", value: false }] },
        { label: "Meta Estéril (t/mês)", key: "targetMonthlyWasteRock", disabled: !premises.hasWasteRock },
      ]
    },
    {
      title: "Transporte / Frota",
      fields: [
        { label: "Velocidade Vazio (km/h)", key: "velocidadeVazio" },
        { label: "Velocidade Cheio (km/h)", key: "velocidadeCheio" },
        { label: "Capacidade Caminhão (t)", key: "truckCapacity" },
        { label: "Número de Caminhões", key: "truckCount" },
        { label: "Frota Baia (t/h)", key: "fleetCapacityBaiaTPH", readOnly: true },
        { label: "Frota Terminal (t/h)", key: "fleetCapacityTerminalTPH", readOnly: true },
        { label: "Capacidade Total Frota (t/h)", key: "maxTotalFleetCapacityTPH", readOnly: true },
      ]
    },
    {
      title: "Tempos de Ciclo (min)",
      fields: [
        { label: "Carregamento (min)", key: "loadingTime" },
        { label: "Basculamento/Manobra (min)", key: "dumpingTime" },
        { label: "Pesagem Carregado (min)", key: "weighingTimeLoaded" },
        { label: "Pesagem Vazio (min)", key: "weighingTimeEmpty" },
      ]
    }
  ];

  return (
    <div className="space-y-8 pb-20">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-black/80">Premissas Fundamentais</h2>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-2 bg-white text-black/60 border border-black/5 px-6 py-2.5 rounded-xl font-bold transition-all hover:bg-black/[0.02]"
        >
          <Download size={18} />
          Exportar Excel
        </button>
      </div>
      {/* Header Stats */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Horas Calendário (Mina)</p>
            <p className="text-xl font-mono font-bold text-blue-600">{stats.horasCalendarioMina.toFixed(2)}h</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Horas Efetivas (Mina)</p>
            <p className="text-xl font-mono font-bold text-emerald-600">{stats.horasEfetivasMina.toFixed(2)}h</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Dias Trabalho (Mina)</p>
            <p className="text-xl font-mono font-bold text-purple-600">{stats.diasTrabalhoMina.toFixed(2)}d</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Jornada Efetiva (Mina)</p>
            <p className="text-xl font-mono font-bold text-orange-600">{stats.jornadaEfetivaMina.toFixed(2)}h/d</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Horas Calendário (Planta)</p>
            <p className="text-xl font-mono font-bold text-blue-600">{stats.horasCalendarioPlanta.toFixed(2)}h</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Horas Efetivas (Planta)</p>
            <p className="text-xl font-mono font-bold text-emerald-600">{stats.horasEfetivasPlanta.toFixed(2)}h</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Dias Trabalho (Planta)</p>
            <p className="text-xl font-mono font-bold text-purple-600">{stats.diasTrabalhoPlanta.toFixed(2)}d</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Jornada Efetiva (Planta)</p>
            <p className="text-xl font-mono font-bold text-orange-600">{stats.jornadaEfetivaPlanta.toFixed(2)}h/d</p>
          </div>
        </div>
      </div>

      {/* Planned Production Summary */}
      <div className="bg-[#151619] p-8 rounded-3xl shadow-xl text-white">
        <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-6">Produção Planejada Detalhada</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Taxa Horária (t/h)</h4>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">ROM</span>
              <span className="font-mono font-bold">{results.plannedHourlyROM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">Planta</span>
              <span className="font-mono font-bold">{results.plannedHourlyPlanta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">Rejeito</span>
              <span className="font-mono font-bold">{results.plannedHourlyRejeito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5 text-emerald-400">
              <span className="text-xs font-bold">Total Frota</span>
              <span className="font-mono font-bold">{results.plannedHourlyTotalFrota.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Produção Diária (t/dia)</h4>
            <div className="flex justify-between items-center py-2 border-b border-white/5 text-emerald-400">
              <span className="text-xs font-bold">Mina (ROM)</span>
              <span className="font-mono font-bold">{results.plannedDailyROM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">Planta</span>
              <span className="font-mono font-bold">{results.plannedDailyPlanta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">Rejeito</span>
              <span className="font-mono font-bold">{results.plannedDailyRejeito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40">Produção Mensal (t/mês)</h4>
            <div className="flex justify-between items-center py-2 border-b border-white/5 text-emerald-400">
              <span className="text-xs font-bold">Mina (ROM)</span>
              <span className="font-mono font-bold">{results.plannedMonthlyROM.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">Planta</span>
              <span className="font-mono font-bold">{results.plannedMonthlyPlanta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-white/60">Rejeito Filtrado</span>
              <span className="font-mono font-bold">{results.plannedMonthlyRejeito.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sections.map((section) => (
          <div key={section.title} className="bg-white p-6 rounded-2xl shadow-sm border border-black/5">
            <h3 className="text-sm font-bold uppercase tracking-widest text-black/40 mb-4">{section.title}</h3>
            <div className="space-y-4">
              {section.fields.map((field: any) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-black/60 mb-1.5">
                    {field.label}
                    {field.highlight && <span className="ml-2 text-[10px] text-red-500 font-bold uppercase tracking-tighter">Fator Limitante</span>}
                  </label>
                  {field.type === "select" ? (
                    <select
                      value={String(premises[field.key as keyof DetailedPremises] ?? (field.key === "moistureMode" ? "somada" : ""))}
                      onChange={(e) => {
                        const val =
                          field.key === "processType" || field.key === "moistureMode"
                            ? e.target.value
                            : field.key === "hasWasteRock"
                              ? e.target.value === "true"
                              : parseInt(e.target.value);
                        if (field.key === "month") handleMonthYearChange(val as number, premises.year);
                        else if (field.key === "year") handleMonthYearChange(premises.month, val as number);
                        else handleChange(field.key as keyof DetailedPremises, val);
                      }}
                      className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    >
                      {field.options.map((opt: any) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : field.readOnly ? (
                    <div className="w-full bg-black/5 border border-black/5 rounded-xl px-4 py-2.5 text-sm font-mono text-black/40">
                      {(premises[field.key as keyof DetailedPremises] as number)?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || "0,00"}
                    </div>
                  ) : (
                    <input
                      type="number"
                      disabled={field.disabled}
                      value={premises[field.key as keyof DetailedPremises] as number}
                      onChange={(e) => handleChange(field.key as keyof DetailedPremises, parseFloat(e.target.value) || 0)}
                      className={`w-full border border-black/5 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all ${field.highlight ? 'bg-red-50/50 border-red-100 font-bold text-red-600' : 'bg-[#F8F9FA]'} ${field.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Operational Calendar Table */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5">
        <h3 className="text-sm font-bold uppercase tracking-widest text-black/40 mb-6">Calendário Operacional & Paradas Programadas</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Mina Calendar */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-4">Calendário - Mina</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/5">
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40">Dia</th>
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40">Semana</th>
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Parada</th>
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40 text-right">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {premises.dailyCalendar.map((day, idx) => {
                    const date = parseISO(day.date);
                    return (
                      <tr key={idx} className={`border-b border-black/5 hover:bg-black/[0.02] ${day.isMaintenanceMina ? 'bg-orange-50/30' : ''}`}>
                        <td className="py-2 text-xs font-mono">{format(date, "dd-MMM", { locale: ptBR })}</td>
                        <td className="py-2 text-xs text-black/60 capitalize">{format(date, "EEEE", { locale: ptBR })}</td>
                        <td className="py-2 text-center">
                          <input 
                            type="checkbox"
                            checked={!!day.isMaintenanceMina}
                            onChange={() => handleDailyMaintenanceToggle(idx, "isMaintenanceMina")}
                            className="rounded border-black/10 text-orange-500 focus:ring-orange-500/20"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <input 
                            type="number"
                            min="0"
                            max="24"
                            step="0.5"
                            value={day.hoursMina}
                            onChange={(e) => handleDailyHourChange(idx, "hoursMina", parseFloat(e.target.value) || 0)}
                            className="w-16 bg-[#F8F9FA] border border-black/5 rounded-lg px-2 py-1 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50/50 font-bold">
                    <td colSpan={2} className="py-2 px-2 text-[10px] uppercase tracking-widest text-blue-600">Soma Horas</td>
                    <td className="py-2 text-right px-2 text-xs font-mono text-blue-600">{stats.horasCalendarioMina.toFixed(2)}h</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Planta Calendar */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-4">Calendário - Planta</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-black/5">
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40">Dia</th>
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40">Semana</th>
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40 text-center">Parada</th>
                    <th className="py-2 text-[10px] font-bold uppercase tracking-widest text-black/40 text-right">Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {premises.dailyCalendar.map((day, idx) => {
                    const date = parseISO(day.date);
                    return (
                      <tr key={idx} className={`border-b border-black/5 hover:bg-black/[0.02] ${day.isMaintenancePlanta ? 'bg-orange-50/30' : ''}`}>
                        <td className="py-2 text-xs font-mono">{format(date, "dd-MMM", { locale: ptBR })}</td>
                        <td className="py-2 text-xs text-black/60 capitalize">{format(date, "EEEE", { locale: ptBR })}</td>
                        <td className="py-2 text-center">
                          <input 
                            type="checkbox"
                            checked={!!day.isMaintenancePlanta}
                            onChange={() => handleDailyMaintenanceToggle(idx, "isMaintenancePlanta")}
                            className="rounded border-black/10 text-orange-500 focus:ring-orange-500/20"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <input 
                            type="number"
                            min="0"
                            max="24"
                            step="0.5"
                            value={day.hoursPlanta}
                            onChange={(e) => handleDailyHourChange(idx, "hoursPlanta", parseFloat(e.target.value) || 0)}
                            className="w-16 bg-[#F8F9FA] border border-black/5 rounded-lg px-2 py-1 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-emerald-50/50 font-bold">
                    <td colSpan={2} className="py-2 px-2 text-[10px] uppercase tracking-widest text-emerald-600">Soma Horas</td>
                    <td className="py-2 text-right px-2 text-xs font-mono text-emerald-600">{stats.horasCalendarioPlanta.toFixed(2)}h</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PremisesForm;
