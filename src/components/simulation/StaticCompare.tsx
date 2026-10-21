import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Play } from 'lucide-react';
import type { DetailedPremises, Route, RouteKind } from '@/types';
import type { SimModel } from '@/sim/types';
import type { SizedCircuit } from '@/sim/des';
import { analyzeFleet, routeKind, type RouteAnalysis } from '@/engine/fleet';
import type { CircuitCalc, Flow } from '@/sim/link';
import { runInWorker } from '@/sim/client';
import { Btn, Card, Progress, n1, t0 } from './ui';

/**
 * Compara o 2. Dimensionamento (cálculo estático pelo ciclo médio) com a simulação de eventos discretos,
 * mostra de onde vem a diferença e permite levar a frota e o ciclo da simulação para o Dimensionamento.
 */

const FLOW_TO_KIND: Record<Flow, RouteKind | null> = { rom: 'rom', produto: 'product', rejeito: 'tailings', esteril: 'waste', outro: null };

interface Props {
  model: SimModel;
  premises: DetailedPremises;
  calc: CircuitCalc[];
  sel: { configId: string; scenarioId: string };
  routes?: Route[];
  setRoutes?: (r: Route[]) => void;
  onError: (m: string | null) => void;
}

const StaticCompare: React.FC<Props> = ({ model, premises, calc, sel, routes, setRoutes, onError }) => {
  const [busy, setBusy] = useState<number | null>(null);
  const [sized, setSized] = useState<SizedCircuit[] | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const analysis = useMemo(() => (routes ? analyzeFleet(routes, premises) : null), [routes, premises]);

  // circuito → rota do Dimensionamento do mesmo fluxo (na ordem em que aparecem)
  const match = useMemo(() => {
    const out = new Map<string, RouteAnalysis>();
    if (!analysis || !routes) return out;
    const used = new Set<string>();
    for (const c of calc) {
      const kind = FLOW_TO_KIND[c.flow];
      if (!kind) continue;
      const a = analysis.routes.find((x) => x.kind === kind && !used.has(x.id));
      if (a) {
        used.add(a.id);
        out.set(c.circuitId, a);
      }
    }
    return out;
  }, [analysis, routes, calc]);

  const run = async () => {
    onError(null);
    setApplied(null);
    setBusy(0);
    try {
      const targets = Object.fromEntries(calc.map((c) => [c.circuitId, c.workDays > 0 ? c.tonnes / c.workDays : 0]));
      const start = Object.fromEntries(calc.map((c) => [c.circuitId, Math.max(1, c.trucks)]));
      const res = await runInWorker<SizedCircuit[]>({ kind: 'sizeCircuits', model, configId: sel.configId, scenarioId: sel.scenarioId, targets, start }, (f) => setBusy(f));
      setSized(res);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const apply = () => {
    if (!sized || !routes || !setRoutes) return;
    const byRoute = new Map<string, SizedCircuit>();
    for (const s of sized) {
      const a = match.get(s.circuitId);
      if (a) byRoute.set(a.id, s);
    }
    const names: string[] = [];
    setRoutes(
      routes.map((r) => {
        const s = byRoute.get(r.id);
        if (!s) return r;
        names.push(`${r.name}: ${s.trucks} caminhões, ciclo ${n1(s.cycleMin)} min`);
        return { ...r, truckCount: s.trucks, fleetMode: 'manual', isManualOverride: true, cycleMode: 'informed', cycleTime: Math.round(s.cycleMin * 100) / 100 };
      }),
    );
    setApplied(names.length ? `Aplicado no 2. Dimensionamento — ${names.join(' · ')}. O ciclo das rotas passou a “informado” (o da simulação); para voltar ao calculado, edite a rota.` : 'Nenhuma rota do Dimensionamento corresponde aos circuitos (fluxos diferentes).');
  };

  const cfgName = model.configs.find((c) => c.id === sel.configId)?.name ?? '';
  const scName = model.scenarios.find((s) => s.id === sel.scenarioId)?.name ?? '';

  return (
    <Card
      title="Simulação × 2. Dimensionamento"
      description={`Por que a simulação pede outra frota? Dimensiona cada circuito pela simulação (${cfgName} · ${scName}) e compara, item a item, com o cálculo estático do 2. Dimensionamento.`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => void run()} busy={busy !== null}>
            <Play size={15} /> Dimensionar pela simulação
          </Btn>
          {sized && setRoutes && match.size > 0 && (
            <Btn tone="light" onClick={apply}>
              <ArrowLeftRight size={15} /> Usar no 2. Dimensionamento
            </Btn>
          )}
        </div>
      }
    >
      {busy !== null && <Progress value={busy} label="Procurando a menor frota de cada circuito…" />}
      {!routes && <p className="text-sm text-black/50">As rotas do 2. Dimensionamento não estão disponíveis nesta tela.</p>}
      {!sized && busy === null && (
        <p className="text-sm text-black/55">
          O 2. Dimensionamento usa um ciclo médio fixo (DMT ÷ velocidade média + tempos + fila das premissas). A simulação usa a rota real (rampas e distância do DXF), filas que se formam quando os caminhões chegam juntos,
          quebras ao acaso e as paradas programadas. Clique em “Dimensionar pela simulação” para ver, circuito a circuito, quanto cada uma dessas diferenças pesa.
        </p>
      )}
      {sized && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-xs text-black/45">
                  <th className="py-1.5 pr-2 font-medium">Circuito / rota</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Meta (t úmida/mês)<br />estático · simulação</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Distância (m)<br />DMT · rota</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Ciclo (min)<br />estático · simulação</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Horas produtivas por caminhão<br />estático · simulação</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Caminhões<br />estático · simulação</th>
                  <th className="py-1.5 font-medium">O que mais pesa</th>
                </tr>
              </thead>
              <tbody>
                {sized.map((s) => {
                  const c = calc.find((x) => x.circuitId === s.circuitId)!;
                  const a = match.get(s.circuitId);
                  const name = model.circuits.find((x) => x.id === s.circuitId)?.name ?? s.circuitId;
                  const route = model.routes.find((r) => r.id === model.circuits.find((x) => x.id === s.circuitId)?.routeId);
                  const len = route ? routeLen(route.points) : 0;
                  const simTargetMonth = c.tonnes;
                  const simHours = c.productiveH;
                  const causes: string[] = [];
                  if (a) {
                    const fC = s.cycleMin / Math.max(0.1, a.cycle.totalMin);
                    const fH = a.hours.effective / Math.max(0.1, simHours);
                    const fT = simTargetMonth / Math.max(1, a.targetWetT);
                    const fP = a.payloadT / Math.max(0.1, c.payloadT);
                    const dmt0 = routes?.find((r) => r.id === a.id)?.distance ?? 0;
                    if (Math.abs(fC - 1) > 0.05) causes.push(`ciclo ${fC > 1 ? '+' : ''}${Math.round((fC - 1) * 100)}%`);
                    if (dmt0 > 0 && len > 0 && Math.abs(len / dmt0 - 1) > 0.1) causes.push(`distância da rota ${t0(len)} m contra DMT ${t0(dmt0)} m`);
                    if (s.cycleMin > c.cycleMin * 1.05) causes.push(`filas e variação somam ${n1(s.cycleMin - c.cycleMin)} min ao ciclo médio`);
                    if (Math.abs(fH - 1) > 0.05) causes.push(`horas ${fH > 1 ? 'a menos' : 'a mais'} na simulação (${t0(simHours)} contra ${t0(a.hours.effective)} h: dias trabalhados e horas do período)`);
                    if (Math.abs(fT - 1) > 0.05) causes.push(`meta ${fT > 1 ? 'maior' : 'menor'} (${t0(simTargetMonth)} contra ${t0(a.targetWetT)} t)`);
                    if (Math.abs(fP - 1) > 0.05) causes.push(`carga útil ${n1(c.payloadT)} contra ${n1(a.payloadT)} t`);
                    if (s.saturated) causes.push('gargalo na carga ou na descarga: mais caminhões não resolvem');
                    if (!causes.length) causes.push(a.trucksNeeded === s.trucks ? 'iguais' : 'arredondamento e variabilidade (quebras e filas ao acaso)');
                  }
                  const dmt = a ? routes?.find((r) => r.id === a.id)?.distance ?? 0 : 0;
                  return (
                    <tr key={s.circuitId} className="border-b border-black/5 align-top">
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{name}</span>
                        <span className="block text-[11px] text-black/45">{a ? `↔ ${a.name}` : 'sem rota correspondente no Dimensionamento'}</span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{a ? t0(a.targetWetT) : '—'} · {t0(simTargetMonth)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{a ? t0(dmt) : '—'} · {t0(len)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{a ? n1(a.cycle.totalMin) : '—'} · {n1(s.cycleMin)}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{a ? t0(a.hours.effective) : '—'} · {t0(simHours)}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{a ? `${a.trucksNeeded} (${n1(a.trucksNeededExact)})` : '—'} · {s.trucks}</td>
                      <td className="py-1.5 text-xs text-black/60">{causes.join('; ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {applied && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{applied}</p>}
          <ul className="list-disc space-y-1 pl-5 text-xs text-black/55">
            <li><b>Caminhões (simulação)</b>: a menor frota que atinge a meta de cada circuito por dia trabalhado, com as filas, quebras e paradas da simulação.</li>
            <li><b>Ciclo (simulação)</b>: média medida de todas as viagens, da chegada na fila de carga até o fim da volta (inclui filas e interferências).</li>
            <li><b>Horas produtivas</b>: estático = horas do calendário das premissas × DF × UF; simulação = dias trabalhados do período × horas/dia × DF × UF. Se o período da simulação tem menos dias (chuva, folgas), precisa de mais caminhões por dia.</li>
            <li><b>Usar no 2. Dimensionamento</b> grava a frota e o ciclo medidos na simulação nas rotas correspondentes (mesmo fluxo), e o Dimensionamento passa a refletir os fluxos reais de transporte.</li>
          </ul>
        </div>
      )}
    </Card>
  );
};

function routeLen(pts: { x: number; y: number; z: number }[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  return L;
}

export default StaticCompare;
