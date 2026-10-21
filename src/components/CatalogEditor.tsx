import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { DetailedPremises, EquipmentCatalog, LoaderClass, TruckClass } from '@/types';
import { DEFAULT_CATALOG, catalogOf } from '@/engine/fleet';
import { economicLife } from '@/sim/econ';

/**
 * Catálogo de equipamentos do plano: caminhões e equipamentos de carga, com fabricante, modelo,
 * capacidade e dados econômicos (preço, vida útil, residual, manutenção crescente, diesel, pneus).
 * Os modelos alimentam as premissas, o Dimensionamento, as configurações da simulação e o Financeiro.
 */

const cell = 'w-full rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm';
const num = `${cell} text-right font-mono`;
const brl0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

type Col<T> = { key: keyof T; label: string; w?: number; text?: boolean; step?: number };

const TRUCK_COLS: Col<TruckClass>[] = [
  { key: 'manufacturer', label: 'Fabricante', text: true, w: 120 },
  { key: 'name', label: 'Modelo / classe', text: true, w: 220 },
  { key: 'payloadT', label: 'Carga útil (t)', w: 80, step: 0.5 },
  { key: 'volumeM3', label: 'Volume (m³)', w: 80, step: 0.5 },
  { key: 'price', label: 'Preço (R$)', w: 120, step: 10000 },
  { key: 'lifeYears', label: 'Vida útil (anos)', w: 80, step: 1 },
  { key: 'hoursPerYear', label: 'h/ano', w: 80, step: 100 },
  { key: 'residualPct', label: 'Residual (%)', w: 80 },
  { key: 'maintPerH', label: 'Manut. nova (R$/h)', w: 90, step: 5 },
  { key: 'maintEscPctYear', label: '+ manut. (%/ano)', w: 80, step: 1 },
  { key: 'dieselLph', label: 'Diesel (L/h)', w: 80, step: 0.5 },
  { key: 'tiresPerH', label: 'Pneus (R$/h)', w: 80, step: 1 },
];

const LOADER_COLS: Col<LoaderClass>[] = [
  { key: 'manufacturer', label: 'Fabricante', text: true, w: 120 },
  { key: 'name', label: 'Modelo / classe', text: true, w: 220 },
  { key: 'bucketM3', label: 'Caçamba (m³)', w: 80, step: 0.1 },
  { key: 'cycleSec', label: 'Ciclo (s)', w: 70, step: 1 },
  { key: 'price', label: 'Preço (R$)', w: 120, step: 10000 },
  { key: 'lifeYears', label: 'Vida útil (anos)', w: 80, step: 1 },
  { key: 'hoursPerYear', label: 'h/ano', w: 80, step: 100 },
  { key: 'residualPct', label: 'Residual (%)', w: 80 },
  { key: 'maintPerH', label: 'Manut. nova (R$/h)', w: 90, step: 5 },
  { key: 'maintEscPctYear', label: '+ manut. (%/ano)', w: 80, step: 1 },
  { key: 'dieselLph', label: 'Diesel (L/h)', w: 80, step: 0.5 },
];

/** Idade econômica de troca de um modelo do catálogo (anos), pela regra do custo médio mínimo. */
export function catalogEconomicYears(x: TruckClass | LoaderClass) {
  if (!x.price || !x.lifeYears) return null;
  const hpy = x.hoursPerYear || 5000;
  const life = economicLife({
    price: x.price,
    residualPct: x.residualPct ?? 20,
    lifeH: x.lifeYears * hpy,
    maintPerH: x.maintPerH ?? 0,
    maintEscPct: ((x.maintEscPctYear ?? 0) * 10_000) / hpy,
  });
  return life ? { years: life.ageH / hpy, costPerH: life.costPerH } : null;
}

function Table<T extends { id: string }>({ rows, cols, defaults, onChange, onRemove, title }: { rows: T[]; cols: Col<T>[]; defaults: T[]; onChange: (i: number, k: keyof T, v: unknown) => void; onRemove: (i: number) => void; title: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm" style={{ minWidth: cols.reduce((a, c) => a + (c.w ?? 90), 260) }}>
        <thead>
          <tr className="text-left text-[11px] text-black/45">
            {cols.map((c) => (
              <th key={String(c.key)} className="px-1 py-1 font-medium" style={{ width: c.w }}>{c.label}</th>
            ))}
            <th className="px-1 py-1 font-medium">Troca ideal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isDefault = defaults.some((d) => d.id === r.id);
            const econ = catalogEconomicYears(r as unknown as TruckClass);
            return (
              <tr key={r.id} className="border-t border-black/5">
                {cols.map((c) => (
                  <td key={String(c.key)} className="px-1 py-1">
                    <input
                      type={c.text ? 'text' : 'number'}
                      step={c.step ?? 1}
                      className={c.text ? cell : num}
                      value={(r[c.key] as unknown as string | number | undefined) ?? ''}
                      placeholder={c.key === 'manufacturer' ? 'genérico' : ''}
                      aria-label={`${title} ${String(r[cols[1].key] ?? '')}: ${c.label}`}
                      onChange={(e) => onChange(i, c.key, c.text ? e.target.value : e.target.value === '' ? undefined : Number(e.target.value))}
                    />
                  </td>
                ))}
                <td className="px-1 py-1 text-xs whitespace-nowrap text-black/60" title={econ ? `Custo médio mínimo de ${brl0(econ.costPerH)}/h (compra − valor de mercado + manutenção acumulada)` : 'Informe preço e vida útil'}>
                  {econ ? `${econ.years.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos` : '—'}
                </td>
                <td className="px-1 py-1">
                  <button type="button" disabled={isDefault} onClick={() => onRemove(i)} className="rounded-lg p-1.5 text-black/35 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" title={isDefault ? 'Modelo padrão: pode ser editado, não excluído' : 'Excluir'} aria-label="Excluir">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const CatalogEditor: React.FC<{ premises: DetailedPremises; setPremises: (p: DetailedPremises) => void; compact?: boolean }> = ({ premises, setPremises }) => {
  const catalog = catalogOf(premises);
  const update = (c: EquipmentCatalog) => setPremises({ ...premises, equipmentCatalog: c });
  const [tab, setTab] = useState<'trucks' | 'loaders'>('trucks');
  const newId = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-black/10 bg-white p-0.5 text-xs" role="tablist">
          {(['trucks', 'loaders'] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1 ${tab === k ? 'bg-[#151619] text-white' : 'text-black/60'}`}>
              {k === 'trucks' ? `Caminhões (${catalog.trucks.length})` : `Equipamentos de carga (${catalog.loaders.length})`}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#151619] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
          onClick={() =>
            tab === 'trucks'
              ? update({ ...catalog, trucks: [...catalog.trucks, { id: newId('cam'), name: 'Novo caminhão', manufacturer: '', payloadT: 40, volumeM3: 22, vehicle: 'rodoviario', price: 1_600_000, lifeYears: 5, hoursPerYear: 5000, residualPct: 20, maintPerH: 70, maintEscPctYear: 8, dieselLph: 28, tiresPerH: 25 }] })
              : update({ ...catalog, loaders: [...catalog.loaders, { id: newId('car'), name: 'Novo equipamento de carga', manufacturer: '', bucketM3: 2, cycleSec: 22, price: 1_500_000, lifeYears: 5, hoursPerYear: 5000, residualPct: 20, maintPerH: 95, maintEscPctYear: 8, dieselLph: 24 }] })
          }
        >
          <Plus size={14} /> {tab === 'trucks' ? 'Cadastrar caminhão' : 'Cadastrar equipamento de carga'}
        </button>
      </div>
      {tab === 'trucks' ? (
        <Table<TruckClass>
          title="Caminhão"
          rows={catalog.trucks}
          cols={TRUCK_COLS}
          defaults={DEFAULT_CATALOG.trucks}
          onChange={(i, k, v) => update({ ...catalog, trucks: catalog.trucks.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })}
          onRemove={(i) => update({ ...catalog, trucks: catalog.trucks.filter((_, j) => j !== i) })}
        />
      ) : (
        <Table<LoaderClass>
          title="Equipamento de carga"
          rows={catalog.loaders}
          cols={LOADER_COLS}
          defaults={DEFAULT_CATALOG.loaders}
          onChange={(i, k, v) => update({ ...catalog, loaders: catalog.loaders.map((x, j) => (j === i ? { ...x, [k]: v } : x)) })}
          onRemove={(i) => update({ ...catalog, loaders: catalog.loaders.filter((_, j) => j !== i) })}
        />
      )}
      <p className="text-xs text-black/50">
        Cadastre os modelos que vocês usam ou cotam (fabricante e modelo, ex.: Volvo FMX 8x4, Mercedes-Benz Actros, Scania G 500, Caterpillar 336). Os valores padrão são genéricos, sem marca: substitua por cotações e pelo histórico de manutenção.
        A <b>vida útil</b> e o <b>aumento da manutenção por ano</b> alimentam o fluxo de caixa (Financeiro → Resultados e decisão) em simulações de 5, 10 ou 15 anos; <b>troca ideal</b> é a idade em que o custo médio por hora (compra − valor de mercado + manutenção acumulada) é o menor — depois dela, manter o equipamento sai mais caro que trocar.
      </p>
    </div>
  );
};

export default CatalogEditor;
