import type { Circuit, Receiving, Scenario, SimModel, SimRoute, SpeedTable, TruckConfig } from './types';

/** Tabela típica de caminhão basculante rodoviário (rampa efetiva = rampa + resistência ao rolamento). */
export const ROAD_TRUCK_SPEED: SpeedTable = {
  loaded: [
    { maxGrade: -8, kmh: 20 },
    { maxGrade: -4, kmh: 28 },
    { maxGrade: 2, kmh: 40 },
    { maxGrade: 5, kmh: 25 },
    { maxGrade: 8, kmh: 15 },
    { maxGrade: 11, kmh: 10 },
    { maxGrade: 14, kmh: 7 },
    { maxGrade: 99, kmh: 5 },
  ],
  empty: [
    { maxGrade: -8, kmh: 25 },
    { maxGrade: -4, kmh: 32 },
    { maxGrade: 2, kmh: 45 },
    { maxGrade: 5, kmh: 38 },
    { maxGrade: 8, kmh: 28 },
    { maxGrade: 11, kmh: 20 },
    { maxGrade: 14, kmh: 15 },
    { maxGrade: 99, kmh: 11 },
  ],
};

/** Composição longa (nove eixos): mais lenta em rampa, mais carga por viagem. */
export const LONG_COMBO_SPEED: SpeedTable = {
  loaded: [
    { maxGrade: -8, kmh: 15 },
    { maxGrade: -4, kmh: 22 },
    { maxGrade: 2, kmh: 35 },
    { maxGrade: 5, kmh: 18 },
    { maxGrade: 8, kmh: 11 },
    { maxGrade: 11, kmh: 7 },
    { maxGrade: 14, kmh: 5 },
    { maxGrade: 99, kmh: 4 },
  ],
  empty: [
    { maxGrade: -8, kmh: 22 },
    { maxGrade: -4, kmh: 28 },
    { maxGrade: 2, kmh: 40 },
    { maxGrade: 5, kmh: 32 },
    { maxGrade: 8, kmh: 24 },
    { maxGrade: 11, kmh: 17 },
    { maxGrade: 14, kmh: 12 },
    { maxGrade: 99, kmh: 9 },
  ],
};

const clone = (t: SpeedTable): SpeedTable => ({ loaded: t.loaded.map((x) => ({ ...x })), empty: t.empty.map((x) => ({ ...x })) });

export function defaultConfigs(): TruckConfig[] {
  return [
    { id: 'A', name: 'A – Basculante 6x4 (frota atual)', payloadT: 27, volumeM3: 16, dumpMin: 1.5, maneuverMin: 1.0, speed: clone(ROAD_TRUCK_SPEED), costFixedPerH: 0, costVarPerH: 0 },
    { id: 'B', name: 'B – Composição 9 eixos', payloadT: 48, volumeM3: 30, dumpMin: 3.0, maneuverMin: 2.0, speed: clone(LONG_COMBO_SPEED), costFixedPerH: 0, costVarPerH: 0 },
    { id: 'C', name: 'C – Descarga inferior', payloadT: 40, volumeM3: 25, dumpMin: 1.0, maneuverMin: 0.5, speed: clone(LONG_COMBO_SPEED), costFixedPerH: 0, costVarPerH: 0 },
  ];
}

export function defaultScenarios(): Scenario[] {
  const base: Omit<Scenario, 'id' | 'name'> = {
    hoursPerDay: 20,
    days: 7,
    truckDf: 85,
    efficiency: 83,
    travelFactor: 1,
    receivingFactor: 1,
    cv: 0.15,
  };
  return [
    { id: 's1', name: '1 – Referência', ...base },
    { id: 's2', name: '2 – Ciclo 10% maior', ...base, travelFactor: 1.1 },
    { id: 's3', name: '3 – Disponibilidade 75%', ...base, truckDf: 75 },
    { id: 's4', name: '4 – Recebimento −20%', ...base, receivingFactor: 0.8 },
  ];
}

export function defaultCircuit(route: SimRoute, i: number): Circuit {
  return {
    id: `c-${route.id}`,
    name: route.name,
    routeId: route.id,
    trucks: 4,
    density: 1.6,
    loaders: 1,
    loadSpotMin: 0.7,
    loaderTph: 600,
    loaderDf: 85,
    weighing: true,
    weighMin: 1,
    dumpStations: 1,
    destination: i === 0 ? 'Destino 1' : 'Destino 1',
  };
}

export function defaultReceiving(destination: string): Receiving {
  return { destination, bufferT: 200, stackerTph: 850, stackerDf: 90, plantTph: 0, plantStockInitialT: 0, plantStockMaxT: 0 };
}

export function emptyModel(): SimModel {
  return {
    routes: [],
    configs: defaultConfigs(),
    circuits: [],
    receiving: [defaultReceiving('Destino 1')],
    scenarios: defaultScenarios(),
    speedLimitKmh: 40,
    rollingResistance: 2,
    truckMttrH: 3,
    targetTpd: 0,
    replications: 10,
    warmupH: 2,
  };
}
