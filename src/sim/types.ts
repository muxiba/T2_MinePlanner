/**
 * Tipos do simulador de eventos discretos (aba Simulação).
 * Unidades: distância em m, cota em m, tempo em minutos, massa em t, velocidade em km/h.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Faixa da tabela de velocidade: vale até a rampa efetiva `maxGrade` (%), positiva = subida no sentido do movimento. */
export interface GradeSpeed {
  maxGrade: number;
  kmh: number;
}

export interface SpeedTable {
  loaded: GradeSpeed[];
  empty: GradeSpeed[];
}

/** Rota importada (eixo da via), sempre orientada do ponto de carga para o ponto de descarga. */
export interface SimRoute {
  id: string;
  name: string;
  points: Vec3[];
}

/** Configuração de transporte (A, B, C...): o caminhão/implemento avaliado. */
export interface TruckConfig {
  id: string;
  name: string;
  payloadT: number;
  /** volume útil da caçamba (m³); se informado, limita a carga com a densidade do circuito */
  volumeM3?: number;
  /** tempo de basculamento/descarga (min) */
  dumpMin: number;
  /** manobra para descarga (min) */
  maneuverMin: number;
  speed: SpeedTable;
  /** limites de velocidade próprios (km/h), ex.: caminhão rodoviário em estrada; vazio = os gerais */
  speedLimitLoadedKmh?: number;
  speedLimitEmptyKmh?: number;
  /** tipo de veículo: fora de estrada/mina ou rodoviário */
  vehicle?: 'mina' | 'rodoviario';
  /** resistência ao rolamento própria (%), ex.: estrada pavimentada ≈ 1,5; vazio = a geral do modelo */
  rollingResistance?: number;
  /** interferências próprias deste veículo (min por viagem): tráfego, travessias urbanas, pedágio, semáforos */
  trafficDelayMin?: number;
  /** custo de propriedade/locação (R$/h calendário) */
  costFixedPerH: number;
  /** custo operacional (R$/h trabalhada): combustível, operador, pneus, manutenção */
  costVarPerH: number;
}

export interface Circuit {
  id: string;
  name: string;
  routeId: string;
  /** caminhões alocados no circuito (pode ser sobrescrito na busca de frota) */
  trucks: number;
  /** densidade solta do material (t/m³), para o limite de volume */
  density: number;
  /** postos de carga */
  loaders: number;
  /** posicionamento sob o equipamento de carga (min) */
  loadSpotMin: number;
  /** taxa efetiva do equipamento de carga durante a carga (t/h) — define o tempo de carga de cada configuração */
  loaderTph: number;
  /** caçamba do equipamento de carga (t por passe); se informada, a carga = posicionamento + nº de passes × tempo do passe */
  bucketT?: number;
  /** tempo de cada passe (min) */
  passMin?: number;
  loaderDf: number;
  /** balança no trajeto carregado */
  weighing: boolean;
  weighMin: number;
  /** pontos de descarga simultâneos */
  dumpStations: number;
  /** nome do destino; circuitos com o mesmo destino compartilham descarga e pulmão */
  destination: string;
  /** fluxo do circuito (define a meta a partir da meta de ROM do período) */
  flow?: import('./link').Flow;
  /** peso na divisão do fluxo entre circuitos do mesmo fluxo (padrão 1) */
  share?: number;
  /** frota mista: proporção de cada configuração de caminhão (id → quantidade ou peso); vazio = uma configuração só */
  mix?: Record<string, number>;
  /** paradas no trajeto: posição (fração da rota a partir da origem), tempo (min), sentido e postos */
  stops?: { name: string; weigh: boolean; frac: number; stopMin: number; dir: 'ida' | 'volta' | 'ambos'; posts: number }[];
  /** despacho dinâmico: peso do circuito na divisão das viagens (meta do período, t) */
  dispatchWeight?: number;
  /** t secas no período quando o fluxo é 'outro' */
  tonnesManual?: number;
  /** meta do circuito digitada (t secas no período); vazio = calculada pelo fluxo */
  tonnesDryOverride?: number;
  /** false = caminhões digitados; padrão = calculados pela meta do período */
  autoTrucks?: boolean;
  /** movimentação da rede de fluxos (id da rota do 2. Dimensionamento) que este circuito representa */
  edgeId?: string;
  /** configuração fixa deste circuito (ex.: rodoviário no trecho fora da mina); vazio = a configuração comparada */
  configId?: string;
}

/** Recebimento no destino: pulmão (moega/pilha) retomado pela carregadeira. */
export interface Receiving {
  destination: string;
  /** capacidade do pulmão (t); 0 = descarga direta limitada pela carregadeira */
  bufferT: number;
  /** taxa da carregadeira/saída (t/h); 0 = sem restrição */
  stackerTph: number;
  stackerDf: number;
  /** classe da carregadeira no catálogo (calcula a taxa) */
  loaderId?: string;
  /** true = taxa digitada; padrão = calculada pela classe da carregadeira */
  manualTph?: boolean;
  /** consumo da fábrica a partir do estoque (t/h); 0 = não modelar estoque da fábrica */
  plantTph: number;
  plantStockInitialT: number;
  plantStockMaxT: number;
}

/** Cenário (condição operacional), aplicado sobre o modelo base. */
export interface Scenario {
  id: string;
  name: string;
  /** horas de operação do transporte por dia */
  hoursPerDay: number;
  days: number;
  /** disponibilidade física dos caminhões (%) */
  truckDf: number;
  /** eficiência operacional (%), minutos produtivos por hora trabalhada */
  efficiency: number;
  /** multiplicador dos tempos de viagem (ex.: 1,1 = vias 10% mais lentas) */
  travelFactor: number;
  /** multiplicador da taxa da carregadeira (ex.: 0,8 = restrição de recebimento) */
  receivingFactor: number;
  /** coeficiente de variação dos tempos (0,15 = ±15%) */
  cv: number;
  /** paradas operacionais detalhadas; com elas a eficiência cobre só o que não está listado */
  stops?: OperationalStops;
}

export interface SimModel {
  /** frota mista: composição fixa (proporções) ou sorteio do tipo de cada caminhão a cada réplica */
  mixDraw?: 'fixo' | 'sorteio';
  /** resumo da última matriz simulada (para o memorial impresso) */
  lastRun?: { at: string; targetTpd: number; rows: { config: string; scenario: string; tpd: number; lo: number; hi: number; cycleMin: number; queueLoadMin: number; costPerT: number }[]; circuits: { name: string; tpd: number; cycleMin: number }[] };
  /** período cuja geometria (DXF das movimentações) é usada na simulação e no mapa; padrão 1 */
  geoPeriod?: number;
  /** despacho: cada caminhão fica no seu circuito ('fixo') ou, a cada viagem, vai para o circuito mais atrasado na meta ('dinamico') */
  dispatch?: 'fixo' | 'dinamico';
  routes: SimRoute[];
  configs: TruckConfig[];
  circuits: Circuit[];
  receiving: Receiving[];
  scenarios: Scenario[];
  /** limite de velocidade da via (km/h); mantido por compatibilidade */
  speedLimitKmh: number;
  /** limite de velocidade carregado e vazio (km/h); vazio = speedLimitKmh */
  speedLimitLoadedKmh?: number;
  speedLimitEmptyKmh?: number;
  /** resistência ao rolamento (%), somada à rampa */
  rollingResistance: number;
  /** tempo médio de reparo de caminhão (h) */
  truckMttrH: number;
  /** meta de transporte (t/dia), para a busca da frota mínima */
  targetTpd: number;
  replications: number;
  /** aquecimento descartado das estatísticas (h) */
  warmupH: number;
  /** ligação com as Premissas Fundamentais (padrão: ligada) */
  link?: { enabled: boolean; speedMode?: 'rampa' | 'constante' };
  /** período simulado na aba Circuito */
  period?: { kind: import('./link').PeriodKind; qty?: number; days?: number; romT?: number };
  /** plano de lavra por períodos (frentes, destinos e movimentações) */
  plan?: import('./plan').MinePlan;
  /** dados financeiros (custos, vida útil, receita) */
  finance?: import('./econ').Finance;
}

/* ------------------------------ Resultados ------------------------------ */

export type TruckState =
  | 'fila_carga'
  | 'carregando'
  | 'carregado'
  | 'fila_balanca'
  | 'pesando'
  | 'fila_descarga'
  | 'descarregando'
  | 'vazio'
  | 'manutencao'
  | 'fora_turno'
  | 'perdas'
  | 'troca_turno'
  | 'refeicao'
  | 'abastecimento'
  | 'interferencia';

export const STATE_LABELS: Record<TruckState, string> = {
  fila_carga: 'Fila na carga',
  carregando: 'Carregando',
  carregado: 'Viagem carregado',
  fila_balanca: 'Fila na balança',
  pesando: 'Pesagem',
  fila_descarga: 'Fila na descarga',
  descarregando: 'Manobra e descarga',
  vazio: 'Retorno vazio',
  manutencao: 'Manutenção',
  fora_turno: 'Fora do turno',
  perdas: 'Perdas operacionais',
  troca_turno: 'Troca de turno',
  refeicao: 'Refeição',
  abastecimento: 'Abastecimento e lubrificação',
  interferencia: 'Interferência na via',
};

/** Paradas operacionais simuladas como eventos (das Premissas Fundamentais). */
export interface OperationalStops {
  /** turnos por dia */
  shifts: number;
  /** troca de turno (min por troca) */
  shiftChangeMin: number;
  /** refeição (min por turno, por caminhão) */
  mealMin: number;
  /** abastecimento e lubrificação (min por caminhão por dia) */
  fuelMin: number;
  /** interferências na via (min por viagem, em média): cruzamentos, equipamentos de apoio, tráfego externo */
  interferenceMin: number;
}

/** Trecho de animação: um caminhão em um estado entre t0 e t1 (min). Viagens guardam o sentido. */
export interface TraceItem {
  truck: number;
  circuit: number;
  state: TruckState;
  t0: number;
  t1: number;
}

export interface RunStats {
  tonnes: number;
  trips: number;
  hours: number;
  /** t/h no período medido */
  tph: number;
  /** t/dia (24 h) */
  tpd: number;
  /** tempo médio de cada estado por ciclo (min) */
  cycle: Partial<Record<TruckState, number>>;
  cycleMin: number;
  /** fração do tempo de cada estado (soma 1) */
  stateShare: Partial<Record<TruckState, number>>;
  loaderUtil: number;
  dumpUtil: number;
  stackerUtil: number;
  queueLoadMin: number;
  queueDumpMin: number;
  bufferAvgT: number;
  bufferMaxT: number;
  plantStockoutH: number;
  plantStockMinT: number;
  costPerT: number;
  perCircuit: { name: string; tonnes: number; trips: number; tph: number; cycleMin?: number }[];
}

export interface Summary {
  mean: number;
  lo: number;
  hi: number;
}

export interface AggregateStats {
  reps: number;
  tph: Summary;
  tpd: Summary;
  cycleMin: Summary;
  queueLoadMin: Summary;
  queueDumpMin: Summary;
  loaderUtil: Summary;
  dumpUtil: Summary;
  stackerUtil: Summary;
  plantStockoutH: Summary;
  costPerT: Summary;
  cycle: Partial<Record<TruckState, number>>;
  stateShare: Partial<Record<TruckState, number>>;
  bufferMaxT: number;
  perCircuit: { name: string; tph: number; tpd: Summary; cycleMin?: number }[];
}
