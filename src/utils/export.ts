import { DetailedPremises, Route, DailyLog } from "../types";

export const generatePortableHTML = (
  premises: DetailedPremises,
  routes: Route[],
  productionLogs: Record<string, DailyLog[]>,
  results: any
) => {
  const initialState = {
    premises,
    routes,
    productionLogs,
    results
  };

    // Safety check: Ensure we don't have circular references or backticks that break the template
    // Also escape </script> to prevent breaking the HTML structure
    const stateString = JSON.stringify(initialState)
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\${/g, '\\${')
      .replace(/<\/script>/g, '<\\/script>');

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Simulador de Frota Portátil - ${premises.targetMonthlyROM.toLocaleString()}t</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; background-color: #f1f5f9; color: #0f172a; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .glass { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.3); }
        .card { background: white; border-radius: 32px; padding: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); transition: all 0.3s ease; }
        .card:hover { transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1); }
        .kpi-value { font-size: 2.5rem; font-weight: 900; letter-spacing: -0.05em; line-height: 1; }
        .status-badge { padding: 6px 16px; border-radius: 9999px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.05em; }
        input[type="range"] { -webkit-appearance: none; width: 100%; height: 8px; background: #e2e8f0; border-radius: 5px; outline: none; }
        input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; background: #2563eb; cursor: pointer; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    </style>
</head>
<body class="p-4 md:p-12 pb-24">
    <div id="app" class="max-w-7xl mx-auto space-y-8">
        <!-- Header -->
        <header class="flex flex-col md:flex-row justify-between items-center gap-6 bg-white p-8 rounded-[40px] border border-slate-200 shadow-sm">
            <div class="text-center md:text-left">
                <div class="flex items-center gap-3 justify-center md:justify-start mb-2">
                    <div class="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center text-white font-black italic">S</div>
                    <h1 class="text-3xl font-black uppercase tracking-tighter text-slate-900">Simulador Portátil</h1>
                </div>
                <p class="text-slate-400 font-bold text-[10px] uppercase tracking-[0.2em]">Versão Offline • Gerada em ${new Date().toLocaleString('pt-BR')}</p>
            </div>
            <div class="flex items-center gap-4">
                <div id="targetStatus" class="status-badge">Carregando...</div>
                <button onclick="window.print()" class="px-6 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all">Imprimir PDF</button>
            </div>
        </header>

        <!-- Interactive Controls -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div class="card bg-blue-50/50 border-blue-100">
                <h2 class="text-xs font-black uppercase tracking-widest text-blue-600 mb-6 flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    Simulação de Cenários Rápidos
                </h2>
                <div class="space-y-8">
                    <div>
                        <div class="flex justify-between mb-4">
                            <label class="text-sm font-bold text-slate-700">Meta Mensal ROM (t)</label>
                            <span id="targetVal" class="font-mono font-black text-blue-600">0</span>
                        </div>
                        <input type="range" id="targetSlider" min="10000" max="1000000" step="5000">
                    </div>
                    <div>
                        <div class="flex justify-between mb-4">
                            <label class="text-sm font-bold text-slate-700">Capacidade Planta (t/h)</label>
                            <span id="plantVal" class="font-mono font-black text-blue-600">0</span>
                        </div>
                        <input type="range" id="plantSlider" min="50" max="1000" step="10">
                    </div>
                </div>
            </div>
            <div class="card bg-slate-900 text-white border-none">
                <h2 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">Diagnóstico Operacional</h2>
                <div id="diagnosticContent" class="space-y-4">
                    <p id="diagLabel" class="text-2xl font-black italic tracking-tight">Carregando...</p>
                    <p id="diagDesc" class="text-sm text-slate-400 leading-relaxed"></p>
                    <div id="diagRecs" class="space-y-2 pt-4"></div>
                </div>
            </div>
        </div>

        <!-- Main KPIs -->
        <div id="kpiGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <!-- Dynamic KPIs will be injected here -->
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <!-- Chart -->
            <div class="lg:col-span-2 card">
                <h2 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">Projeção de Produção Semanal</h2>
                <canvas id="productionChart" height="250"></canvas>
            </div>

            <!-- Fleet Summary -->
            <div class="card space-y-6">
                <h2 class="text-xs font-black uppercase tracking-widest text-slate-400">Resumo da Frota</h2>
                <div class="space-y-4">
                    <div class="flex justify-between items-center py-3 border-b border-slate-100">
                        <span class="text-sm text-slate-500">Frota Física</span>
                        <span id="physicalFleet" class="font-mono font-black text-lg">0</span>
                    </div>
                    <div class="flex justify-between items-center py-3 border-b border-slate-100">
                        <span class="text-sm text-slate-500">Frota Necessária</span>
                        <span id="neededFleet" class="font-mono font-black text-lg text-blue-600">0</span>
                    </div>
                    <div class="flex justify-between items-center py-3">
                        <span class="text-sm text-slate-500">Folga/Déficit</span>
                        <span id="fleetSlack" class="font-mono font-black text-lg">0</span>
                    </div>
                </div>
                <div id="fleetAlert" class="p-4 rounded-2xl text-xs font-bold uppercase tracking-widest text-center"></div>
            </div>
        </div>

        <!-- Route Table -->
        <div class="card overflow-hidden">
            <h2 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-6">Detalhamento das Rotas</h2>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="text-[10px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                            <th class="pb-4 px-2">Rota</th>
                            <th class="pb-4 px-2">Distância</th>
                            <th class="pb-4 px-2">Frota Alocada</th>
                            <th class="pb-4 px-2">Prod. Horária</th>
                            <th class="pb-4 px-2">Dias Necessários</th>
                            <th class="pb-4 px-2">Status</th>
                        </tr>
                    </thead>
                    <tbody id="routeTableBody" class="text-sm">
                        <!-- Rows injected here -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        // --- DATA & LOGIC ---
        const state = ${stateString};
        let currentTarget = state.premises.targetMonthlyROM;
        let currentPlantRate = state.premises.plantFeedRateTPH;
        let chart = null;

        // Core Calculation Engine (Ported from calculations.ts)
        function calculateRouteProduction(route, premises, effectiveHours) {
            if (!route.active) return { hourlyProduction: 0, suggestedTrucks: 0, wetMass: 0, fullFleetDaysNeeded: 0 };
            
            const truckEO = (route.mechanicalAvailability / 100) * (route.operationalEfficiency / 100);
            const cycleTime = route.cycleTime || 1;
            const truckCapacity = route.truckCapacity || 1;
            
            const unitaryProductivity = (60 / cycleTime) * truckCapacity;
            const wetMass = (route.targetMass || 0) * (1 + (premises.umidadeNatural + premises.perdaMaterial) / 100);
            
            const hourlyProduction = (60 / cycleTime) * route.truckCount * truckEO * truckCapacity;
            const dailyProduction = hourlyProduction * 24;
            const fullFleetDaysNeeded = dailyProduction > 0 ? wetMass / dailyProduction : 0;
            
            const siteEO = (premises.dfMina / 100) * (premises.ufMina / 100);
            const suggestedTrucks = (unitaryProductivity > 0 && effectiveHours > 0) 
                ? (wetMass / unitaryProductivity) / effectiveHours 
                : 0;
            
            const adjustedSuggested = (truckEO > 0) ? suggestedTrucks * (siteEO / truckEO) : suggestedTrucks;

            return { hourlyProduction, suggestedTrucks: adjustedSuggested, wetMass, fullFleetDaysNeeded };
        }

        function generateDiagnostic(mineHourlyProd, plantCapacity, trucksNeeded, trucksAvailable, availableHours, monthlyTarget) {
            const isPlantBottleneck = mineHourlyProd > plantCapacity;
            const isFleetDeficit = trucksNeeded > trucksAvailable;
            const stockpileRateTPH = Math.max(0, mineHourlyProd - plantCapacity);
            const stockpileMonthlyTons = stockpileRateTPH * availableHours;
            
            const rawFleetUtil = trucksAvailable > 0 ? trucksNeeded / trucksAvailable : 0;
            const fleetUtilization = Math.min(rawFleetUtil, 1.0) * 100;
            
            const processedHourly = Math.min(mineHourlyProd, plantCapacity);
            const productionEfficiency = monthlyTarget > 0 ? (processedHourly * availableHours / monthlyTarget) * 100 : 0;

            let status = 'balanced';
            let label = 'Operação Balanceada';
            let color = 'emerald';
            let description = 'O sistema está operando em equilíbrio entre mina e planta.';
            const impacts = [];
            const recommendations = [];

            if (isPlantBottleneck) {
                status = 'plant_bottleneck';
                label = 'Gargalo na Planta';
                color = 'amber';
                description = 'A planta é o gargalo dominante. A produção da mina excede a capacidade de processamento.';
                impacts.push(\`Geração de Pilha Pulmão: \${stockpileRateTPH.toFixed(1)} t/h (\${stockpileMonthlyTons.toLocaleString()} t/mês).\`);
                recommendations.push('Reduzir o ritmo de lavra na mina para equalizar com a capacidade da planta.');
            } else if (isFleetDeficit) {
                status = 'critical';
                label = 'Déficit de Frota';
                color = 'red';
                description = 'A restrição do sistema está no transporte (frota insuficiente).';
                impacts.push(\`Déficit de \${(trucksNeeded - trucksAvailable).toFixed(1)} caminhões para atingir a meta.\`);
                recommendations.push('Aumentar a frota disponível ou melhorar a produtividade unitária.');
            }

            return { status, label, color, description, impacts, recommendations, indicators: { fleetUtilization, productionEfficiency, stockpileRateTPH } };
        }

        function calculateResults() {
            const premises = { ...state.premises, targetMonthlyROM: currentTarget, plantFeedRateTPH: currentPlantRate };
            const eoMina = (premises.dfMina / 100) * (premises.ufMina / 100);
            const eoPlanta = (premises.dfPlanta / 100) * (premises.ufPlanta / 100);
            
            const effectiveHoursMina = premises.calendarDays * 24 * eoMina;
            const effectiveHoursPlanta = premises.calendarDays * 24 * eoPlanta;

            const routes = state.routes.map(r => {
                let target = r.targetMass;
                if (!target) {
                    const n = r.name.toLowerCase();
                    if (n.includes('terminal')) target = currentTarget * (premises.rmGlobal / 100);
                    else if (n.includes('baia')) target = currentTarget * (premises.rejeitoTotal / 100);
                    else target = currentTarget;
                }
                const res = calculateRouteProduction({ ...r, targetMass: target }, premises, effectiveHoursMina);
                return { ...r, ...res };
            });

            const totalHourlyROM = routes.reduce((acc, r) => acc + r.hourlyProduction, 0);
            const totalTrucksNeeded = routes.reduce((acc, r) => acc + r.suggestedTrucks, 0);
            const plantCapacity = currentPlantRate;
            
            const simulatedHourlyROM = Math.min(totalHourlyROM, plantCapacity);
            const simulatedMonthlyROM = simulatedHourlyROM * effectiveHoursMina;
            
            const diagnostic = generateDiagnostic(totalHourlyROM, plantCapacity, totalTrucksNeeded, premises.truckCount, effectiveHoursMina, currentTarget);
            
            return { routes, totalHourlyROM, totalTrucksNeeded, simulatedMonthlyROM, plantCapacity, effectiveHoursMina, diagnostic };
        }

        // --- UI UPDATES ---
        function updateUI() {
            const results = calculateResults();
            
            // Sliders
            document.getElementById('targetVal').innerText = currentTarget.toLocaleString('pt-BR') + ' t';
            document.getElementById('plantVal').innerText = currentPlantRate + ' t/h';

            // Status Badge
            const statusBadge = document.getElementById('targetStatus');
            const isAtRisk = results.simulatedMonthlyROM < currentTarget * 0.98;
            statusBadge.innerText = isAtRisk ? 'Meta em Risco' : 'Meta Alcançável';
            statusBadge.className = \`status-badge \${isAtRisk ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}\`;

            // KPIs
            const kpiGrid = document.getElementById('kpiGrid');
            const kpis = [
                { label: 'ROM Mensal', val: results.simulatedMonthlyROM.toLocaleString('pt-BR'), unit: 't/mês', color: 'slate' },
                { label: 'Prod. Horária', val: results.totalHourlyROM.toFixed(1), unit: 't/h', color: 'blue' },
                { label: 'Util. Planta', val: ((results.totalHourlyROM / results.plantCapacity) * 100).toFixed(1) + '%', unit: 'Eficiência', color: 'emerald' },
                { label: 'Frota Sugerida', val: results.totalTrucksNeeded.toFixed(1), unit: 'Caminhões', color: 'amber' }
            ];
            
            kpiGrid.innerHTML = kpis.map(k => \`
                <div class="card">
                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">\${k.label}</p>
                    <p class="kpi-value text-\${k.color}-600">\${k.val}</p>
                    <p class="text-xs text-slate-400 mt-2">\${k.unit}</p>
                </div>
            \`).join('');

            // Fleet Summary
            document.getElementById('physicalFleet').innerText = state.premises.truckCount;
            document.getElementById('neededFleet').innerText = results.totalTrucksNeeded.toFixed(1);
            const slack = state.premises.truckCount - results.totalTrucksNeeded;
            const slackEl = document.getElementById('fleetSlack');
            slackEl.innerText = slack.toFixed(1);
            slackEl.className = \`font-mono font-black text-lg \${slack >= 0 ? 'text-emerald-600' : 'text-red-600'}\`;
            
            const alertEl = document.getElementById('fleetAlert');
            alertEl.innerText = slack >= 0 ? 'Frota Suficiente' : 'Frota Insuficiente';
            alertEl.className = \`p-4 rounded-2xl text-xs font-bold uppercase tracking-widest text-center \${slack >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}\`;

            // Diagnostic
            const diag = results.diagnostic;
            document.getElementById('diagLabel').innerText = diag.label;
            document.getElementById('diagLabel').className = \`text-2xl font-black italic tracking-tight text-\${diag.color}-400\`;
            document.getElementById('diagDesc').innerText = diag.description + (diag.impacts.length > 0 ? ' ' + diag.impacts.join(' ') : '');
            
            const recs = diag.recommendations;
            document.getElementById('diagRecs').innerHTML = recs.map(r => \`
                <div class="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <div class="w-1 h-1 bg-current rounded-full"></div> \${r}
                </div>
            \`).join('');

            // Table
            document.getElementById('routeTableBody').innerHTML = results.routes.map(r => \`
                <tr class="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td class="py-4 px-2 font-bold text-slate-700">\${r.name}</td>
                    <td class="py-4 px-2 font-mono text-slate-500">\${r.distance}m</td>
                    <td class="py-4 px-2 font-mono font-bold">\${r.truckCount}</td>
                    <td class="py-4 px-2 font-mono text-blue-600">\${r.hourlyProduction.toFixed(1)} t/h</td>
                    <td class="py-4 px-2 font-mono">\${r.fullFleetDaysNeeded.toFixed(1)}d</td>
                    <td class="py-4 px-2">
                        <span class="status-badge \${r.truckCount >= r.suggestedTrucks ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}">
                            \${r.truckCount >= r.suggestedTrucks ? 'Otimizado' : 'Déficit'}
                        </span>
                    </td>
                </tr>
            \`).join('');

            updateChart(results.simulatedMonthlyROM);
        }

        function updateChart(monthlyTotal) {
            const data = [
                (monthlyTotal / 4 * 0.95).toFixed(0),
                (monthlyTotal / 4 * 1.05).toFixed(0),
                (monthlyTotal / 4 * 0.98).toFixed(0),
                (monthlyTotal / 4 * 1.02).toFixed(0)
            ];
            
            if (!chart) {
                const ctx = document.getElementById('productionChart').getContext('2d');
                chart = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'],
                        datasets: [{
                            label: 'Produção (t)',
                            data: data,
                            borderColor: '#2563eb',
                            backgroundColor: 'rgba(37, 99, 235, 0.1)',
                            fill: true,
                            tension: 0.4,
                            borderWidth: 4,
                            pointRadius: 6,
                            pointBackgroundColor: '#fff',
                            pointBorderColor: '#2563eb',
                            pointBorderWidth: 3
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: {
                            y: { beginAtZero: false, grid: { display: false } },
                            x: { grid: { display: false } }
                        }
                    }
                });
            } else {
                chart.data.datasets[0].data = data;
                chart.update();
            }
        }

        // --- INITIALIZATION ---
        document.getElementById('targetSlider').value = currentTarget;
        document.getElementById('plantSlider').value = currentPlantRate;

        document.getElementById('targetSlider').oninput = (e) => {
            currentTarget = parseInt(e.target.value);
            updateUI();
        };
        document.getElementById('plantSlider').oninput = (e) => {
            currentPlantRate = parseInt(e.target.value);
            updateUI();
        };

        updateUI();
    </script>
</body>
</html>
  `;

  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `software_portatil_${new Date().toISOString().split('T')[0]}.html`);
  document.body.appendChild(link);
  link.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 100);
};
