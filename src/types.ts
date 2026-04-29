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
  rejeitoTotal: number; // 55%
  
  umidadeNatural: number; // 9%
  perdaMaterial: number; // 1%
  velocidadeVazio: number; // 12 km/h
  velocidadeCheio: number; // 10 km/h
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
