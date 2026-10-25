import CatalogEditor from './CatalogEditor';
import NetworkEditor from './NetworkEditor';
import FlowDiagram from './FlowDiagram';
import { LoaderNeedsTable, LoaderTimesEditor } from './LoaderSetupEditor';
import FleetTypesEditor from './FleetTypesEditor';
import { processPct } from '@/engine/process';
import React, { useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Download } from "lucide-react";
import { DetailedPremises, Route } from "../types";
import { catalogOf } from "@/engine/fleet";
import { DEFAULT_LOSSES, fixedLossMinPerDay, lossesOf, ufFromLosses } from "@/engine/losses";

interface PremisesFormProps {
  premises: DetailedPremises;
  setPremises: (premises: DetailedPremises | ((prev: DetailedPremises) => DetailedPremises)) => void;
  setRoutes: (routes: Route[] | ((prev: Route[]) => Route[])) => void;
  results: any;
  /** rotas = movimentações da rede de fluxos */
  routes?: Route[];
}

const months = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const years = [2024, 2025, 2026, 2027, 2028];
const fmt2 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt3 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 4 });

const STEPS = [
  { id: 0, label: 'Todas', hint: '' },
  { id: 1, label: 'Período e calendário', hint: 'Mês, consumo da planta, jornadas, DF e UF, e as paradas programadas do calendário da mina e da planta.' },
  { id: 2, label: 'Processo e massas', hint: 'Tipo de processo, RM, rejeito, umidade e estéril. A produção planejada mostra as massas que saem destas entradas.' },
  { id: 3, label: 'Locais e movimentações', hint: 'Frentes, plantas, estoques, expedição, baias e pilhas, e as movimentações entre eles (cada uma é uma rota e consome frota).' },
  { id: 4, label: 'Frota e catálogo', hint: 'Caminhão das premissas ou frota mista por tipo, velocidades, e o catálogo de modelos com custos e vida útil.' },
  { id: 5, label: 'Carga e ciclo', hint: 'Tempos do ciclo. O equipamento de carga de cada local fica em Locais e movimentações.' },
  { id: 6, label: 'Perdas', hint: 'Troca de turno, refeição, abastecimento e interferências: definem a UF e entram em cada ciclo.' },
];

const PremisesForm: React.FC<PremisesFormProps> = ({ premises, setPremises, setRoutes, results, routes }) => {
  const handleChange = (field: keyof DetailedPremises, value: any) => {
    const newPremises = { ...premises, [field]: value };

    // Automatically calculate fleet capacities based on Plant Capacity
    // a úmido: ao mudar a RM, o rejeito vira 100 − RM (editável depois; a diferença aparece como perda de processo)
    if (field === "rmGlobal" && newPremises.processType !== "seco") {
      newPremises.rejeitoTotal = Math.max(0, Math.round((100 - Number(value || 0)) * 100) / 100);
    }
    if (field === "plantFeedRateTPH" || field === "rmGlobal" || field === "rejeitoTotal" || field === "processType" || field === "dfMina" || field === "ufMina" || field === "dfPlanta" || field === "ufPlanta") {
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

    // classe do caminhão: preenche capacidade e volume da caçamba
    if (field === "truckClassId") {
      const t = catalogOf(premises).trucks.find((x) => x.id === value);
      if (t) {
        newPremises.truckCapacity = t.payloadT;
        newPremises.truckVolumeM3 = t.volumeM3;
        setRoutes(prevRoutes => prevRoutes.map(route => (route.ownRates ? route : { ...route, truckCapacity: t.payloadT })));
      } else newPremises.truckClassId = undefined;
    }
    // capacidade ou volume digitados à mão deixam de seguir a classe
    if ((field === "truckCapacity" || field === "truckVolumeM3") && premises.truckClassId) {
      const t = catalogOf(premises).trucks.find((x) => x.id === premises.truckClassId);
      if (t && (newPremises.truckCapacity !== t.payloadT || newPremises.truckVolumeM3 !== t.volumeM3)) newPremises.truckClassId = undefined;
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

    // perdas detalhadas ligadas: a UF da mina é calculada pelas paradas fixas
    if (newPremises.losses?.enabled) {
      newPremises.ufMina = Math.round(ufFromLosses(newPremises) * 10) / 10;
      newPremises.eoMina = (newPremises.dfMina / 100) * (newPremises.ufMina / 100) * 100;
    }
    setPremises(newPremises);
  };

  const setLosses = (patch: Partial<NonNullable<DetailedPremises["losses"]>>) => {
    const losses = { ...lossesOf(premises), ...patch };
    const next: DetailedPremises = { ...premises, losses };
    if (losses.enabled) {
      next.ufMina = Math.round(ufFromLosses(next) * 10) / 10;
      next.eoMina = (next.dfMina / 100) * (next.ufMina / 100) * 100;
    }
    setPremises(next);
  };
  const lossDay = fixedLossMinPerDay(premises);
  const L = lossesOf(premises);

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

  // taxas de transporte necessárias: mesma base da Produção Planejada (seca ÷ horas efetivas) convertida para úmida
  const tr = results.transportTph;
  const derivedTph: Record<string, number> = {
    __perda: processPct(premises).loss,
    fleetCapacityMinaTPH: tr.rom,
    fleetCapacityBaiaTPH: tr.tailings,
    fleetCapacityTerminalTPH: tr.product,
    maxTotalFleetCapacityTPH: tr.total,
  };
  // mantém os campos guardados iguais aos calculados (usados em outras telas)
  React.useEffect(() => {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const next = { fleetCapacityMinaTPH: r2(tr.rom), fleetCapacityBaiaTPH: r2(tr.tailings), fleetCapacityTerminalTPH: r2(tr.product), maxTotalFleetCapacityTPH: r2(tr.total) };
    if ((Object.keys(next) as (keyof typeof next)[]).some((k) => Math.abs((premises[k] ?? 0) - next[k]) > 0.005)) setPremises((prev) => ({ ...prev, ...next }));
  }, [tr.rom, tr.tailings, tr.product, tr.total]);

  const [step, setStep] = useState(0);
  const [netView, setNetView] = useState<'desenho' | 'tabela'>('desenho');
  const show = (n: number) => step === 0 || step === n;
  const mixedFleet = (premises.fleetTypes ?? []).filter((t) => t.count > 0).length > 1;
  /** começa a frota por tipo (caminhão atual + outro modelo) e leva até o card “Frota por tipo de caminhão” */
  const addFleetType = () => {
    if (!mixedFleet) {
      const cat = catalogOf(premises).trucks;
      const base = cat.find((c) => c.id === premises.truckClassId) ?? cat[0];
      const other = cat.find((c) => c.id !== base.id && (c.vehicle ?? 'mina') === (base.vehicle ?? 'mina')) ?? cat.find((c) => c.id !== base.id)!;
      setPremises((p) => ({ ...p, truckClassId: base.id, fleetTypes: [{ classId: base.id, count: p.truckCount || 1 }, { classId: other.id, count: 1 }], truckCount: (p.truckCount || 1) + 1 }));
    }
    setTimeout(() => document.getElementById('frota-por-tipo')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const sections = [
    {
      title: "Período de Simulação",
      step: 1,
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
      step: 1,
      fields: [
        { label: "DF Equipamentos (%)", key: "dfMina" },
        { label: premises.losses?.enabled ? "UF Equipamentos (%) — calculada pelas perdas" : "UF Equipamentos (%)", key: "ufMina", readOnly: !!premises.losses?.enabled },
        { label: "Rendimento DF × UF (%)", key: "eoMina", readOnly: true },
        { label: "Transporte Mina → Planta necessário (t/h úmida)", key: "fleetCapacityMinaTPH", readOnly: true },
      ]
    },
    {
      title: "Planta & Limite de Processamento",
      step: 1,
      fields: [
        { label: "DF Equipamentos (%)", key: "dfPlanta" },
        { label: "UF Equipamentos (%)", key: "ufPlanta" },
        { label: "Rendimento DF × UF (%)", key: "eoPlanta", readOnly: true },
        { label: "Capacidade Máxima Planta (t/h)", key: "plantFeedRateTPH", highlight: true },
      ]
    },
    {
      title: "Processo",
      step: 2,
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
        premises.processType === 'seco'
          ? { label: "RM — recuperação mássica a seco (%)", key: "rmDry" }
          : { label: "RM Global (%)", key: "rmGlobal" },
        { label: premises.processType === 'seco' ? "Rejeito Total (%) — não há no processo a seco" : "Rejeito Total (%) — preenchido com 100 − RM, editável", key: "rejeitoTotal", disabled: premises.processType === 'seco' },
        { label: "Perda de processo (%) — não transportada", key: "__perda", readOnly: true },
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
      step: 4,
      fields: [
        { label: "Velocidade Vazio (km/h)", key: "velocidadeVazio" },
        { label: "Velocidade Cheio (km/h)", key: "velocidadeCheio" },
        { label: "Classe do Caminhão", key: "truckClassId", type: "select", options: [...catalogOf(premises).trucks.map((t) => ({ label: `${t.manufacturer ? `${t.manufacturer} – ` : ''}${t.name}`, value: t.id })), { label: "Outra (informar abaixo)", value: "" }] },
        { label: "Capacidade Caminhão (t)", key: "truckCapacity" },
        { label: mixedFleet ? "Número de Caminhões — soma da frota por tipo" : "Número de Caminhões", key: "truckCount", readOnly: mixedFleet },
        { label: "Volume da Caçamba (m³)", key: "truckVolumeM3" },
        { label: "Transporte de rejeito necessário (t/h úmida)", key: "fleetCapacityBaiaTPH", readOnly: true },
        { label: "Transporte de produto necessário (t/h úmida)", key: "fleetCapacityTerminalTPH", readOnly: true },
        { label: "Transporte total necessário (t/h úmida)", key: "maxTotalFleetCapacityTPH", readOnly: true },
      ]
    },
    {
      title: "Tempos de Ciclo (min)",
      step: 5,
      fields: [
        { label: "Carregamento (min)", key: "loadingTime" },
        { label: "Basculamento/Manobra (min)", key: "dumpingTime" },
        { label: "Pesagem Carregado (min)", key: "weighingTimeLoaded" },
        { label: "Pesagem Vazio (min)", key: "weighingTimeEmpty" },
        { label: "Fila por Ciclo (min)", key: "queueMin" },
        { label: "Posicionamento na carga com equipamento do local (min)", key: "loaderSpotMin" },
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
      {/* Etapas: todas as entradas do planejamento ficam aqui; as outras telas analisam */}
      <nav className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 rounded-2xl border border-black/5 bg-white/95 p-1.5 shadow-sm backdrop-blur" aria-label="Etapas das premissas">
        {STEPS.map((st) => (
          <button
            key={st.id}
            type="button"
            onClick={() => setStep(st.id)}
            aria-current={step === st.id ? 'step' : undefined}
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${step === st.id ? 'bg-[#151619] text-white' : 'text-black/60 hover:bg-black/5'}`}
          >
            {st.id > 0 && <span className="mr-1 font-mono text-xs opacity-60">{st.id}</span>}
            {st.label}
          </button>
        ))}
      </nav>
      {step > 0 && <p className="-mt-4 text-xs text-black/50">{STEPS[step].hint}</p>}

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
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Dias equivalentes (Mina) · h efetivas ÷ 24</p>
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
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Dias equivalentes (Planta) · h efetivas ÷ 24</p>
            <p className="text-xl font-mono font-bold text-purple-600">{stats.diasTrabalhoPlanta.toFixed(2)}d</p>
          </div>
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-black/5">
            <p className="text-[10px] font-bold text-black/40 uppercase tracking-widest mb-1">Jornada Efetiva (Planta)</p>
            <p className="text-xl font-mono font-bold text-orange-600">{stats.jornadaEfetivaPlanta.toFixed(2)}h/d</p>
          </div>
        </div>
      </div>

      {show(2) && (
        <>
      {/* Planned Production Summary */}
      <div className="bg-[#151619] p-8 rounded-3xl shadow-xl text-white">
        <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-400 mb-2">Produção Planejada Detalhada</h3>
        <p className="mb-5 text-xs text-white/50">
          Massa seca: ROM = consumo da planta; produto = ROM × RM {fmt2(processPct(premises).rm)}%; rejeito = ROM × {fmt2(processPct(premises).rej)}%{processPct(premises).loss > 0.005 ? `; perda de processo ${fmt2(processPct(premises).loss)}% (não transportada)` : ''}.
          t/h = massa do mês ÷ horas efetivas (mina para ROM e estéril, planta para produto e rejeito). A frota transporta a massa úmida: seca × {fmt3(results.transportTph.factor)} ({premises.moistureMode === 'base_umida' ? `÷ (1 − ${fmt2(premises.umidadeNatural)}%) × (1 + ${fmt2(premises.perdaMaterial)}%)` : `1 + ${fmt2(premises.umidadeNatural)}% + ${fmt2(premises.perdaMaterial)}%`}). Os campos de transporte necessário (Mina e Transporte/Frota) são a coluna “t/h úmida”.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] font-bold uppercase tracking-widest text-white/40">
                <th className="py-2 pr-3">Fluxo</th>
                <th className="py-2 pr-3 text-right">t/h seca</th>
                <th className="py-2 pr-3 text-right">t/h úmida (frota)</th>
                <th className="py-2 pr-3 text-right">t/dia seca</th>
                <th className="py-2 pr-3 text-right">t/mês seca</th>
                <th className="py-2 text-right">t/mês úmida (frota)</th>
              </tr>
            </thead>
            <tbody>
              {([
                ["Mina → Planta (ROM)", results.plannedHourlyROM, results.plannedDailyROM, results.plannedMonthlyROM, true],
                ["Planta → Terminal (produto)", results.plannedHourlyPlanta, results.plannedDailyPlanta, results.plannedMonthlyPlanta, true],
                ["Planta → Rejeito filtrado", results.plannedHourlyRejeito, results.plannedDailyRejeito, results.plannedMonthlyRejeito, premises.processType !== 'seco'],
                ["Mina → Estéril", results.plannedHourlyWaste, results.plannedDailyWaste, results.plannedMonthlyWaste, !!premises.hasWasteRock],
              ] as [string, number, number, number, boolean][])
                .filter((r) => r[4])
                .map(([label, h, d, m]) => (
                  <tr key={label} className="border-b border-white/5">
                    <td className="py-2 pr-3 text-white/70">{label}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt2(h)}</td>
                    <td className="py-2 pr-3 text-right font-mono font-bold text-emerald-300">{fmt2(h * results.transportTph.factor)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt2(d)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmt2(m)}</td>
                    <td className="py-2 text-right font-mono">{fmt2(m * results.transportTph.factor)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="font-bold text-emerald-400">
                <td className="py-2 pr-3">Total transportado pela frota</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt2(results.plannedHourlyTotalFrota)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt2(results.transportTph.total)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt2(results.plannedDailyTotal)}</td>
                <td className="py-2 pr-3 text-right font-mono">{fmt2(results.plannedMonthlyTotal)}</td>
                <td className="py-2 text-right font-mono">{fmt2(results.plannedMonthlyTotal * results.transportTph.factor)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sections.filter((section) => show(section.step)).map((section) => (
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
                          field.key === "processType" || field.key === "moistureMode" || field.key === "truckClassId"
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
                    <div className={`w-full border rounded-xl px-4 py-2.5 text-sm font-mono ${field.key === "__perda" && derivedTph.__perda > 0.005 ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-black/5 border-black/5 text-black/40"}`}>
                      {((field.key in derivedTph ? derivedTph[field.key] : (premises[field.key as keyof DetailedPremises] as number)) ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  ) : (
                    <input
                      type="number"
                      disabled={field.disabled}
                      value={(premises[field.key as keyof DetailedPremises] as number | undefined) ?? (field.key === "rmDry" ? 100 : field.key === "loaderSpotMin" ? 0.5 : 0)}
                      onChange={(e) => handleChange(field.key as keyof DetailedPremises, parseFloat(e.target.value) || 0)}
                      className={`w-full border border-black/5 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all ${field.highlight ? 'bg-red-50/50 border-red-100 font-bold text-red-600' : 'bg-[#F8F9FA]'} ${field.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  )}
                </div>
              ))}
            </div>
            {section.title === "Transporte / Frota" && (
              <div className="mt-4 rounded-xl bg-black/[0.03] p-3 text-xs text-black/60">
                {mixedFleet ? (
                  <>Frota mista: {(premises.fleetTypes ?? []).filter((t) => t.count > 0).map((t) => `${t.count}× ${catalogOf(premises).trucks.find((c) => c.id === t.classId)?.name ?? t.classId}`).join(' + ')}. A classe e a capacidade acima valem só para quem não está na frota por tipo.</>
                ) : (
                  <>Um tipo de caminhão. Para ter caminhões de modelos diferentes, adicione outro tipo.</>
                )}
                <button type="button" onClick={addFleetType} className="mt-2 block rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm font-semibold text-black/70 hover:bg-black/5">
                  + {mixedFleet ? 'Configurar frota por tipo' : 'Adicionar outro tipo de caminhão'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Equipamentos de carga: tempos e quantidade por local */}
      {show(5) && routes && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5 space-y-6">
          <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Equipamentos de carga — tempos e caçambadas</h3>
          <LoaderTimesEditor premises={premises} setPremises={(fn) => setPremises(fn)} />
          <div>
            <p className="mb-2 text-sm font-semibold text-black/70">Equipamentos por local de carregamento e por movimentação</p>
            <LoaderNeedsTable premises={premises} setPremises={(fn) => setPremises(fn)} routes={routes} />
          </div>
        </div>
      )}

      {show(3) && (
        <>
      {/* Locais e movimentações */}
      {routes && (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Locais e movimentações (rede de fluxos)</h3>
            <div className="inline-flex rounded-lg border border-black/10 p-0.5 text-sm" role="tablist" aria-label="Forma de edição da rede">
              {(['desenho', 'tabela'] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={netView === v} onClick={() => setNetView(v)} className={`rounded-md px-3 py-1 font-medium ${netView === v ? 'bg-[#151619] text-white' : 'text-black/60 hover:bg-black/5'}`}>
                  {v === 'desenho' ? 'Desenho' : 'Tabela'}
                </button>
              ))}
            </div>
          </div>
          {netView === 'desenho' ? (
            <FlowDiagram premises={premises} setPremises={(fn) => setPremises(fn)} routes={routes} setRoutes={(fn) => setRoutes(fn)} />
          ) : (
            <NetworkEditor premises={premises} setPremises={(fn) => setPremises(fn)} routes={routes} setRoutes={(fn) => setRoutes(fn)} />
          )}
        </div>
      )}

      </>
      )}

      {show(4) && (
        <>
      {/* Frota por tipo (frota mista) */}
      {routes && (
        <div id="frota-por-tipo" className="bg-white p-6 rounded-2xl shadow-sm border border-black/5 scroll-mt-20">
          <h3 className="text-sm font-bold uppercase tracking-widest text-black/40 mb-3">Frota por tipo de caminhão</h3>
          <FleetTypesEditor premises={premises} setPremises={(fn) => setPremises(fn)} routes={routes} setRoutes={(fn) => setRoutes(fn)} />
        </div>
      )}

      {/* Catálogo de equipamentos */}
      <details className="bg-white p-6 rounded-2xl shadow-sm border border-black/5">
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-widest text-black/40">Catálogo de equipamentos (fabricantes, modelos, custos e vida útil)</summary>
        <div className="mt-4">
          <CatalogEditor premises={premises} setPremises={setPremises as (p: DetailedPremises) => void} />
        </div>
      </details>

      </>
      )}

      {show(6) && (
        <>
      {/* Perdas operacionais detalhadas */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-black/5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-widest text-black/40">Perdas operacionais dos caminhões</h3>
            <p className="mt-1 max-w-3xl text-xs text-black/50">
              Para um cenário realista: troca de turno, refeição, inspeção, abastecimento e lubrificação e interferências na via. Ligado, a UF da mina passa a ser calculada por estas paradas, as interferências entram no ciclo de cada viagem e o simulador gera cada parada como evento, com as horas mostradas nos resultados.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={!!premises.losses?.enabled} onChange={(e) => setLosses({ enabled: e.target.checked })} />
            Usar perdas detalhadas
          </label>
        </div>
        <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6 ${premises.losses?.enabled ? "" : "opacity-50"}`}>
          {([
            ["shifts", "Turnos por dia", "un."],
            ["shiftChangeMin", "Troca de turno", "min por troca"],
            ["mealMin", "Refeição", "min por turno"],
            ["otherMinPerShift", "Inspeção / DDS / outras", "min por turno"],
            ["fuelMin", "Abastecimento e lubrificação", "min por caminhão por dia"],
            ["interferenceMin", "Interferências na via", "min por viagem"],
          ] as const).map(([k, label, unit]) => (
            <div key={k}>
              <label className="block text-xs font-medium text-black/60 mb-1.5">
                {label} <span className="text-black/35">({unit})</span>
              </label>
              <input
                type="number"
                step={k === "interferenceMin" ? 0.5 : 1}
                disabled={!premises.losses?.enabled}
                value={L[k] ?? DEFAULT_LOSSES[k]}
                onChange={(e) => setLosses({ [k]: Math.max(0, parseFloat(e.target.value) || 0) } as Partial<NonNullable<DetailedPremises["losses"]>>)}
                className="w-full bg-[#F8F9FA] border border-black/5 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-black/55">
          Paradas fixas por caminhão por dia: troca de turno {lossDay.shiftChange} min + refeição {lossDay.meal} min + inspeção {lossDay.other} min + abastecimento {lossDay.fuel} min ={" "}
          <b>{lossDay.total} min ({(lossDay.total / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h)</b> em {premises.contractedHoursMina} h de jornada →{" "}
          UF {ufFromLosses(premises).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%. Interferências: +{L.interferenceMin} min em cada ciclo. Chuva: pelos dias trabalhados do calendário do simulador.
        </p>
      </div>

      </>
      )}

      {/* Operational Calendar Table */}
      {show(1) && (
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
      )}
    </div>
  );
};

export default PremisesForm;
