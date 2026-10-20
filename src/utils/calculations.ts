import { DetailedPremises, Route, ProductionData, DailyLog, OperationalDiagnostic } from "../types";
import { analyzeRoute, routeKind, routeRates } from "../engine/fleet";

export function calculateRouteProduction(route: Route, premises: DetailedPremises, effectiveHoursPerMonth: number): ProductionData {
  if (!route.active) {
    return {
      hourlyProduction: 0,
      dailyProduction: 0,
      monthlyProduction: 0,
      tripsPerHour: 0,
      tripsPerDay: 0,
      targetMass: 0,
      equipmentUtilization: 0,
      plantLimited: false,
      wetMass: 0,
      fullFleetTripsPerHour: 0,
      fullFleetHourlyProduction: 0,
      fullFleetHoursNeeded: 0,
      fullFleetDaysNeeded: 0,
      fullFleetEffectiveDaysNeeded: 0,
      unitaryProductivity: 0,
      totalHoursOneTruck: 0,
      requiredHourlyDemand: 0,
      suggestedTrucks: 0,
    };
  }

  // EO Mina Factor (DF * UF)
  const eoMinaFactor = (premises.dfMina / 100) * (premises.ufMina / 100);
  const jornadaEfetivaMina = premises.contractedHoursMina * eoMinaFactor;
  
  // 0. Cycle Time Calculation (Strictly calculated based on speeds and distance)
  // Distance is in meters, speed in km/h. 1 km/h = 1000/60 m/min
  const speedLoadedMmin = (premises.velocidadeCheio * 1000) / 60;
  const speedEmptyMmin = (premises.velocidadeVazio * 1000) / 60;
  
  const travelTimeLoaded = route.distance / speedLoadedMmin;
  const travelTimeEmpty = route.distance / speedEmptyMmin;
  
  void travelTimeLoaded;
  void travelTimeEmpty;
  // Mesmo motor do dimensionamento (engine/fleet): ciclo, carga útil, DF × UF e massa úmida
  const v3 = analyzeRoute(route, premises, route.targetMass || 0);
  const cycleTime = v3.cycle.totalMin || 1;
  const truckCapacity = v3.payloadT || 1;
  
  const fullFleetTripsPerHour = (60 / cycleTime) * premises.truckCount;
  
  // Produtividade Individual (Viagens/Hora por caminhão)
  const individualProductivityTrips = 60 / cycleTime;
  
  // Produtividade Unitária (t/h por caminhão)
  const unitaryProductivity = individualProductivityTrips * truckCapacity;
  
  // Frota Produção Horária (t/h) = fullFleetTripsPerHour * capacity
  const fullFleetHourlyProduction = fullFleetTripsPerHour * truckCapacity;
  
  // Determine Base Seca (Target Mass)
  let baseSeca = route.targetMass || 0;
  if (baseSeca === 0) {
    const routeNameLower = route.name.toLowerCase();
    if (routeNameLower.includes('terminal')) {
      baseSeca = premises.targetMonthlyROM * (premises.rmGlobal / 100);
    } else if (routeNameLower.includes('baia')) {
      baseSeca = premises.targetMonthlyROM * (premises.rejeitoTotal / 100);
    } else {
      baseSeca = premises.targetMonthlyROM;
    }
  }

  // Massa úmida pela mesma regra do motor (premissa "Conversão seca → úmida")
  const wetMass = baseSeca > 0 ? analyzeRoute(route, premises, baseSeca).targetWetT : 0;
  
  // Horas necessárias de produção (h) = Massa - Base Úmida (t) / Frota - Produção Horária (t/h)
  const fullFleetHoursNeeded = fullFleetHourlyProduction > 0 ? wetMass / fullFleetHourlyProduction : 0;
  
  // Necessidade Total de Horas (1 caminhão) = Massa Úmida / Produtividade Unitária
  const totalHoursOneTruck = unitaryProductivity > 0 ? wetMass / unitaryProductivity : 0;

  // Produção Diária (t/dia) = Frota - Produção Horária (t/h) * Jornada Efetiva
  const fullFleetDailyProduction = fullFleetHourlyProduction * jornadaEfetivaMina;
  
  // Dias necessários (Calendário) = Massa - Base Úmida (t) / Produção Diária (t/dia)
  const fullFleetDaysNeeded = fullFleetDailyProduction > 0 ? wetMass / fullFleetDailyProduction : 0;

  // Dias necessários (Efetivos) = Horas necessárias / 24h
  const fullFleetEffectiveDaysNeeded = fullFleetHoursNeeded / 24;

  // 2. Actual Production (based on assigned trucks)
  // Effective Count considering availability and efficiency
  // We use the route's own factors for the actual production calculation
  // DF × UF das premissas (fonte única), salvo rota com valores próprios
  const area = routeKind(route) === 'product' || routeKind(route) === 'tailings' ? 'planta' : 'mina';
  const rates = routeRates(route, premises, area);
  const truckEO = (rates.df / 100) * (rates.uf / 100);
  
  // tripsPerHour here is the AVERAGE trips per hour of the site being open
  const tripsPerHour = (60 / cycleTime) * route.truckCount * truckEO;
  const hourlyProduction = tripsPerHour * truckCapacity;
  
  // dailyProduction = Average Hourly Production * 24 hours
  // (Since hourlyProduction already accounts for DF/UF, we just multiply by the full day)
  const dailyProduction = hourlyProduction * 24;

  // Suggested Fleet Dimensioning
  // To meet the target in the available calendar time, we need:
  // Physical Fleet = (Target / UnitaryProductivity) / (CalendarHours * TruckEO)
  const suggestedTrucks = (unitaryProductivity > 0 && effectiveHoursPerMonth > 0) 
    ? (wetMass / unitaryProductivity) / (effectiveHoursPerMonth) // effectiveHoursPerMonth already has site EO
    : 0;
  
  // mesma necessidade do motor de dimensionamento
  void suggestedTrucks;
  const adjustedSuggestedTrucks = baseSeca > 0 ? analyzeRoute(route, premises, baseSeca).trucksNeededExact : 0;

  return {
    hourlyProduction,
    dailyProduction,
    monthlyProduction: hourlyProduction * (premises.calendarDays * 24), 
    tripsPerHour,
    tripsPerDay: tripsPerHour * 24,
    targetMass: baseSeca,
    equipmentUtilization: truckEO * 100,
    plantLimited: false,
    wetMass,
    fullFleetTripsPerHour,
    fullFleetHourlyProduction,
    fullFleetHoursNeeded,
    fullFleetDaysNeeded,
    fullFleetEffectiveDaysNeeded,
    unitaryProductivity,
    totalHoursOneTruck,
    requiredHourlyDemand: effectiveHoursPerMonth > 0 ? wetMass / effectiveHoursPerMonth : 0,
    suggestedTrucks: adjustedSuggestedTrucks,
  };
}

export function calculateTotalProduction(routes: Route[], premises: DetailedPremises, logs: Record<string, DailyLog[]>) {
  const activeRoutes = routes.filter(r => r.active);
  
  // Dry Process Adjustment
  const isSeco = premises.processType === 'seco';
  const rmGlobal = isSeco ? 100 : premises.rmGlobal;
  const rejeitoTotal = isSeco ? 0 : premises.rejeitoTotal;

  // EO is DF * UF as per user request
  const eoMinaFactor = (premises.dfMina / 100) * (premises.ufMina / 100);
  const eoPlantaFactor = (premises.dfPlanta / 100) * (premises.ufPlanta / 100);

  const horasCalendarioMina = premises.dailyCalendar?.reduce((acc, curr) => acc + curr.hoursMina, 0) || (premises.calendarDays * premises.contractedHoursMina);
  const effectiveHoursPerMonthMina = horasCalendarioMina * eoMinaFactor;

  const horasCalendarioPlanta = premises.dailyCalendar?.reduce((acc, curr) => acc + curr.hoursPlanta, 0) || (premises.calendarDays * premises.contractedHoursPlanta);
  const effectiveHoursPerMonthPlanta = horasCalendarioPlanta * eoPlantaFactor;

  // Categorize routes for target distribution and correct hours
  const categorize = (r: Route) => routeKind(r);

  const romRoutes = activeRoutes.filter(r => categorize(r) === 'rom');
  const productRoutes = activeRoutes.filter(r => categorize(r) === 'product');
  const tailingsRoutes = activeRoutes.filter(r => categorize(r) === 'tailings');
  const wasteRoutes = activeRoutes.filter(r => categorize(r) === 'waste' && premises.hasWasteRock);

  const distributeTarget = (group: Route[], totalCategoryTarget: number, hours: number) => {
    // 1. Sum up manually specified targets
    const manualTargetSum = group.reduce((acc, r) => acc + (r.targetMass || 0), 0);
    // 2. Remaining target to be split among routes without manual target
    // Note: for ROM, we respect the user's manual inputs as the primary target
    const remainingTarget = Math.max(0, totalCategoryTarget - manualTargetSum);
    const autoRoutes = group.filter(r => !r.targetMass);
    const w = (r: Route) => (r.share === undefined ? 1 : Math.max(0, r.share));
    const wSum = autoRoutes.reduce((a, r) => a + w(r), 0);
    
    return group.map(r => {
      let target = r.targetMass;
      if (!target) {
        // Distribute remaining target equally among auto routes
        target = wSum > 0 ? (remainingTarget * w(r)) / wSum : 0;
      }
      return {
        ...r,
        ...calculateRouteProduction({ ...r, targetMass: target }, { ...premises, rmGlobal, rejeitoTotal }, hours)
      };
    });
  };

  const romResults = distributeTarget(romRoutes, premises.targetMonthlyROM, effectiveHoursPerMonthMina);
  
  // Calculate total actual ROM being moved (sum of individual fronts)
  // This will be the basis for product and tailings generation
  const totalActualROMTarget = romResults.reduce((acc, r) => acc + (r.targetMass || 0), 0);

  const productResults = distributeTarget(productRoutes, totalActualROMTarget * (rmGlobal / 100), effectiveHoursPerMonthPlanta);
  const tailingsResults = distributeTarget(tailingsRoutes, totalActualROMTarget * (rejeitoTotal / 100), effectiveHoursPerMonthPlanta);
  const wasteResults = distributeTarget(wasteRoutes, premises.targetMonthlyWasteRock, effectiveHoursPerMonthMina);

  const routeResults = [...romResults, ...productResults, ...tailingsResults, ...wasteResults];

  const romMassSum = totalActualROMTarget;
  const wasteMassSum = wasteResults.reduce((acc, r) => acc + (r.targetMass || 0), 0);
  const romOverload = romMassSum > premises.targetMonthlyROM;
  const wasteOverload = premises.hasWasteRock && wasteMassSum > premises.targetMonthlyWasteRock;
  
  const jornadaEfetivaMina = premises.contractedHoursMina * eoMinaFactor;
  const jornadaEfetivaPlanta = premises.contractedHoursPlanta * eoPlantaFactor;

  const effectiveCalendarDaysMina = effectiveHoursPerMonthMina / 24;
  const effectiveCalendarDaysPlanta = effectiveHoursPerMonthPlanta / 24;

  // Production Totals by Category
  const totalHourlyROM_Only = romResults.reduce((acc, curr) => acc + curr.hourlyProduction, 0);
  const totalHourlyProduct = productResults.reduce((acc, curr) => acc + curr.hourlyProduction, 0);
  const totalHourlyTailings = tailingsResults.reduce((acc, curr) => acc + curr.hourlyProduction, 0);
  const totalHourlyWaste = wasteResults.reduce((acc, curr) => acc + curr.hourlyProduction, 0);

  const totalHourlyROM = totalHourlyROM_Only; // Keep for backward compatibility in return object
  const totalHourlyAllMovement = totalHourlyROM_Only + totalHourlyProduct + totalHourlyTailings + totalHourlyWaste;
  
  const actualDailyROM = totalHourlyROM_Only * jornadaEfetivaMina;
  
  // Total Trucks Used
  const totalTrucksUsed = activeRoutes.reduce((acc, curr) => acc + curr.truckCount, 0);
  const totalTrucksAvailable = premises.truckCount;
  const extraTrucks = Math.max(0, totalTrucksAvailable - totalTrucksUsed);

  // Calculate Actual Extra Production from Manual Allocations
  let allocatedExtraMonthlyProduction = 0;
  let allocatedExtraHourlyProduction = 0;
  
  if (premises.extraAllocations && premises.extraAllocations.length > 0) {
    premises.extraAllocations.forEach(allocation => {
      const route = activeRoutes.find(r => r.id === allocation.routeId);
      if (route) {
        const routeResult = routeResults.find(r => r.id === allocation.routeId);
        if (routeResult) {
          // Extra production for this allocation
          // unitaryProductivity is t/h per truck
          const extraProd = allocation.truckCount * routeResult.unitaryProductivity * allocation.durationHours * (routeResult.equipmentUtilization / 100);
          allocatedExtraMonthlyProduction += extraProd;
        }
      }
    });
    // Convert to hourly average over the month for consistency in TPH displays
    allocatedExtraHourlyProduction = effectiveHoursPerMonthMina > 0 ? allocatedExtraMonthlyProduction / effectiveHoursPerMonthMina : 0;
  }

  // Calculate Extra Production Potential (Pilha Pulmão) for the REMAINING extra trucks
  // We use the weighted average productivity of the active routes to estimate what the extra trucks could do
  const averageUnitaryProductivity = routeResults.length > 0 
    ? routeResults.reduce((acc, curr) => acc + curr.unitaryProductivity, 0) / routeResults.length 
    : 0;
  
  // Potential if the remaining extra trucks worked full time
  const potentialExtraHourlyProduction = extraTrucks * averageUnitaryProductivity * eoMinaFactor;
  const potentialExtraDailyProduction = potentialExtraHourlyProduction * jornadaEfetivaMina;
  const potentialExtraMonthlyProduction = potentialExtraHourlyProduction * effectiveHoursPerMonthMina;

  // Plant Capacity for capping
  const plantCapacityTPH = premises.plantFeedRateTPH || 310;

  // Total Possible Movement (Assigned + Allocated Extra + Potential Extra)
  // We MUST cap the ROM possibility by the plant capacity to avoid misleading the user
  const totalPossibleHourlyMovement = Math.min(totalHourlyROM_Only + allocatedExtraHourlyProduction + potentialExtraHourlyProduction, plantCapacityTPH);
  const totalPossibleMonthlyMovement = totalPossibleHourlyMovement * effectiveHoursPerMonthMina;
  const totalPossibleDailyMovement = totalPossibleHourlyMovement * jornadaEfetivaMina;

  // Theoretical UN-CAPPED Capacity (The "Gross" Mine potential)
  const totalGrossHourlyMinaCapacity = totalHourlyROM_Only + potentialExtraHourlyProduction;

  const totalPossibleHourlyAllMovement = totalHourlyAllMovement + (potentialExtraHourlyProduction); // Total theoretical max of all trucks
  const totalPossibleMonthlyAllMovement = totalPossibleHourlyAllMovement * effectiveHoursPerMonthMina;

  // Stockpile Logic (Pilha Pulmão)
  // Stockpile is only what we ARE MOVING (Assigned ROM + Allocated Extra) that EXCEEDS the plant's capacity
  
  // Hourly Stockpile = (Current ROM Movement) - Plant Capacity (if positive)
  // Note: We exclude potentialExtraHourlyProduction because those trucks are NOT currently working
  const hourlyStockpile = Math.max(0, (totalHourlyROM_Only + allocatedExtraHourlyProduction) - plantCapacityTPH);
  const dailyStockpile = hourlyStockpile * jornadaEfetivaMina;
  const monthlyStockpile = hourlyStockpile * effectiveHoursPerMonthMina;

  // Suggestions
  const suggestions: string[] = [];

  // Fleet Feasibility Check
  const totalCalendarDaysNeeded = routeResults.reduce((acc, curr) => acc + curr.fullFleetDaysNeeded, 0);
  const totalEffectiveHoursNeeded = routeResults.reduce((acc, curr) => acc + curr.fullFleetHoursNeeded, 0);
  
  const availableCalendarDays = premises.calendarDays;
  const availableEffectiveHours = effectiveHoursPerMonthMina;

  // We should also check the total fleet utilization vs all movement
  const totalTrucksNeeded = routeResults.reduce((acc, curr) => acc + curr.suggestedTrucks, 0);

  if (totalTrucksNeeded > totalTrucksAvailable) {
    suggestions.push(`FROTA INSUFICIENTE: A necessidade total de frota (${totalTrucksNeeded.toFixed(2)}) é superior à frota disponível (${totalTrucksAvailable}).`);
    suggestions.push(`Déficit de frota: ${(totalTrucksNeeded - totalTrucksAvailable).toFixed(2)} caminhões.`);
  } else {
    suggestions.push(`FROTA CAPAZ: A frota atual (${totalTrucksAvailable}) suporta a meta de movimentação.`);
    suggestions.push(`Folga de frota: ${(totalTrucksAvailable - totalTrucksNeeded).toFixed(2)} caminhões.`);
  }

  if (extraTrucks > 0) {
    suggestions.push(`FROTA FÍSICA NÃO ALOCADA: Você possui ${extraTrucks} caminhões não atribuídos a nenhum fluxo.`);
    if (allocatedExtraMonthlyProduction > 0) {
      suggestions.push(`ALOCAÇÃO EXTRA: ${allocatedExtraMonthlyProduction.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t/mês adicionais via alocação temporária.`);
    } else {
      suggestions.push(`Folga Operacional (Potencial): ${potentialExtraHourlyProduction.toFixed(2)} t/h.`);
    }
  }

  if (totalTrucksUsed > totalTrucksAvailable) {
    suggestions.push(`ALERTA: Você está usando ${totalTrucksUsed} caminhões, mas possui apenas ${totalTrucksAvailable} nas premissas.`);
  }
  
  suggestions.push("Dimensionamento de Frota Necessária:");
  routeResults.forEach(r => {
    suggestions.push(`- ${r.name}: ${r.suggestedTrucks.toFixed(2)} caminhões`);
  });
  
  if (romOverload) {
    suggestions.push(`ALERTA: A soma das massas planejadas nas frentes de ROM (${romMassSum.toLocaleString()} t) excede o limite do Consumo da Planta (${premises.targetMonthlyROM.toLocaleString()} t).`);
  }
  if (wasteOverload) {
    suggestions.push(`ALERTA: A soma das massas planejadas de Estéril (${wasteMassSum.toLocaleString()} t) excede a Meta de Estéril (${premises.targetMonthlyWasteRock.toLocaleString()} t).`);
  }

  suggestions.push(`TOTAL NECESSÁRIO: ${totalTrucksNeeded.toFixed(2)} caminhões`);

  // ─────────────────────────────────────────────────────────────────────
  //  PLANNED PRODUCTION (Baseline from Premises – what you WANT to do)
  //  The anchor: targetMonthlyROM = Consumo Planta (t/mês)
  //  = ROM that the mine must deliver to the plant
  //  Produto = ROM × rmGlobal%   (plant output goal)
  //  Rejeito = ROM × rejeitoTotal%  (tailings fleet goal)
  // ─────────────────────────────────────────────────────────────────────

  // Monthly plan (directly from premises)
  const plannedMonthlyROM    = premises.targetMonthlyROM;                                      // Mina entrega → Planta
  const plannedMonthlyPlanta = plannedMonthlyROM * (rmGlobal / 100);                           // Produto processado
  const plannedMonthlyRejeito= plannedMonthlyROM * (rejeitoTotal / 100);                       // Rejeito gerado
  const plannedMonthlyWaste  = (premises.hasWasteRock ? premises.targetMonthlyWasteRock : 0);

  // Hourly plan (÷ effective hours)
  const plannedHourlyROM     = effectiveHoursPerMonthMina   > 0 ? plannedMonthlyROM    / effectiveHoursPerMonthMina   : 0;
  const plannedHourlyPlanta  = effectiveHoursPerMonthPlanta > 0 ? plannedMonthlyPlanta / effectiveHoursPerMonthPlanta : 0;
  const plannedHourlyRejeito = effectiveHoursPerMonthPlanta > 0 ? plannedMonthlyRejeito/ effectiveHoursPerMonthPlanta : 0;
  const plannedHourlyWaste   = (premises.hasWasteRock && effectiveHoursPerMonthMina > 0) ? plannedMonthlyWaste / effectiveHoursPerMonthMina : 0;
  const plannedHourlyTotalFrota = plannedHourlyROM + plannedHourlyPlanta + plannedHourlyRejeito + plannedHourlyWaste;

  // Daily plan (× effective hours/day)
  const plannedDailyROM     = plannedHourlyROM     * jornadaEfetivaMina;
  const plannedDailyPlanta  = plannedHourlyPlanta  * jornadaEfetivaPlanta;
  const plannedDailyRejeito = plannedHourlyRejeito * jornadaEfetivaPlanta;
  const plannedDailyWaste   = plannedHourlyWaste   * jornadaEfetivaMina;
  const plannedDailyTotal   = plannedDailyROM + plannedDailyPlanta + plannedDailyRejeito + plannedDailyWaste;

  // ─────────────────────────────────────────────────────────────────────
  //  SIMULATED / ACTUAL FLEET PRODUCTION
  //  = What the fleet IS delivering right now (based on routes/trucks)
  //  ROM = fleet output (may be > or < target → stockpile or deficit)
  //  Planta = min(fleetROM, plantCapacity)   (plant can only absorb so much)
  //  Rejeito = what went THROUGH the plant × rejeitoTotal%
  // ─────────────────────────────────────────────────────────────────────

  const simulatedHourlyROM    = totalHourlyROM_Only;                                               // Raw fleet ROM delivery
  const simulatedDailyROM     = simulatedHourlyROM    * jornadaEfetivaMina;
  const simulatedMonthlyROM   = simulatedHourlyROM    * effectiveHoursPerMonthMina;

  // Plant processes only up to its physical limit (plantCapacityTPH)
  const simulatedHourlyPlanta = Math.min(simulatedHourlyROM, plantCapacityTPH);
  const simulatedDailyPlanta  = simulatedHourlyPlanta * jornadaEfetivaPlanta;
  const simulatedMonthlyPlanta= simulatedHourlyPlanta * effectiveHoursPerMonthPlanta;

  // Rejeito is derived from what ACTUALLY went through the plant
  const simulatedHourlyRejeito = simulatedHourlyPlanta * (rejeitoTotal / 100);
  const simulatedDailyRejeito  = simulatedHourlyRejeito * jornadaEfetivaPlanta;
  const simulatedMonthlyRejeito= simulatedHourlyRejeito * effectiveHoursPerMonthPlanta;

  // Waste rock (estéril) – limited only by the waste fleet
  const simulatedHourlyWaste   = totalHourlyWaste;
  const simulatedDailyWaste    = simulatedHourlyWaste * jornadaEfetivaMina;
  const simulatedMonthlyWaste  = simulatedHourlyWaste * effectiveHoursPerMonthMina;

  // Movimentação Total diária - FLEET (simulated, includes waste)
  const simulatedDailyTotal = simulatedDailyROM + simulatedDailyPlanta + simulatedDailyRejeito + simulatedDailyWaste;
  const totalDailyROM = simulatedDailyROM;

  // Movimentação Total diária - PLANEJADA (target-based)
  // = ROM_target_dia × (1 + rmGlobal% + rejeitoTotal%)
  // This is the total planned fleet work: mine→plant + plant→terminal + plant→baia
  const romTargetPerCalendarDay = premises.calendarDays > 0 ? premises.targetMonthlyROM / premises.calendarDays : 0;
  const movimentacaoTotalDiaria = romTargetPerCalendarDay * (1 + rmGlobal / 100 + rejeitoTotal / 100);
  
  // New Simulation Results (Possible vs Necessary)
  const totalWetMassNecessary = romResults.reduce((acc, curr) => acc + curr.wetMass, 0); // Target Feed Mass (ROM)
  const totalAllMovementWetMassNecessary = routeResults.reduce((acc, curr) => acc + curr.wetMass, 0); // Total Transport Work (ROM+Product+Tailings)
  
  // Possible Movement (Weighted Average)
  // ∑ (Massa – Base Úmida (t) × Frota – Produção Horária (t/h)) / ∑ (Massa – Base Úmida (t))
  const sumWetMassTimesHourlyProd = routeResults.reduce((acc, curr) => acc + (curr.wetMass * curr.fullFleetHourlyProduction), 0);
  const weightedHourlyProductionPossible = totalWetMassNecessary > 0 ? sumWetMassTimesHourlyProd / totalWetMassNecessary : 0;
  
  const totalWetMassPossible = weightedHourlyProductionPossible * effectiveHoursPerMonthMina;
  
  const productionHourlyPossible = weightedHourlyProductionPossible;
  const productionHourlyNecessary = effectiveHoursPerMonthMina > 0 ? totalWetMassNecessary / effectiveHoursPerMonthMina : 0;
  
  const productionDailyPossible = productionHourlyPossible * jornadaEfetivaMina;
  const productionDailyNecessary = productionHourlyNecessary * jornadaEfetivaMina;

  const simulationResults = {
    totalWetMassPossible,
    totalWetMassNecessary,
    productionHourlyPossible,
    productionHourlyNecessary,
    productionDailyPossible,
    productionDailyNecessary
  };

  // Monthly target from premises
  const monthlyTarget = premises.targetMonthlyROM;
  
  // Calculate Actual Production so far
  let totalActualProduction = 0;
  if (logs) {
    Object.values(logs).forEach(routeLogs => {
      if (routeLogs) {
        routeLogs.forEach(log => {
          if (log) {
            totalActualProduction += log.actualProduction || 0;
          }
        });
      }
    });
  }

  // Re-planning Logic
  const loggedDates = new Set<string>();
  if (logs) {
    Object.values(logs).forEach(routeLogs => {
      if (routeLogs) {
        routeLogs.forEach(log => {
          if (log && log.date) {
            loggedDates.add(log.date.split('T')[0]);
          }
        });
      }
    });
  }
  const daysPassed = loggedDates.size;
  const remainingDays = Math.max(0, premises.calendarDays - daysPassed);
  
  const remainingTarget = Math.max(0, monthlyTarget - totalActualProduction);
  
  // Required daily production to hit target
  const requiredDailyProduction = remainingDays > 0 ? remainingTarget / remainingDays : 0;
  
  // Check if required hourly production exceeds plant capacity
  const averageDailyHoursPlanta = premises.calendarDays > 0 ? horasCalendarioPlanta / premises.calendarDays : 24;
  const effectiveHoursPerDayPlanta = averageDailyHoursPlanta * eoPlantaFactor;
  const requiredHourlyProduction = effectiveHoursPerDayPlanta > 0 ? requiredDailyProduction / effectiveHoursPerDayPlanta : 0;
  
  const isTargetUnreachable = requiredHourlyProduction > plantCapacityTPH;
  const productionLoss = isTargetUnreachable ? remainingTarget - (plantCapacityTPH * effectiveHoursPerDayPlanta * remainingDays) : 0;
  const productionLossPlanta = productionLoss * (premises.rmGlobal / 100);
  const productionLossRejeito = productionLoss * (premises.rejeitoTotal / 100);

  // Re-planning suggestions
  if (isTargetUnreachable) {
    suggestions.push(`META INALCANÇÁVEL: A planta atingiu o limite de absorção (${plantCapacityTPH} t/h).`);
    suggestions.push(`A demanda horária necessária para os dias restantes (${requiredHourlyProduction.toFixed(2)} t/h) excede a capacidade da planta.`);
    suggestions.push(`Perda estimada de produção: ${productionLoss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} t`);
  } else if (requiredDailyProduction > actualDailyROM) {
    const diff = requiredDailyProduction - actualDailyROM;
    const percentIncrease = (diff / actualDailyROM) * 100;
    
    if (percentIncrease > 5) {
      suggestions.push(`Aumentar frota em aproximadamente ${Math.ceil(percentIncrease / 10)}%`);
      suggestions.push(`Melhorar Eficiência Operacional (atualmente ${premises.eoMina}%)`);
    }
  }

  // Plant capacity check
  // plantCapacityTPH is already declared above at line 119
  
  // Derived Fleet Limits based on Plant Capacity
  // plantCapacityTPH is already declared above at line 239
  
  // Use the values from premises as they are now calculated and capped in the form
  const maxFleetCapacityMinaTPH = premises.fleetCapacityMinaTPH;
  const maxFleetCapacityTerminalTPH = premises.fleetCapacityTerminalTPH;
  const maxFleetCapacityBaiaTPH = premises.fleetCapacityBaiaTPH;
  const maxTotalFleetCapacityTPH = maxFleetCapacityMinaTPH + maxFleetCapacityTerminalTPH + maxFleetCapacityBaiaTPH;

  const isPlantOverloaded = totalHourlyROM > plantCapacityTPH;
  const rawPlantUtilization = (totalHourlyROM / plantCapacityTPH) * 100;
  const plantUtilization = Math.min(rawPlantUtilization, 100);
  const plantOverload = Math.max(0, rawPlantUtilization - 100);

  // Total Fleet Demand (ROM + Product + Tailings)
  const productHourly = totalHourlyROM * (rmGlobal / 100);
  const tailingsHourly = totalHourlyROM * (rejeitoTotal / 100);
  const totalFleetDemandTPH = totalHourlyROM + productHourly + tailingsHourly;

  // Fleet capacity check against derived limits
  const isFleetOverloaded = totalFleetDemandTPH > maxTotalFleetCapacityTPH;
  const rawFleetUtilization = maxTotalFleetCapacityTPH > 0 ? (totalFleetDemandTPH / maxTotalFleetCapacityTPH) * 100 : 0;
  const fleetUtilization = Math.min(rawFleetUtilization, 100);
  const fleetOverload = Math.max(0, rawFleetUtilization - 100);

  if (isPlantOverloaded) {
    suggestions.push(`ALERTA CRÍTICO: Produção da Mina (${totalHourlyROM.toFixed(1)} t/h) excede Capacidade da Planta (${plantCapacityTPH} t/h).`);
    suggestions.push(`O sistema não permite expansão de frota real além deste limite.`);
  }

  // Original Daily Targets (Fixed)
  const originalDailyMina = premises.calendarDays > 0 ? monthlyTarget / premises.calendarDays : 0;
  const originalDailyPlanta = originalDailyMina * (rmGlobal / 100);
  const originalDailyRejeito = originalDailyMina * (rejeitoTotal / 100);

  // Daily Breakdown for Calendar and Logging
  const dailyBreakdown: any[] = [];
  let currentRemainingTarget = monthlyTarget;
  
  const totalDays = premises.calendarDays;

  premises.dailyCalendar.forEach((dayData, index) => {
    if (!dayData || !dayData.date) return;
    const dateStr = dayData.date.split('T')[0];
    const dayLogs = Object.values(logs).flatMap(routeLogs => 
      (routeLogs || []).filter(log => log && log.date && log.date.split('T')[0] === dateStr)
    );
    const actualMina = dayLogs.reduce((acc, curr) => acc + curr.actualProduction, 0);
    const actualPlanta = dayLogs.reduce((acc, curr) => acc + (curr.actualPlanta || 0), 0);
    const actualRejeito = dayLogs.reduce((acc, curr) => acc + (curr.actualRejeito || 0), 0);
    const hasLog = dayLogs.length > 0;

    // Planned Production (Actual/Realistic Plan based on simulation)
    // Planned Production (Baseline Meta from Premises)
    const plannedMina = plannedDailyROM;
    const plannedPlanta = plannedDailyPlanta;
    const plannedRejeito = plannedDailyRejeito;

    // Re-planned / Required (Dynamic for future days)
    let requiredMina = 0;
    let requiredPlanta = 0;
    let requiredRejeito = 0;
    let isPlantLimited = false;

    if (!hasLog) {
      // Find how many unlogged days are left from this point onwards
      let unloggedDaysFromHere = 0;
      for(let i = index; i < totalDays; i++) {
        const day = premises.dailyCalendar[i];
        if (!day || !day.date) continue;
        const dStr = day.date.split('T')[0];
        const dHasLog = Object.values(logs).some(rl => rl && rl.some(l => l && l.date && l.date.split('T')[0] === dStr));
        if (!dHasLog) unloggedDaysFromHere++;
      }

      const rawRequiredMina = unloggedDaysFromHere > 0 ? currentRemainingTarget / unloggedDaysFromHere : 0;
      
      const effectiveHoursPlanta = dayData.hoursPlanta * eoPlantaFactor;
      const maxPlantaCapacity = premises.plantFeedRateTPH * effectiveHoursPlanta;
      
      requiredMina = Math.min(rawRequiredMina, maxPlantaCapacity);
      isPlantLimited = rawRequiredMina > maxPlantaCapacity;
      requiredPlanta = requiredMina * (rmGlobal / 100);
      requiredRejeito = requiredMina * (rejeitoTotal / 100);
      
      currentRemainingTarget -= requiredMina;
    } else {
      currentRemainingTarget -= actualMina;
      requiredMina = actualMina;
      requiredPlanta = actualPlanta;
      requiredRejeito = actualRejeito;
    }

    dailyBreakdown.push({
      date: dayData.date,
      plannedMina,
      plannedPlanta,
      plannedRejeito,
      requiredMina,
      requiredPlanta,
      requiredRejeito,
      actualMina: hasLog ? actualMina : null,
      actualPlanta: hasLog ? actualPlanta : null,
      actualRejeito: hasLog ? actualRejeito : null,
      hoursMina: dayData.hoursMina,
      hoursPlanta: dayData.hoursPlanta,
      isPlantLimited
    });
  });

  return {
    totalHourlyROM,
    totalDailyROM,
    actualDailyROM,
    totalMonthlyROM: plannedMonthlyROM,
    plannedHourlyROM,
    plannedHourlyPlanta,
    plannedHourlyRejeito,
    plannedHourlyTotalFrota,
    plannedDailyROM,
    plannedDailyPlanta,
    plannedDailyRejeito,
    plannedDailyWaste,
    plannedDailyTotal,
    plannedMonthlyROM,
    plannedMonthlyPlanta,
    plannedMonthlyRejeito,
    plannedMonthlyWaste,
    plannedMonthlyTotal: plannedMonthlyROM + plannedMonthlyPlanta + plannedMonthlyRejeito + plannedMonthlyWaste,
    simulatedHourlyROM,
    simulatedDailyROM,
    simulatedMonthlyROM,
    simulatedHourlyPlanta,
    simulatedDailyPlanta,
    simulatedMonthlyPlanta,
    simulatedHourlyRejeito,
    simulatedDailyRejeito,
    simulatedMonthlyRejeito,
    simulatedHourlyWaste,
    simulatedDailyWaste,
    simulatedMonthlyWaste,
    simulatedDailyTotal,
    totalActualProduction,
    remainingTarget,
    requiredDailyProduction,
    requiredHourlyProduction,
    operationalSlack: Math.max(0, plantCapacityTPH - totalHourlyROM_Only),
    fleetSlack: Math.max(0, totalTrucksAvailable - totalTrucksNeeded),
    isTargetAtRisk: requiredDailyProduction > actualDailyROM,
    isTargetUnreachable,
    productionLoss,
    productionLossPlanta,
    productionLossRejeito,
    isPlantOverloaded,
    plantCapacityTPH,
    plantUtilization,
    maxFleetCapacityMinaTPH,
    maxFleetCapacityTerminalTPH,
    maxFleetCapacityBaiaTPH,
    maxTotalFleetCapacityTPH,
    totalFleetCapacityTPH: maxTotalFleetCapacityTPH,
    isFleetOverloaded,
    fleetUtilization,
    totalTrucksNeeded,
    totalTrucksAvailable,
    suggestions,
    routeResults,
    totalCalendarDaysNeeded,
    totalEffectiveHoursNeeded,
    totalEffectiveDaysNeeded: totalEffectiveHoursNeeded / 24,
    extraTrucks,
    allocatedExtraHourlyProduction,
    allocatedExtraDailyProduction: allocatedExtraHourlyProduction * jornadaEfetivaMina,
    allocatedExtraMonthlyProduction,
    potentialExtraHourlyProduction,
    potentialExtraDailyProduction,
    potentialExtraMonthlyProduction,
    totalPossibleHourlyMovement,
    totalPossibleDailyMovement,
    totalPossibleMonthlyMovement,
    hourlyStockpile,
    dailyStockpile,
    monthlyStockpile,
    daysPassed,
    remainingDays,
    effectiveCalendarDaysMina,
    effectiveCalendarDaysPlanta,
    effectiveHoursPerMonthMina,
    effectiveHoursPerMonthPlanta,
    effectiveHoursPerDayPlanta,
    jornadaEfetivaMina,
    jornadaEfetivaPlanta,
    simulationResults,
    loggedDates: Array.from(loggedDates),
    dailyBreakdown,
    diagnostic: generateDiagnostic(totalHourlyROM_Only, plantCapacityTPH, totalTrucksNeeded, totalTrucksAvailable, effectiveHoursPerMonthMina, premises.targetMonthlyROM),
    totalHourlyAllMovement,
    totalPossibleMonthlyAllMovement,
    totalAllMovementWetMassNecessary,
    totalGrossHourlyMinaCapacity,
    movimentacaoTotalDiaria
  };
}

function generateDiagnostic(
  mineHourlyProd: number, 
  plantCapacity: number, 
  trucksNeeded: number, 
  trucksAvailable: number, 
  availableHours: number,
  monthlyTarget: number
): OperationalDiagnostic {
  // 1. Hierarchy: Plant > Fleet
  const isPlantBottleneck = mineHourlyProd > plantCapacity;
  const isFleetDeficit = trucksNeeded > trucksAvailable;
  
  // 2. Stockpile (Pilha Pulmão)
  const stockpileRateTPH = Math.max(0, mineHourlyProd - plantCapacity);
  const stockpileMonthlyTons = stockpileRateTPH * availableHours;
  const stockpilePercent = mineHourlyProd > 0 ? (stockpileRateTPH / mineHourlyProd) * 100 : 0;

  // 3. Utilization & Overload
  const rawFleetUtil = trucksAvailable > 0 ? trucksNeeded / trucksAvailable : 0;
  const fleetUtilization = Math.min(rawFleetUtil, 1.0) * 100;
  const fleetOverload = Math.max(0, rawFleetUtil - 1.0) * 100;

  const rawPlantUtil = plantCapacity > 0 ? mineHourlyProd / plantCapacity : 0;
  const plantUtilization = Math.min(rawPlantUtil, 1.0) * 100;
  const plantOverload = Math.max(0, rawPlantUtil - 1.0) * 100;

  // 4. Efficiency
  // Global efficiency reflects processed vs target
  const processedHourly = Math.min(mineHourlyProd, plantCapacity);
  const productionEfficiency = monthlyTarget > 0 ? (processedHourly * availableHours / monthlyTarget) * 100 : 0;

  // 5. Inviability
  const isInviable = trucksNeeded > trucksAvailable;
  let inviabilityReason = '';
  if (isInviable) {
    inviabilityReason = `Cenário Operacional Inviável: Necessidade de frota (${trucksNeeded.toFixed(2)}) superior à capacidade física disponível (${trucksAvailable}).`;
  }

  // 6. Diagnosis Classification
  let status: 'balanced' | 'idle_fleet' | 'plant_bottleneck' | 'unbalanced' | 'critical' = 'balanced';
  let label = 'Operação Balanceada';
  let color = 'emerald';
  let description = 'O sistema está operando em equilíbrio entre mina e planta.';
  const impacts: string[] = [];
  const recommendations: string[] = [];

  // Hierarchy: Plant Bottleneck takes precedence
  if (isPlantBottleneck) {
    status = 'plant_bottleneck';
    label = 'Gargalo na Planta';
    color = 'amber';
    description = 'A planta é o gargalo dominante. A produção da mina excede a capacidade de processamento.';
    impacts.push(`Geração de Pilha Pulmão: ${stockpileRateTPH.toFixed(1)} t/h (${stockpileMonthlyTons.toLocaleString()} t/mês).`);
    impacts.push(`${stockpilePercent.toFixed(1)}% da produção da mina não está sendo processada.`);
    recommendations.push('Reduzir o ritmo de lavra na mina para equalizar com a capacidade da planta.');
    recommendations.push('O dimensionamento de frota deve ser condicionado à capacidade da planta para evitar custos excessivos.');
  } else if (isFleetDeficit) {
    status = 'critical';
    label = 'Déficit de Frota';
    color = 'red';
    description = 'A restrição do sistema está no transporte (frota insuficiente).';
    impacts.push(`Déficit de ${(trucksNeeded - trucksAvailable).toFixed(2)} caminhões para atingir a meta.`);
    recommendations.push('Aumentar a frota disponível ou melhorar a produtividade unitária dos equipamentos.');
  } else if (rawFleetUtil < 0.85) {
    status = 'idle_fleet';
    label = 'Capacidade de Transporte Sobrando';
    color = 'blue';
    description = 'Sua frota física é maior do que o necessário para a meta atual.';
    impacts.push(`Ociosidade de ${(100 - fleetUtilization).toFixed(1)}% na frota física.`);
    recommendations.push('Você tem caminhões sobrando que poderiam ser usados para aumentar a meta ou cobrir manutenções.');
  }

  if (isInviable && status !== 'plant_bottleneck') {
    status = 'critical';
    label = 'Cenário Inviável';
    color = 'red';
  }

  return {
    status,
    label,
    color,
    description,
    impacts,
    recommendations,
    isInviable,
    inviabilityReason,
    indicators: {
      fleetUtilization,
      fleetOverload,
      bottleneckIndex: plantCapacity > 0 ? mineHourlyProd / plantCapacity : 0,
      balanceIndex: plantCapacity > 0 ? mineHourlyProd / plantCapacity : 0,
      productionEfficiency,
      operationalSurplusTPH: plantCapacity - mineHourlyProd,
      operationalSurplusMonthly: (plantCapacity - mineHourlyProd) * availableHours,
      stockpileRateTPH,
      stockpileMonthlyTons,
      stockpilePercent,
      plantUtilization,
      plantOverload,
      apparentTerminalFlowTPH: mineHourlyProd
    }
  };
}
