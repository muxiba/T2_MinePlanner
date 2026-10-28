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
  /** geometria do DXF por período: polígonos de origem e destino e polilinha do trajeto (vale até ser trocada) */
  geo?: RouteGeo[];
  /** nomes dos períodos da geometria (índice = período − 1); a quantidade de períodos é o tamanho da lista */
  geoLabels?: string[];
  /** paradas no trajeto (pesagem, inspeção, abastecimento...), sem massa */
  stops?: RouteStop[];
  /** tempos próprios desta movimentação (min); vazio = os das premissas / do equipamento do local */
  loadMin?: number;
  dumpMin?: number;
  /** modo só transporte: nome livre do material (minério, estéril, areia...) */
  materialName?: string;
  /** desativada porque “possui estéril” foi desmarcado (volta ao marcar de novo) */
  wasteOff?: boolean;
  /** via: interna (mina/planta) ou estrada pública (só caminhões rodoviários) */
  roadType?: 'interna' | 'estrada';
  /** frota mista: caminhões de cada tipo (id do catálogo) nesta rota */
  mix?: Record<string, number>;
}

/** Frota mista: tipo de caminhão (catálogo) e quantidade. */
export interface FleetType {
  classId: string;
  count: number;
  /** velocidades próprias deste tipo (km/h); vazio = as das premissas */
  speedLoaded?: number;
  speedEmpty?: number;
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
  /** carregamento dos caminhões que saem deste local: id do catálogo, 'silo' (sem equipamento), 'tempo' (tempo de carga das premissas) ou vazio (o equipamento padrão de Transporte / Frota) */
  loaderClassId?: string;
  /** equipamentos de carga disponíveis no local (vazio = o sistema calcula o necessário) */
  loaderCount?: number;
  /** disponibilidade física do equipamento de carga (%) */
  loaderDf?: number;
  /** bloco do desenho em que fica: no processo (mina = pilha de ROM, produto, rejeito ou estéril); no modo só transporte (origem, passagem, destino) */
  group?: 'mina' | 'planta' | 'produto' | 'rejeito' | 'esteril' | 'origem' | 'passagem' | 'destino';
  /** equipamentos de carga do local (formato antigo; convertido em loadUses) */
  loaders?: NodeLoader[];
  /** carga por uso: 'feed' (alimentar a planta / planta móvel) ou o id de cada movimentação que sai do local */
  loadUses?: Record<string, LoadUse>;
  /** transbordo / processamento no caminho (ex.: peneiramento móvel): parte do material é descartada no local */
  transfer?: {
    /** % do que chega que é descartado (over ou finos da peneira); o restante segue */
    discardPct: number;
    /** capacidade de processamento (t/h, seca); vazio = sem limite */
    capacityTph?: number;
    /** nome do processo (ex.: peneiramento) e do material descartado (ex.: over) */
    process?: string;
    discardName?: string;
  };
}

/** Geometria de uma movimentação em um período (1 = primeiro); campos vazios = iguais ao período anterior. */
export interface RouteGeo {
  period: number;
  origin?: [number, number][];
  dest?: [number, number][];
  path?: { x: number; y: number; z: number }[];
  /** posição de cada parada no trajeto (id da parada → ponto) */
  stops?: Record<string, { x: number; y: number; z?: number }>;
  files?: { origin?: string; dest?: string; path?: string; stops?: Record<string, string> };
}

/** Parada no trajeto de uma movimentação: o caminhão para (com fila, se o posto estiver ocupado) e segue. */
export interface RouteStop {
  id: string;
  name: string;
  kind: 'pesagem' | 'inspecao' | 'abastecimento' | 'outro';
  /** distância da origem até a parada (m) */
  distM: number;
  /** tempo parado (min) */
  stopMin: number;
  /** em que sentido o caminhão para */
  dir: 'ida' | 'volta' | 'ambos';
  /** postos de atendimento (ex.: 1 balança) */
  posts?: number;
}

/** Como um uso de carga é atendido: equipamento próprio, o mesmo de outro uso do local, o tempo das premissas ou silo/correia. */
export interface LoadUse {
  mode: 'own' | 'share' | 'tempo' | 'silo';
  /** equipamento próprio: id do catálogo (vazio = o padrão de Transporte / Frota) e quantidade disponível (vazio = calcular) */
  classId?: string;
  count?: number;
  /** usa o mesmo equipamento de outro uso do local ('feed' ou id da movimentação) */
  shareWith?: string;
}

/** Equipamento de carga de um local: carrega os caminhões de algumas (ou todas as) saídas, ou alimenta a planta. */
export interface NodeLoader {
  id: string;
  /** id do catálogo, 'silo', 'tempo' (tempo de carga das premissas) ou vazio (o equipamento padrão de Transporte / Frota) */
  classId?: string;
  /** quantidade disponível (vazio = o sistema calcula o necessário) */
  count?: number;
  /** carregar caminhões (padrão) ou alimentar a planta (sem caminhão, pela taxa de alimentação) */
  role?: 'caminhoes' | 'alimentacao';
  /** movimentações atendidas (vazio = todas as saídas que nenhum outro equipamento do local atende) */
  routeIds?: string[];
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
  /** posicionamento / troca do caminhão (min), quando vem do catálogo */
  spotMin?: number;
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
  /** ciclo de uma caçambada (s): carregar + giro carregado + descarga + giro vazio; se as partes forem informadas, é a soma delas */
  cycleSec: number;
  /** fator de enchimento da caçamba (%), padrão 90 */
  fillFactor?: number;
  /** partes do ciclo (s) */
  digSec?: number;
  swingLoadedSec?: number;
  dumpSec?: number;
  swingEmptySec?: number;
  /** posicionamento / troca do caminhão sob o equipamento (min); vazio = o das premissas */
  spotMin?: number;
  /** disponibilidade física (%); vazio = DF da mina */
  dfPct?: number;
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
  /** rede: processo (mina → planta → produto/rejeito) ou só transporte (origem → destino, massas informadas) */
  flowMode?: 'processo' | 'transporte';
  /** modo só transporte: meta de transporte (t/h, base seca) — a massa entregue nos destinos que a frota precisa atingir */
  transportTargetTph?: number;
  /** rede guardada de cada modo, para voltar a ela ao trocar de modo */
  savedNets?: Partial<Record<'processo' | 'transporte', { nodes: FlowNode[]; routes: Route[] }>>;
  /** equipamento de carga padrão (catálogo ou 'silo') para todos os locais que não escolheram o seu */
  defaultLoaderClassId?: string;
  /** frota por tipo de caminhão (frota mista); vazio = um tipo só (classe e número de caminhões das premissas) */
  fleetTypes?: FleetType[];
  /** frota otimizada: ocupação máxima de um caminhão/equipamento que divide o tempo entre fluxos (%) */
  shareMaxPct?: number;
  /** frota mista: o sistema distribui os tipos pelo menor custo por tonelada ('auto') ou o usuário define por rota ('manual') */
  mixMode?: 'auto' | 'manual' | 'estatistico';
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
  /** dados do relatório (aba Relatórios): título, cliente, configurações, conclusão */
  reportOptions?: Partial<import('./reports/data').ReportOptions>;
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
