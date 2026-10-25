import React, { useState } from 'react';
import { Pencil, Trash2, Upload, X } from 'lucide-react';
import type { Route } from '@/types';
import { geoFor, geoPeriodCount, pathLength, readPathDxf, readPointDxf, readPolygonDxf, removeGeoPeriod, setGeo, setStopGeo, type GeoField } from '@/engine/geo';

/**
 * DXF de uma movimentação por período: origem (polígono), destino (polígono), trajeto (polilinha 3D → DMT)
 * e a posição de cada parada no trajeto (ponto). Nos períodos seguintes, importe só o que muda.
 * Períodos podem ser renomeados, criados e apagados.
 */

const LABEL: Record<GeoField, string> = { origin: 'Origem (polígono)', dest: 'Destino (polígono)', path: 'Trajeto (polilinha → DMT)' };
const btn = 'inline-flex cursor-pointer items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-xs font-medium hover:bg-black/5';

const GeoImport: React.FC<{ route: Route; periods: string[]; onChange: (r: Route) => void }> = ({ route, periods, onChange }) => {
  const n = geoPeriodCount(route, periods.length);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const label = (p: number) => route.geoLabels?.[p - 1] || periods[p - 1] || `Período ${p}`;
  const labelsFull = () => Array.from({ length: n }, (_, i) => label(i + 1));
  const stops = route.stops ?? [];

  const load = async (p: number, f: GeoField, file: File) => {
    setMsg(null);
    const text = await file.text();
    const v = f === 'path' ? readPathDxf(text) : readPolygonDxf(text);
    if (!v || v.length < (f === 'path' ? 2 : 3)) {
      setMsg(`${file.name}: nenhuma ${f === 'path' ? 'polilinha' : 'polilinha fechada'} encontrada.`);
      return;
    }
    onChange(setGeo(route, p, f, v, file.name));
    if (f === 'path') setMsg(`${file.name}: trajeto de ${Math.round(pathLength(v as { x: number; y: number; z: number }[])).toLocaleString('pt-BR')} m${p === 1 ? ' — DMT atualizado' : ''}.`);
  };
  const loadStop = async (p: number, stopId: string, file: File) => {
    setMsg(null);
    const pt = readPointDxf(await file.text());
    if (!pt) {
      setMsg(`${file.name}: nenhum ponto ou polilinha encontrado.`);
      return;
    }
    const next = setStopGeo(route, p, stopId, pt, file.name);
    onChange(next);
    const st = next.stops?.find((x) => x.id === stopId);
    setMsg(`${file.name}: ${st?.name ?? 'parada'} posicionada${p === 1 && geoFor(next, 1).path ? ` a ${Math.round(st?.distM ?? 0).toLocaleString('pt-BR')} m da origem pelo trajeto` : ''}.`);
  };
  const addPeriod = () => onChange({ ...route, geoLabels: [...labelsFull(), `Período ${n + 1}`] });
  const delPeriod = (p: number) => {
    if (n <= 1) return;
    if (!confirm(`Apagar ${label(p)} e os DXF dele? Os períodos seguintes sobem uma posição.`)) return;
    onChange(removeGeoPeriod({ ...route, geoLabels: labelsFull() }, p));
  };
  const rename = (p: number, v: string) => {
    const l = labelsFull();
    l[p - 1] = v;
    onChange({ ...route, geoLabels: l });
  };

  const cellFor = (p: number, has: boolean, name: string | undefined, info: string, inherited: number | undefined, input: React.ReactNode, clear: () => void, aria: string) => (
    <div className="flex items-center gap-1.5">
      <label className={btn}>
        <Upload size={12} /> DXF
        {input}
      </label>
      {has ? (
        <>
          <span className="truncate text-xs text-emerald-700" title={name}>{name ?? 'importado'}{info}</span>
          <button type="button" onClick={clear} className="rounded p-0.5 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Limpar ${aria}`}><X size={12} /></button>
        </>
      ) : inherited !== undefined ? (
        <span className="text-xs text-black/45">igual a {label(inherited)}</span>
      ) : (
        <span className="text-xs text-black/30">—</span>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 760 + stops.length * 190 }}>
          <thead>
            <tr className="text-left text-[11px] text-black/45">
              <th className="px-1 py-1 font-medium">Período</th>
              {(Object.keys(LABEL) as GeoField[]).map((f) => <th key={f} className="px-1 py-1 font-medium">{LABEL[f]}</th>)}
              {stops.map((st) => <th key={st.id} className="px-1 py-1 font-medium">Parada: {st.name} (ponto)</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => i + 1).map((p) => {
              const own = route.geo?.find((g) => g.period === p);
              const eff = geoFor(route, p);
              return (
                <tr key={p} className="border-t border-black/5 align-top">
                  <td className="px-1 py-1.5">
                    {editing === p ? (
                      <input autoFocus className="w-32 rounded-lg border border-black/15 px-2 py-1 text-sm" value={label(p)} aria-label={`Nome do período ${p}`} onChange={(e) => rename(p, e.target.value)} onBlur={() => setEditing(null)} onKeyDown={(e) => e.key === 'Enter' && setEditing(null)} />
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{label(p)}</span>
                        <button type="button" onClick={() => setEditing(p)} className="rounded p-0.5 text-black/35 hover:bg-black/5" aria-label={`Renomear ${label(p)}`}><Pencil size={12} /></button>
                        {n > 1 && <button type="button" onClick={() => delPeriod(p)} className="rounded p-0.5 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Apagar ${label(p)}`}><Trash2 size={12} /></button>}
                      </div>
                    )}
                  </td>
                  {(Object.keys(LABEL) as GeoField[]).map((f) => {
                    const has = !!own?.[f]?.length;
                    return (
                      <td key={f} className="px-1 py-1.5">
                        {cellFor(
                          p,
                          has,
                          own?.files?.[f],
                          has ? (f === 'path' ? ` · ${Math.round(pathLength(own!.path!)).toLocaleString('pt-BR')} m` : ` · ${own![f]!.length} vértices`) : '',
                          !has ? eff.from[f] : undefined,
                          <input type="file" accept=".dxf" className="sr-only" aria-label={`${LABEL[f]} — ${label(p)}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) void load(p, f, file); e.target.value = ''; }} />,
                          () => onChange(setGeo(route, p, f, undefined)),
                          `${LABEL[f]} de ${label(p)}`,
                        )}
                      </td>
                    );
                  })}
                  {stops.map((st) => {
                    const has = !!own?.stops?.[st.id];
                    return (
                      <td key={st.id} className="px-1 py-1.5">
                        {cellFor(
                          p,
                          has,
                          own?.files?.stops?.[st.id],
                          '',
                          !has ? eff.stopFrom[st.id] : undefined,
                          <input type="file" accept=".dxf" className="sr-only" aria-label={`Parada ${st.name} — ${label(p)}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadStop(p, st.id, file); e.target.value = ''; }} />,
                          () => onChange(setStopGeo(route, p, st.id, undefined)),
                          `parada ${st.name} de ${label(p)}`,
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={addPeriod} className="rounded-lg border border-dashed border-black/20 px-2.5 py-1 text-xs text-black/65 hover:bg-black/5">+ período</button>
        {msg && <span className="text-xs text-black/60">{msg}</span>}
      </div>
      <p className="text-[11px] text-black/45">
        Origem e destino: a maior polilinha fechada do arquivo (cava, pátio, pilha). Trajeto: a polilinha mais longa, com cota; no primeiro período o DMT passa a ser o comprimento dela, e a simulação usa as rampas do trajeto. Parada: um ponto (POINT) ou o centro do desenho; com trajeto, a distância da origem da parada passa a ser a medida nele — sem DXF, vale a distância informada. Nos períodos seguintes importe só o que muda. Use o lápis para renomear o período e a lixeira para apagá-lo.
      </p>
    </div>
  );
};

export default GeoImport;
