export interface Route {
  id: string;
  name: string;
  active: boolean;
  truckCount: number;
  truckCapacity: number; // tons
  distance: number; // meters (as per image DMT)
  cycleTime: number; // minutes
  mechanicalAvailability: number; // %
  operationalEfficiency: number; // %
  processType?: 'umido' | 'seco';
  targetMass?: number; // tons (monthly target for this specific route)
  isManualOverride?: boolean; // If true, auto-sync won't touch this route

  // --- Dimensionamento v3 (opcionais; rotas antigas continuam válidas) ---
  /** Tipo de fluxo. Se ausente, é deduzido do nome (compatibilidade). */
  kind?: RouteKind;
  /** 'calculated' = ciclo pelas velocidades e DMT; 'informed' = usa cycleTime digitado (cronometrado). */
  cycleMode?: 'calculated' | 'informed';
  /** Fila + manobra por ciclo (min). */
  queueMin?: number;
  /** Volume coroado da caçamba do caminhão (m³). Se informado, limita a carga útil pelo volume. */
  truckVolumeM3?: number;
  /** Equipamento de carga dedicado à rota. Se ausente, usa o tempo de carga das premissas e não limita a rota. */
  loader?: LoaderSetup;
  /**
   * Por padrão a rota usa DF, UF e capacidade do caminhão das Premissas Fundamentais (fonte única).
   * true = a rota usa os próprios valores (mechanicalAvailability = DF, utilization = UF, truckCapacity).
   */
  ownRates?: boolean;
  /**
   * Como a frota da rota é definida:
   * 'inteiro' = ajustada à meta, arredondada para cima (segue as premissas automaticamente);
   * 'exato' = frota quebrada, exatamente a necessária (ex.: 3,60);
   * 'manual' (ou ausente) = número digitado pelo planejador.
   */
  fleetMode?: 'manual' | 'inteiro' | 'exato';
  /** UF própria da rota (%), quando ownRates = true. */
  utilization?: number;
  /** Peso na divisão da massa do fluxo entre rotas do mesmo fluxo (padrão 1). */
  share?: number;
  /** rede de fluxos: local de origem e de destino (FlowNode.id) */
  fromId?: string;
  toId?: string;
}

/** Tipos de local da rede de fluxos. */
export type NodeType = 'frente' | 'planta' | 'estoque' | 'expedicao' | 'rejeito' | 'esteril';

/** Local da rede de fluxos (frente de lavra, planta, estoque, expedição, baia/pilha de rejeito, pilha de estéril). */
export interface FlowNode {
  id: string;
  name: string;
  type: NodeType;
  /** frente: parte do ROM total (peso; padrão 1 = partes iguais entre as frentes) */
  romShare?: number;
  /** frente: estéril desta frente (t seca/mês); vazio = divide a meta de estéril entre as frentes com rota de estéril */
  wasteT?: number;
  /** formação (+) ou consumo (−) de estoque no mês (t seca), em locais de passagem */
  stockChangeT?: number;
  /** carregamento dos caminhões que saem deste local: id do catálogo, 'silo' (sem equipamento) ou vazio (tempo de carga das premissas) */
  loaderClassId?: string;
  /** equipamentos de carga disponíveis no local (vazio = o sistema calcula o necessário) */
  loaderCount?: number;
  /** disponibilidade física do equipamento de carga (%) */
  loaderDf?: number;
}

export type RouteKind = 'rom' | 'product' | 'tailings' | 'waste';

export interface LoaderSetup {
  name: string;
  /** Quantidade de equipamentos de carga atendendo a rota. */
  count: number;
  /** Capacidade da caçamba (m³). */
  bucketM3: number;
  /** Fator de enchimento da caçamba (%). */
  fillFactor: number;
  /** Ciclo de uma caçambada (s). */
  cycleSec: number;
  /** Disponibilidade física do equipamento de carga (%). */
  availability: number;
}

/** Dados econômicos de um modelo do catálogo (opcionais; alimentam o Financeiro da simulação). */
export interface CatalogEconomics {
  /** fabricante (ex.: Volvo, Mercedes-Benz, Scania, Caterpillar, Komatsu) */
  manufacturer?: string;
  /** valor de compra (R$) */
  price?: number;
  /** vida útil (anos) */
  lifeYears?: number;
  /** horas trabalhadas por ano (para converter anos em horas) */
  hoursPerYear?: number;
  /** valor residual ao fim da vida útil (% da compra) */
  residualPct?: number;
  /** manutenção com o equipamento novo (R$/h) */
  maintPerH?: number;
  /** aumento da manutenção por ano de uso (%) */
  maintEscPctYear?: number;
  /** diesel (L/h) */
  dieselLph?: number;
  /** pneus / material rodante (R$/h) */
  tiresPerH?: number;
}

export interface TruckClass extends CatalogEconomics {
  id: string;
  name: string;
  payloadT: number;
  volumeM3: number;
  /** fora de estrada / mina ou rodoviário */
  vehicle?: 'mina' | 'rodoviario';
}

export interface LoaderClass extends CatalogEconomics {
  id: string;
  name: string;
  bucketM3: number;
  cycleSec: number;
}

export interface EquipmentCatalog {
  trucks: TruckClass[];
  loaders: LoaderClass[];
}

export interface DailyCalendarData {
  date: string; // ISO string
  hoursMina: number;
  hoursPlanta: number;
  isMaintenanceMina?: boolean;
  isMaintenancePlanta?: boolean;
}

export interface ExtraFleetAllocation {
  id: string;
  routeId: string;
  truckCount: number;
  durationHours: number; // How many hours this extra fleet will work on this route
  description?: string;
}

export interface DetailedPremises {
  targetMonthlyROM: number; // 128,357.62
  calendarDays: number; // 31
  contractedHoursMina: number; // 24
  contractedHoursPlanta: number; // 24
  processType: 'umido' | 'seco';
  
  month: number; // 0-11
  year: number;
  dailyCalendar: DailyCalendarData[];

  // Mina
  dfMina: number; // 85%
  ufMina: number; // 85%
  eoMina: number; // 72%
  
  // Planta
  dfPlanta: number; // 85%
  ufPlanta: number; // 85%
  eoPlanta: number; // 72%
  
  rmGlobal: number; // 45%
  /** recuperação mássica no processo a seco (%); padrão 100 */
  rmDry?: number;
  rejeitoTotal: number; // 55%
  
  umidadeNatural: number; // 9%
  perdaMaterial: number; // 1%
  velocidadeVazio: number; // 12 km/h
  velocidadeCheio: number; // 10 km/h
  
  // Tempos de Ciclo (min)
  loadingTime: number;
  dumpingTime: number;
  weighingTimeLoaded: number;
  weighingTimeEmpty: number;

  plantFeedRateTPH: number; // 310 t/h (Max)
  
  // Frota Geral
  truckCapacity: number; // 27.75 t
  truckCount: number; // 7 units
  
  // Capacidades de Frota (t/h) - Limites de simulação
  fleetCapacityMinaTPH: number;
  fleetCapacityBaiaTPH: number;
  fleetCapacityTerminalTPH: number;
  maxTotalFleetCapacityTPH: number;

  // Alocação de Frota Extra
  extraAllocations?: ExtraFleetAllocation[];
  /** posicionamento do caminhão sob o equipamento de carga do local (min), somado às caçambadas */
  loaderSpotMin?: number;
  /** rede de fluxos: locais (as rotas são as movimentações entre eles) */
  nodes?: FlowNode[];
  /** Fluxos cuja rota automática o usuário apagou (não são recriados enquanto o fluxo existir). */
  dismissedFlows?: RouteKind[];

  // Estéril
  hasWasteRock: boolean;
  targetMonthlyWasteRock: number;

  // --- Dimensionamento v3 (opcionais) ---
  /** Densidade do material solto, úmido (t/m³). Usada no limite de volume e no cálculo de caçambadas. */
  looseDensity?: number;
  /**
   * Conversão seca → úmida. 'somada' (padrão, como na planilha): úmida = seca × (1 + umidade + perda).
   * 'base_umida': úmida = seca ÷ (1 − umidade) × (1 + perda), para umidade medida sobre a massa úmida.
   */
  moistureMode?: 'somada' | 'base_umida';
  /** Fila por ciclo (min), padrão de todas as rotas (a manobra já está em Basculamento/Manobra). */
  queueMin?: number;
  /**
   * Perdas operacionais detalhadas do caminhão. Ligadas, a UF da mina passa a ser calculada por elas
   * e o simulador gera cada parada como evento (troca de turno, refeição, abastecimento, interferências).
   */
  losses?: {
    enabled: boolean;
    shifts: number;
    shiftChangeMin: number;
    mealMin: number;
    fuelMin: number;
    interferenceMin: number;
    /** outras paradas fixas (min por turno): inspeção pré-uso, DDS, etc. */
    otherMinPerShift: number;
  };
  /** Volume coroado da caçamba do caminhão (m³), padrão de todas as rotas. Vazio = não limita pelo volume. */
  truckVolumeM3?: number;
  /** Classe do caminhão da frota (id do catálogo), ex.: 'rod-40' = basculante 8x4 40 t. */
  truckClassId?: string;
  /** Catálogo de classes de equipamentos para comparação (editável pela empresa). */
  equipmentCatalog?: EquipmentCatalog;
  /** Modelo do simulador de eventos discretos (aba Simulação). */
  simulation?: import('./sim/types').SimModel;
}

export interface DailyLog {
  date: string; // ISO string
  actualProduction: number; // tons
  actualPlanta?: number;
  actualRejeito?: number;
}

export interface RouteLog {
  routeId: string;
  logs: DailyLog[];
}

export interface ProductionData {
  hourlyProduction: number;
  dailyProduction: number;
  monthlyProduction: number;
  tripsPerHour: number;
  tripsPerDay: number;
  targetMass: number;
  equipmentUtilization: number;
  plantLimited: boolean;
  wetMass: number;
  
  // Full Fleet Metrics (Dimensionamento Individual)
  fullFleetTripsPerHour: number;
  fullFleetHourlyProduction: number;
  fullFleetHoursNeeded: number;
  fullFleetDaysNeeded: number;
  fullFleetEffectiveDaysNeeded: number;
  unitaryProductivity: number;
  totalHoursOneTruck: number;
  requiredHourlyDemand: number;
  
  // Suggested Allocation
  suggestedTrucks: number;
}

export interface OperationalDiagnostic {
  status: 'balanced' | 'idle_fleet' | 'plant_bottleneck' | 'unbalanced' | 'critical';
  label: string;
  color: string;
  description: string;
  impacts: string[];
  recommendations: string[];
  indicators: {
    fleetUtilization: number;
    fleetOverload: number;
    bottleneckIndex: number;
    balanceIndex: number;
    productionEfficiency: number;
    operationalSurplusTPH: number;
    operationalSurplusMonthly: number;
    stockpileRateTPH: number;
    stockpileMonthlyTons: number;
    stockpilePercent: number;
    plantUtilization: number;
    plantOverload: number;
    apparentTerminalFlowTPH: number;
  };
  isInviable: boolean;
  inviabilityReason?: string;
}

export interface Scenario {
  id: string;
  name: string;
  routes: Route[];
  premises: DetailedPremises;
  timestamp: number;
}
