import React, { useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { Route } from '@/types';
import { geoFor, pathLength, readPathDxf, readPolygonDxf, setGeo, type GeoField } from '@/engine/geo';

/**
 * DXF de uma movimentação por período: origem (polígono), destino (polígono) e trajeto (polilinha 3D → DMT).
 * Nos períodos seguintes, importe só o que muda; o resto vem do período anterior.
 */

const LABEL: Record<GeoField, string> = { origin: 'Origem (polígono)', dest: 'Destino (polígono)', path: 'Trajeto (polilinha → DMT)' };

const GeoImport: React.FC<{ route: Route; periods: string[]; onChange: (r: Route) => void }> = ({ route, periods, onChange }) => {
  const maxGeo = Math.max(0, ...(route.geo ?? []).map((g) => g.period));
  const [extra, setExtra] = useState(0);
  const n = Math.max(1, periods.length, maxGeo) + extra;
  const [msg, setMsg] = useState<string | null>(null);
  const label = (p: number) => periods[p - 1] ?? `Período ${p}`;

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

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-[11px] text-black/45">
              <th className="px-1 py-1 font-medium">Período</th>
              {(Object.keys(LABEL) as GeoField[]).map((f) => <th key={f} className="px-1 py-1 font-medium">{LABEL[f]}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => i + 1).map((p) => {
              const own = route.geo?.find((g) => g.period === p);
              const eff = geoFor(route, p);
              return (
                <tr key={p} className="border-t border-black/5 align-top">
                  <td className="px-1 py-1.5 font-medium">{label(p)}</td>
                  {(Object.keys(LABEL) as GeoField[]).map((f) => {
                    const has = !!own?.[f]?.length;
                    const inherited = !has && eff.from[f] !== undefined;
                    return (
                      <td key={f} className="px-1 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-black/10 px-2 py-1 text-xs font-medium hover:bg-black/5">
                            <Upload size={12} /> DXF
                            <input type="file" accept=".dxf" className="sr-only" aria-label={`${LABEL[f]} — ${label(p)}`} onChange={(e) => { const file = e.target.files?.[0]; if (file) void load(p, f, file); e.target.value = ''; }} />
                          </label>
                          {has ? (
                            <>
                              <span className="truncate text-xs text-emerald-700" title={own?.files?.[f]}>{own?.files?.[f] ?? 'importado'}{f === 'path' ? ` · ${Math.round(pathLength(own!.path!)).toLocaleString('pt-BR')} m` : ` · ${own![f]!.length} vértices`}</span>
                              <button type="button" onClick={() => onChange(setGeo(route, p, f, undefined))} className="rounded p-0.5 text-black/35 hover:bg-red-50 hover:text-red-600" aria-label={`Limpar ${LABEL[f]} de ${label(p)}`}><X size={12} /></button>
                            </>
                          ) : inherited ? (
                            <span className="text-xs text-black/45">igual a {label(eff.from[f]!)}</span>
                          ) : (
                            <span className="text-xs text-black/30">—</span>
                          )}
                        </div>
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
        <button type="button" onClick={() => setExtra((x) => x + 1)} className="rounded-lg border border-dashed border-black/20 px-2.5 py-1 text-xs text-black/65 hover:bg-black/5">+ período</button>
        {msg && <span className="text-xs text-black/60">{msg}</span>}
      </div>
      <p className="text-[11px] text-black/45">
        Origem e destino: a maior polilinha fechada do arquivo (cava, pátio, pilha). Trajeto: a polilinha mais longa, com cota; no primeiro período o DMT passa a ser o comprimento dela, e a simulação usa as rampas do trajeto. Nos períodos seguintes importe só o que muda.
      </p>
    </div>
  );
};

export default GeoImport;
