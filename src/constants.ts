import { startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { DetailedPremises, Route } from "./types";

const now = new Date();
const currentMonth = now.getMonth();
const currentYear = now.getFullYear();

const generateDailyCalendar = (month: number, year: number) => {
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });
  
  return days.map(day => ({
    date: day.toISOString(),
    hoursMina: 24,
    hoursPlanta: 24,
  }));
};

const initialCalendar = generateDailyCalendar(currentMonth, currentYear);

export const DEFAULT_PREMISES: DetailedPremises = {
  targetMonthlyROM: 128357.62,
  calendarDays: initialCalendar.length,
  contractedHoursMina: 24,
  contractedHoursPlanta: 24,
  processType: 'umido',
  
  month: currentMonth,
  year: currentYear,
  dailyCalendar: initialCalendar,
  
  // Mina
  dfMina: 85,
  ufMina: 85,
  eoMina: 72,
  
  // Planta
  dfPlanta: 85,
  ufPlanta: 85,
  eoPlanta: 72,
  
  rmGlobal: 45,
  rejeitoTotal: 55,
  
  umidadeNatural: 9,
  perdaMaterial: 1,
  velocidadeVazio: 12,
  velocidadeCheio: 10,
  plantFeedRateTPH: 310,
  
  // Frota Geral
  truckCapacity: 40,
  truckCount: 8,
  
  fleetCapacityMinaTPH: 310,
  fleetCapacityBaiaTPH: 310,
  fleetCapacityTerminalTPH: 310,
  maxTotalFleetCapacityTPH: 930,
  extraAllocations: [],
};

export const INITIAL_ROUTES: Route[] = [
  {
    id: "mina-pilha-2a",
    name: "MINA - PILHA 2A -> PLANTA",
    active: true,
    truckCount: 8,
    truckCapacity: 40,
    distance: 1924.64,
    cycleTime: 24.84,
    mechanicalAvailability: 85,
    operationalEfficiency: 72,
    processType: 'umido',
  },
  {
    id: "planta-baia-pru",
    name: "PLANTA -> BAIA - PRU",
    active: true,
    truckCount: 4,
    truckCapacity: 40,
    distance: 1215.18,
    cycleTime: 17.03,
    mechanicalAvailability: 85,
    operationalEfficiency: 72,
    processType: 'umido',
  },
  {
    id: "planta-terminal",
    name: "PLANTA -> TERMINAL",
    active: true,
    truckCount: 4,
    truckCapacity: 40,
    distance: 800,
    cycleTime: 12.47,
    mechanicalAvailability: 85,
    operationalEfficiency: 72,
    processType: 'umido',
  },
];
