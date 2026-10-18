import React, { useEffect, useState } from 'react';
import { Clock, Info, Plus, Trash2, Truck } from 'lucide-react';
import type { DetailedPremises, ExtraFleetAllocation, Route } from '../types';
import { sumCalendarHours, trucksWithoutRoute, type FleetAnalysis } from '@/engine/fleet';

/**
 * Frota extra (folga): caminhões das premissas que não estão em nenhuma rota podem ser alocados
 * por um número de horas (ex.: reforço de 2 caminhões por 120 h numa frente). O motor soma essa
 * produção à capacidade da rota (horas × DF × UF × produção horária do caminhão naquela rota).
 */

interface Props {
  routes: Route[];
  premises: DetailedPremises;
  setPremises: React.Dispatch<React.SetStateAction<DetailedPremises>>;
  analysis: FleetAnalysis;
}

const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const ExtraFleetManager: React.FC<Props> = ({ routes, premises, setPremises, analysis }) => {
  const active = routes.filter((r) => r.active && analysis.routes.some((a) => a.id === r.id));
  const calMonth = sumCalendarHours(premises, 'mina');
  // caminhões da frota que não estão em nenhuma rota = frota extra
  const unassigned = trucksWithoutRoute(routes, premises);
  const pool = unassigned * calMonth;
  const used = (premises.extraAllocations ?? []).reduce((a, x) => a + x.truckCount * x.durationHours, 0);
  const remaining = Math.max(0, pool - used);
  // caminhões ainda livres para o mês inteiro
  const freeNow = Math.max(0, Math.floor(remaining / (calMonth || 1) + 1e-9));
  const [form, setForm] = useState<{ routeId: string; truckCount: number | null; durationHours: number; description: string }>({
    routeId: active[0]?.id ?? '',
    truckCount: null, // null = acompanha os caminhões livres
    durationHours: calMonth,
    description: '',
  });
  // o número proposto acompanha a frota em tempo real até o planejador digitar outro
  const trucks = Math.max(1, Math.min(form.truckCount ?? freeNow, Math.max(unassigned, 1)));
  const routeId = active.some((r) => r.id === form.routeId) ? form.routeId : active[0]?.id ?? '';
  const hours = Math.min(form.durationHours || calMonth, calMonth);
  useEffect(() => {
    // quando a frota muda, volta a propor os livres
    setForm((f) => ({ ...f, truckCount: null }));
  }, [unassigned, freeNow]);
  const req = trucks * hours;

  const add = () => {
    if (!routeId || trucks <= 0 || hours <= 0 || req > remaining + 0.01 || trucks > unassigned) return;
    const allocation: ExtraFleetAllocation = { id: Math.random().toString(36).slice(2, 11), routeId, truckCount: trucks, durationHours: hours, description: form.description };
    setPremises((prev) => ({ ...prev, extraAllocations: [...(prev.extraAllocations ?? []), allocation] }));
    setForm({ ...form, truckCount: null, description: '' });
  };
  const remove = (id: string) => setPremises((prev) => ({ ...prev, extraAllocations: (prev.extraAllocations ?? []).filter((a) => a.id !== id) }));

  if (unassigned <= 0 && !(premises.extraAllocations ?? []).length) return null;

  return (
    <div className="space-y-5 rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-blue-50 p-3 text-blue-500">
            <Truck size={24} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-black/80">Frota extra por horas (folga)</h4>
            <p className="text-xs text-black/45">
              {unassigned} caminhão(ões) sem rota{used > 0 ? ` (${freeNow} livre(s) para o mês inteiro)` : ''}. Escolha a frente, quantos caminhões e por quantas horas (o padrão é o mês inteiro). A produção entra na capacidade da rota.
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold tracking-widest text-black/40 uppercase">Disponível</p>
          <p className="font-mono text-sm font-bold text-blue-600">{t0(remaining)} h-caminhão</p>
          <p className="text-[10px] text-black/35">de {t0(pool)} h ({unassigned} × {t0(calMonth)} h do calendário)</p>
        </div>
      </div>

      {unassigned > 0 && (
        <div className="grid grid-cols-1 gap-3 rounded-2xl border border-black/5 bg-[#F8F9FA] p-4 md:grid-cols-5">
          <label className="space-y-1 text-[10px] font-bold tracking-widest text-black/40 uppercase md:col-span-2">
            Rota
            <select value={routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value })} className="w-full rounded-xl border border-black/5 bg-white px-3 py-2 text-sm normal-case">
              {active.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[10px] font-bold tracking-widest text-black/40 uppercase">
            Caminhões
            <input type="number" min={1} step={1} max={unassigned} value={trucks} onChange={(e) => setForm({ ...form, truckCount: Math.max(1, Math.round(Number(e.target.value) || 1)) })} className="w-full rounded-xl border border-black/5 bg-white px-3 py-2 font-mono text-sm" />
          </label>
          <label className="space-y-1 text-[10px] font-bold tracking-widest text-black/40 uppercase">
            Horas de calendário
            <input type="number" min={1} max={calMonth} value={hours} onChange={(e) => setForm({ ...form, durationHours: Math.max(1, Number(e.target.value) || 1) })} className="w-full rounded-xl border border-black/5 bg-white px-3 py-2 font-mono text-sm" />
            <span className="flex gap-2 normal-case tracking-normal">
              <button type="button" className="font-medium text-blue-600 hover:underline" onClick={() => setForm({ ...form, durationHours: calMonth })}>mês inteiro ({Math.round(calMonth)} h)</button>
            </span>
          </label>
          <div className="flex items-end">
            <button
              onClick={add}
              disabled={!routeId || req > remaining + 0.01 || trucks > unassigned}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:bg-black/10 disabled:text-black/25"
            >
              <Plus size={16} /> Alocar
            </button>
          </div>
        </div>
      )}

      {(premises.extraAllocations ?? []).length > 0 ? (
        <div className="space-y-2">
          {(premises.extraAllocations ?? []).map((x) => {
            const route = routes.find((r) => r.id === x.routeId);
            const a = analysis.routes.find((r) => r.id === x.routeId);
            const effH = a ? x.truckCount * x.durationHours * a.hours.df * a.hours.uf : 0;
            const prod = a ? effH * a.truckRateTph : 0;
            return (
              <div key={x.id} className="group flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 p-4">
                <div className="flex items-center gap-3">
                  <Clock size={16} className="text-blue-500" />
                  <div>
                    <p className="text-sm font-bold text-black/80">{route?.name ?? 'Rota removida'}</p>
                    <p className="text-xs text-black/50">
                      {x.truckCount} caminhão(ões) × {t0(x.durationHours)} h de calendário → {n1(effH)} h efetivas × {n1(a?.truckRateTph ?? 0)} t/h = <b className="text-emerald-700">{t0(prod)} t</b>
                    </p>
                  </div>
                </div>
                <button onClick={() => remove(x.id)} className="rounded-xl p-2 text-red-400 hover:bg-red-50" aria-label="Remover alocação">
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-xs text-black/40">
          <Info size={14} /> Nenhuma alocação por horas.
        </p>
      )}
    </div>
  );
};

export default ExtraFleetManager;
