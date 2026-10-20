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
  return { destination, bufferT: 200, stackerTph: 650, stackerDf: 85, loaderId: 'pa-35', plantTph: 0, plantStockInitialT: 0, plantStockMaxT: 0 };
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

/* ------------------------------------------------------------------------- */
/* Modelos para "Adicionar configuração"                                      */
/* ------------------------------------------------------------------------- */

/** Rodoviário em estrada pavimentada (rampa efetiva = rampa + rolamento). */
export const HIGHWAY_SPEED: SpeedTable = {
  loaded: [
    { maxGrade: -8, kmh: 40 },
    { maxGrade: -4, kmh: 55 },
    { maxGrade: 2, kmh: 70 },
    { maxGrade: 5, kmh: 45 },
    { maxGrade: 8, kmh: 28 },
    { maxGrade: 11, kmh: 18 },
    { maxGrade: 14, kmh: 12 },
    { maxGrade: 99, kmh: 8 },
  ],
  empty: [
    { maxGrade: -8, kmh: 50 },
    { maxGrade: -4, kmh: 65 },
    { maxGrade: 2, kmh: 80 },
    { maxGrade: 5, kmh: 65 },
    { maxGrade: 8, kmh: 50 },
    { maxGrade: 11, kmh: 35 },
    { maxGrade: 14, kmh: 25 },
    { maxGrade: 99, kmh: 18 },
  ],
};

const scaled = (t: SpeedTable, k: number): SpeedTable => ({
  loaded: t.loaded.map((x) => ({ ...x, kmh: Math.round(x.kmh * (x.maxGrade > 2 ? k : 1)) })),
  empty: t.empty.map((x) => ({ ...x, kmh: x.kmh })),
});

/** Rígido fora de estrada (mina): mais lento no plano, forte em rampa. */
const OFF_ROAD_SPEED: SpeedTable = {
  loaded: [
    { maxGrade: -8, kmh: 18 },
    { maxGrade: -4, kmh: 25 },
    { maxGrade: 2, kmh: 40 },
    { maxGrade: 5, kmh: 26 },
    { maxGrade: 8, kmh: 17 },
    { maxGrade: 11, kmh: 12 },
    { maxGrade: 14, kmh: 9 },
    { maxGrade: 99, kmh: 7 },
  ],
  empty: [
    { maxGrade: -8, kmh: 25 },
    { maxGrade: -4, kmh: 35 },
    { maxGrade: 2, kmh: 50 },
    { maxGrade: 5, kmh: 40 },
    { maxGrade: 8, kmh: 32 },
    { maxGrade: 11, kmh: 25 },
    { maxGrade: 14, kmh: 19 },
    { maxGrade: 99, kmh: 14 },
  ],
};

export interface ConfigPreset {
  id: string;
  group: 'Mina / fora de estrada' | 'Rodoviário (estrada, ponta a ponta)';
  name: string;
  make: () => Omit<TruckConfig, 'id' | 'costFixedPerH' | 'costVarPerH'>;
}

/**
 * Modelos de partida (valores típicos, editáveis). Rodoviários com limites de velocidade próprios,
 * para transporte ponta a ponta fora da mina (pátio → terminal, fábrica, porto).
 */
export const CONFIG_PRESETS: ConfigPreset[] = [
  { id: 'mina-8x4', group: 'Mina / fora de estrada', name: 'Basculante 8x4 (~40 t)', make: () => ({ name: 'Basculante 8x4 (~40 t)', vehicle: 'mina', payloadT: 40, volumeM3: 22, dumpMin: 1.5, maneuverMin: 1, speed: clone(ROAD_TRUCK_SPEED) }) },
  { id: 'mina-rig60', group: 'Mina / fora de estrada', name: 'Rígido fora de estrada (~60 t)', make: () => ({ name: 'Rígido fora de estrada (~60 t)', vehicle: 'mina', payloadT: 60, volumeM3: 38, dumpMin: 1.2, maneuverMin: 1, speed: clone(OFF_ROAD_SPEED) }) },
  { id: 'mina-rig90', group: 'Mina / fora de estrada', name: 'Rígido fora de estrada (~90 t)', make: () => ({ name: 'Rígido fora de estrada (~90 t)', vehicle: 'mina', payloadT: 90, volumeM3: 58, dumpMin: 1.2, maneuverMin: 1, speed: scaled(OFF_ROAD_SPEED, 0.95) }) },
  { id: 'rod-truck', group: 'Rodoviário (estrada, ponta a ponta)', name: 'Rodoviário truck 6x4 basculante (~23 t)', make: () => ({ name: 'Rodoviário truck 6x4 basculante (~23 t)', vehicle: 'rodoviario', payloadT: 23, volumeM3: 14, dumpMin: 1.5, maneuverMin: 1, speed: clone(HIGHWAY_SPEED), speedLimitLoadedKmh: 70, speedLimitEmptyKmh: 80, rollingResistance: 1.5 }) },
  { id: 'rod-carreta', group: 'Rodoviário (estrada, ponta a ponta)', name: 'Carreta basculante 3 eixos (~33 t)', make: () => ({ name: 'Carreta basculante 3 eixos (~33 t)', vehicle: 'rodoviario', payloadT: 33, volumeM3: 22, dumpMin: 2.5, maneuverMin: 2, speed: scaled(HIGHWAY_SPEED, 0.9), speedLimitLoadedKmh: 60, speedLimitEmptyKmh: 80, rollingResistance: 1.5 }) },
  { id: 'rod-bitrem', group: 'Rodoviário (estrada, ponta a ponta)', name: 'Bitrem basculante 7 eixos (~38 t)', make: () => ({ name: 'Bitrem basculante 7 eixos (~38 t)', vehicle: 'rodoviario', payloadT: 38, volumeM3: 26, dumpMin: 4, maneuverMin: 3, speed: scaled(HIGHWAY_SPEED, 0.85), speedLimitLoadedKmh: 60, speedLimitEmptyKmh: 80, rollingResistance: 1.5 }) },
  { id: 'rod-rodotrem', group: 'Rodoviário (estrada, ponta a ponta)', name: 'Rodotrem basculante 9 eixos (~50 t)', make: () => ({ name: 'Rodotrem basculante 9 eixos (~50 t)', vehicle: 'rodoviario', payloadT: 50, volumeM3: 34, dumpMin: 5, maneuverMin: 4, speed: scaled(HIGHWAY_SPEED, 0.75), speedLimitLoadedKmh: 60, speedLimitEmptyKmh: 80, rollingResistance: 1.5 }) },
];
