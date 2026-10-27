import React from 'react';
import type { SimModel } from '@/sim/types';
import { defaultFinance, defaultTruckFinance, economicLife, financeFromCatalog, type EquipFinance, type Finance } from '@/sim/econ';
import type { CatalogEconomics, DetailedPremises } from '@/types';
import { catalogOf } from '@/engine/fleet';
import { Card, Num, inputCls } from './ui';
import { REVENUE_REF_PER_T, SICRO_REF, overheadReference } from '@/sim/references';
import { calendarWorkDays, emptyPlan } from '@/sim/plan';

interface Props {
  premises?: DetailedPremises;
  model: SimModel;
  setModel: (m: SimModel) => void;
  canEdit: boolean;
}

type Field = { key: keyof EquipFinance; label: string; suffix?: string; step?: number };

const FIELDS: Field[] = [
  { key: 'price', label: 'Valor de compra', suffix: 'R$', step: 10000 },
  { key: 'residualPct', label: 'Valor residual', suffix: '% da compra' },
  { key: 'lifeH', label: 'Vida útil', suffix: 'h trabalhadas', step: 1000 },
  { key: 'dieselLph', label: 'Diesel por hora', suffix: 'L/h', step: 0.5 },
  { key: 'dieselLpt', label: 'Diesel por tonelada', suffix: 'L/t', step: 0.01 },
  { key: 'maintPerH', label: 'Manutenção (novo)', suffix: 'R$/h', step: 5 },
  { key: 'maintEscPct', label: 'Aumento da manutenção', suffix: '% a cada 10 mil h' },
  { key: 'tiresPerH', label: 'Pneus / material rodante', suffix: 'R$/h', step: 1 },
  { key: 'operatorsPerUnit', label: 'Operadores por turno', suffix: 'por equipamento', step: 0.5 },
  { key: 'dfLossPer10kH', label: 'Perda de disponibilidade', suffix: 'p.p. a cada 10 mil h', step: 0.5 },
];

const FinanceView: React.FC<Props> = ({ premises, model, setModel, canEdit }) => {
  const fin: Finance = model.finance ?? defaultFinance(model.configs);
  const setFin = (f: Finance) => setModel({ ...model, finance: f });
  const truckFin = (id: string, payload: number) => fin.trucks[id] ?? defaultTruckFinance(payload);
  const setTruck = (id: string, payload: number, patch: Partial<EquipFinance>) => setFin({ ...fin, trucks: { ...fin.trucks, [id]: { ...truckFin(id, payload), ...patch } } });
  const catalog = premises ? catalogOf(premises) : null;
  const cols = [
    ...model.configs.map((c) => ({ id: c.id, name: c.name, kind: 'truck' as const, get: () => truckFin(c.id, c.payloadT), set: (p: Partial<EquipFinance>) => setTruck(c.id, c.payloadT, p) })),
    { id: '__loader', name: 'Equipamento de carga (por unidade)', kind: 'loader' as const, get: () => fin.loader, set: (p: Partial<EquipFinance>) => setFin({ ...fin, loader: { ...fin.loader, ...p } }) },
  ];
  const fromCatalog = (x: CatalogEconomics & { id: string }) => financeFromCatalog(x);
  const hoursPerYearOf = (f: EquipFinance) => {
    const all = [...(catalog?.trucks ?? []), ...(catalog?.loaders ?? [])];
    return all.find((x) => x.id === f.catalogId)?.hoursPerYear || 5000;
  };
  const wageYear = fin.salaryMonthly * 12 * (1 + fin.chargesPct / 100);
  const [ovh, setOvh] = React.useState({ graderH: 4, sup: 1, salary: 7000 });
  const workDaysYear = calendarWorkDays((model.plan ?? emptyPlan()).calendar);
  const ref = overheadReference({ workDaysYear, graderHoursPerDay: ovh.graderH, supervisorsPerShift: ovh.sup, supervisorSalary: ovh.salary, shifts: fin.shifts, reliefFactor: fin.reliefFactor, chargesPct: fin.chargesPct });
  // receita de referência: acompanha a receita em uso; editável para testar outro valor antes de aplicar
  const [refRevenue, setRefRevenue] = React.useState<number>(fin.revenuePerT > 0 ? fin.revenuePerT : REVENUE_REF_PER_T);
  React.useEffect(() => {
    if (fin.revenuePerT > 0) setRefRevenue(fin.revenuePerT);
  }, [fin.revenuePerT]);
  const brl0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  return (
    <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
      <Card title="Premissas gerais" description="Valem para todas as opções. A decisão usa o VPL dos custos (e da receita, se informada) ao longo dos períodos do plano.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Num label="Preço do diesel" suffix="R$/L" step={0.05} value={fin.dieselPrice} onChange={(v) => setFin({ ...fin, dieselPrice: v })} />
          <Num label="Taxa de desconto" suffix="% a.a." step={0.5} value={fin.discountRate} onChange={(v) => setFin({ ...fin, discountRate: v })} />
          <Num label="Salário do operador" suffix="R$/mês" step={100} value={fin.salaryMonthly} onChange={(v) => setFin({ ...fin, salaryMonthly: v })} />
          <Num label="Encargos e benefícios" suffix="%" value={fin.chargesPct} onChange={(v) => setFin({ ...fin, chargesPct: v })} />
          <Num label="Turnos por dia" value={fin.shifts} onChange={(v) => setFin({ ...fin, shifts: Math.max(1, Math.round(v)) })} />
          <Num label="Fator de folguistas" step={0.05} value={fin.reliefFactor} onChange={(v) => setFin({ ...fin, reliefFactor: Math.max(1, v) })} />
          <Num label="Custos fixos do transporte" suffix="R$/ano" step={10000} value={fin.overheadPerYear} onChange={(v) => setFin({ ...fin, overheadPerYear: v })} />
          <Num label="Receita (opcional)" suffix="R$/t" step={1} value={fin.revenuePerT} onChange={(v) => setFin({ ...fin, revenuePerT: v })} />
          <div className="col-span-2">
            <label className="mb-1 block text-xs text-black/55">Material com receita <span className="text-black/35">(vazio = todas as toneladas)</span></label>
            <input className={inputCls} value={fin.revenueMaterial} placeholder="ex.: Concentrado" onChange={(e) => setFin({ ...fin, revenueMaterial: e.target.value })} />
          </div>
        </div>
        <p className="mt-3 text-xs text-black/50">
          Custo anual de um operador com encargos: {wageYear.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}. Pessoas por equipamento = operadores por turno × turnos × fator de folguistas.
          {fin.revenuePerT > 0 ? ' Com receita, a decisão econômica usa o VPL (receita − custos).' : ' Sem receita, a decisão econômica usa o custo nivelado por tonelada (VPL dos custos ÷ VPL das toneladas).'}
        </p>
      </Card>

      <Card title="Valores de referência" description="Pontos de partida editáveis. Substitua pelos números de vocês quando tiver.">
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-xl bg-[#F8F9FA] p-4 text-sm">
            <p className="font-semibold">Custos fixos do transporte</p>
            <p className="mt-1 text-xs text-black/55">
              Manutenção das vias com motoniveladora ({SICRO_REF.grader.code}, {SICRO_REF.label}: R$ {SICRO_REF.grader.productive.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/h) + supervisão por turno.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Num label="Motoniveladora" suffix="h/dia" step={0.5} value={ovh.graderH} onChange={(v) => setOvh({ ...ovh, graderH: Math.max(0, v) })} />
              <Num label="Supervisores" suffix="por turno" step={0.5} value={ovh.sup} onChange={(v) => setOvh({ ...ovh, sup: Math.max(0, v) })} />
              <Num label="Salário supervisor" suffix="R$/mês" step={100} value={ovh.salary} onChange={(v) => setOvh({ ...ovh, salary: Math.max(0, v) })} />
            </div>
            <p className="mt-2 text-xs text-black/60">
              Vias {brl0(ref.roads)} ({workDaysYear} dias trabalhados no calendário do plano) + supervisão {brl0(ref.supervision)} ({fin.shifts} {fin.shifts === 1 ? 'turno' : 'turnos'}, folguistas {fin.reliefFactor}, encargos {fin.chargesPct}%) = <b>{brl0(ref.total)}/ano</b>.
            </p>
            <p className="mt-1 text-xs text-black/60">
              Em uso nas premissas gerais: <b>{brl0(fin.overheadPerYear)}/ano</b>
              {fin.overheadPerYear === ref.total ? ' (igual à referência)' : ''}.
            </p>
            <button type="button" disabled={fin.overheadPerYear === ref.total} className="mt-2 rounded-lg bg-[#151619] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-40" onClick={() => setFin({ ...fin, overheadPerYear: ref.total })}>
              Usar {brl0(ref.total)}/ano
            </button>
          </div>
          <div className="rounded-xl bg-[#F8F9FA] p-4 text-sm">
            <p className="font-semibold">Receita</p>
            <p className="mt-1 text-xs text-black/55">
              Valor indicativo de <b>R$ {refRevenue.toLocaleString('pt-BR')}/t</b> de {fin.revenueMaterial || 'material transportado'}, definido por vocês. Com receita, a decisão econômica usa o VPL (receita − custos); sem receita, o custo nivelado por tonelada.
            </p>
            <div className="mt-2 w-40">
              <Num label="Receita de referência" suffix="R$/t" step={1} value={refRevenue} onChange={(v) => setRefRevenue(Math.max(0, v))} />
            </div>
            <p className="mt-1 text-xs text-black/60">
              Em uso nas premissas gerais: <b>{fin.revenuePerT > 0 ? `R$ ${fin.revenuePerT.toLocaleString('pt-BR')}/t` : 'sem receita'}</b>.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={fin.revenuePerT === refRevenue} className="rounded-lg bg-[#151619] px-3 py-1.5 text-xs font-semibold text-white hover:bg-black disabled:opacity-40" onClick={() => setFin({ ...fin, revenuePerT: refRevenue, revenueMaterial: fin.revenueMaterial || 'Produto' })}>
                Usar R$ {refRevenue.toLocaleString('pt-BR')}/t
              </button>
              {fin.revenuePerT > 0 && (
                <button type="button" className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/[0.03]" onClick={() => setFin({ ...fin, revenuePerT: 0 })}>
                  Comparar só por custo
                </button>
              )}
            </div>
            <p className="mt-4 font-semibold">Equipamentos de carga (SICRO)</p>
            <ul className="mt-1 space-y-0.5 text-xs text-black/60">
              {[SICRO_REF.wheelLoader, SICRO_REF.excavator].map((x) => (
                <li key={x.code}>
                  {x.code} {x.description}: produtivo R$ {x.productive.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/h{x.acquisition ? `, aquisição ${brl0(x.acquisition)}` : ''}
                </li>
              ))}
            </ul>
            <button type="button" className="mt-2 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-black/[0.03]" onClick={() => setFin({ ...fin, loader: { ...fin.loader, price: Math.round(SICRO_REF.wheelLoader.acquisition! / 1000) * 1000 } })}>
              Usar o valor da carregadeira no equipamento de carga
            </button>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-black/45">
          Fonte: <a className="underline" href={SICRO_REF.url} target="_blank" rel="noreferrer">SICRO – DNIT</a>, custos horários de equipamentos, {SICRO_REF.label}. O custo improdutivo de MG é estimado pela proporção da tabela nacional.
        </p>
      </Card>

      <Card title="Equipamentos" description="Valores de referência: substitua pelos orçamentos e pelo histórico de vocês. O diesel pode ser por hora ou por tonelada (escolha na linha “Diesel calculado por”).">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 260 + cols.length * 170 }}>
            <thead>
              <tr className="text-left text-xs text-black/45">
                <th className="py-1 pr-3 font-medium">Item</th>
                {cols.map((c) => (
                  <th key={c.id} className="py-1 pr-2 font-medium">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog && (
                <tr className="border-t border-black/5">
                  <td className="py-1 pr-3 text-xs text-black/60">Modelo do catálogo <span className="text-black/35">(preenche os valores)</span></td>
                  {cols.map((c) => {
                    const list = c.kind === 'truck' ? catalog.trucks : catalog.loaders;
                    return (
                      <td key={c.id} className="py-1 pr-2">
                        <select
                          className={inputCls}
                          value={c.get().catalogId ?? ''}
                          aria-label={`Modelo do catálogo – ${c.name}`}
                          onChange={(e) => {
                            const x = list.find((y) => y.id === e.target.value);
                            c.set(x ? fromCatalog(x) : { catalogId: undefined });
                          }}
                        >
                          <option value="">Valores digitados</option>
                          {list.map((x) => (
                            <option key={x.id} value={x.id}>{x.manufacturer ? `${x.manufacturer} – ` : ''}{x.name}</option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              )}
              <tr className="border-t border-black/5">
                <td className="py-1 pr-3 text-xs text-black/60">Diesel calculado por</td>
                {cols.map((c) => (
                  <td key={c.id} className="py-1 pr-2">
                    <select className={inputCls} value={c.get().dieselMode} onChange={(e) => c.set({ dieselMode: e.target.value as EquipFinance['dieselMode'] })} aria-label={`Diesel de ${c.name}`}>
                      <option value="lph">Hora trabalhada (L/h)</option>
                      <option value="lpt">Tonelada transportada (L/t)</option>
                    </select>
                  </td>
                ))}
              </tr>
              {FIELDS.map((f) => (
                <tr key={f.key} className="border-t border-black/5">
                  <td className="py-1 pr-3 text-xs text-black/60">
                    {f.label}
                    {f.suffix && <span className="text-black/35"> ({f.suffix})</span>}
                  </td>
                  {cols.map((c) => {
                    const v = c.get()[f.key] as number;
                    const off = (f.key === 'dieselLph' && c.get().dieselMode === 'lpt') || (f.key === 'dieselLpt' && c.get().dieselMode === 'lph');
                    return (
                      <td key={c.id} className="py-1 pr-2">
                        <input
                          type="number"
                          step={f.step ?? 1}
                          className={`${inputCls} text-right ${off ? 'opacity-40' : ''}`}
                          value={v}
                          aria-label={`${f.label} – ${c.name}`}
                          onChange={(e) => c.set({ [f.key]: Number(e.target.value) } as Partial<EquipFinance>)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-black/5 bg-amber-50/40">
                <td className="py-1 pr-3 text-xs text-black/60">Troca ideal <span className="text-black/35">(idade econômica)</span></td>
                {cols.map((c) => {
                  const f = c.get();
                  const e = economicLife(f);
                  const hpy = hoursPerYearOf(f);
                  return (
                    <td key={c.id} className="py-1 pr-2 text-xs">
                      {e ? (
                        <>
                          <span className="font-semibold">{Math.round(e.ageH).toLocaleString('pt-BR')} h</span> ≈ {(e.ageH / hpy).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} anos
                          {e.ageH < f.lifeH * 0.95 && <span className="block text-amber-800">antes da vida útil ({Math.round(f.lifeH).toLocaleString('pt-BR')} h)</span>}
                        </>
                      ) : '—'}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-t border-black/5">
                <td className="py-1 pr-3 text-xs text-black/60">Trocar o equipamento</td>
                {cols.map((c) => (
                  <td key={c.id} className="py-1 pr-2">
                    <select className={inputCls} value={c.get().replaceAtEconomic ? 'eco' : 'vida'} onChange={(e) => c.set({ replaceAtEconomic: e.target.value === 'eco' })} aria-label={`Troca – ${c.name}`}>
                      <option value="vida">Ao fim da vida útil</option>
                      <option value="eco">Na idade ideal (econômica)</option>
                    </select>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-black/45">
          Troca ideal: idade em que o custo médio por hora (compra − valor de mercado + manutenção acumulada) é o menor; depois dela, manter o equipamento custa mais que trocar. O alerta aparece em Resultados e decisão quando a frota passa dessa idade.
          Vida útil e desgaste: cada equipamento acumula as horas trabalhadas em cada período; ao atingir a vida útil é trocado por um novo (compra − valor residual).
          A manutenção por hora sobe com a idade e a disponibilidade cai, o que pode exigir mais caminhões nos últimos períodos. No fim do horizonte, a frota é creditada pelo valor depreciado.
        </p>
      </Card>
    </fieldset>
  );
};

export default FinanceView;
