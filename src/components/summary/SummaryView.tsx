import React, { useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronDown,
  Factory,
  Gauge,
  PackageCheck,
  Settings2,
  Shovel,
  Truck,
  Wrench,
} from 'lucide-react';
import type { DetailedPremises, EquipmentCatalog, LoaderSetup, Route, RouteKind } from '@/types';
import {
  DEFAULT_CATALOG,
  DEFAULT_LOOSE_DENSITY,
  KIND_LABELS,
  applySuggestedFleet,
  routeKind,
  type Action,
  type FleetAnalysis,
  type RouteAnalysis,
  type Stage,
} from '@/engine/fleet';

/* -------------------------------------------------------------------------- */
/* Formatação                                                                  */
/* -------------------------------------------------------------------------- */

const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pctTxt = (r: number) => (Number.isFinite(r) ? `${Math.round(r * 100)}%` : '—');

function tone(ratio: number) {
  if (!Number.isFinite(ratio)) return 'ok';
  if (ratio < 0.999) return 'falta';
  if (ratio < 1.1) return 'justo';
  return 'ok';
}
const TONE = {
  falta: { bar: 'bg-red-500', text: 'text-red-700', chip: 'bg-red-50 text-red-700 ring-red-200', label: 'Não atende' },
  justo: { bar: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-800 ring-amber-200', label: 'No limite' },
  ok: { bar: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'Atende' },
} as const;

/* -------------------------------------------------------------------------- */
/* Peças                                                                       */
/* -------------------------------------------------------------------------- */

const STAGE_ICON: Record<Stage['id'], React.ElementType> = {
  carga: Shovel,
  transporte_rom: Truck,
  planta: Factory,
  produto: PackageCheck,
  rejeito: Truck,
  esteril: Truck,
};

const StageBar: React.FC<{ stage: Stage; isBottleneck: boolean }> = ({ stage, isBottleneck }) => {
  const tn = TONE[tone(stage.ratio)];
  const Icon = STAGE_ICON[stage.id];
  // escala até 150% para a marca de 100% ficar visível
  const width = Math.min(stage.ratio / 1.5, 1) * 100;
  return (
    <div className={clsx('rounded-xl border p-4', isBottleneck ? 'border-black/25 bg-white' : 'border-black/[0.07] bg-white')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-black/45" aria-hidden />
          <span className="font-medium">{stage.label}</span>
          {isBottleneck && (
            <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', stage.ratio < 0.999 ? 'bg-red-600 text-white' : 'bg-black/[0.07] text-black/70')}>
              {stage.ratio < 0.999 ? 'Gargalo' : 'Etapa mais apertada'}
            </span>
          )}
        </div>
        <span className={clsx('text-sm font-semibold tabular-nums', tn.text)}>{pctTxt(stage.ratio)}</span>
      </div>
      <div className="relative mt-3 h-2.5 rounded-full bg-black/[0.06]" role="img" aria-label={`${stage.label}: capacidade de ${pctTxt(stage.ratio)} da necessidade`}>
        <div className={clsx('h-full rounded-full', tn.bar)} style={{ width: `${width}%` }} />
        <div className="absolute top-[-3px] h-[calc(100%+6px)] w-0.5 bg-black/60" style={{ left: `${100 / 1.5}%` }} title="Meta (100%)" />
      </div>
      <p className="mt-2 text-xs text-black/50 tabular-nums">
        Capacidade {t0(stage.capacityT)} t · necessidade {t0(stage.needT)} t por mês (base {stage.basis})
      </p>
    </div>
  );
};

const ACTION_ICON: Record<Action['kind'], React.ElementType> = {
  planta: Factory,
  deficit: AlertTriangle,
  remanejar: ArrowRightLeft,
  produtividade: Gauge,
  equipamento: Wrench,
  folga: CheckCircle2,
};

/* -------------------------------------------------------------------------- */
/* Editor de rota (carga, ciclo, tipo)                                         */
/* -------------------------------------------------------------------------- */

const inputCls =
  'w-full rounded-lg border border-black/12 bg-white px-2.5 py-1.5 text-sm tabular-nums focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 focus:outline-none disabled:bg-black/[0.03]';

const NumField: React.FC<{ label: string; value: number | undefined; onChange: (v: number) => void; step?: number; suffix?: string; hint?: string }> = ({
  label,
  value,
  onChange,
  step = 1,
  suffix,
  hint,
}) => {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-black/60">
        {label}
        {suffix && <span className="font-normal text-black/40"> ({suffix})</span>}
      </label>
      <input
        id={id}
        type="number"
        step={step}
        className={inputCls}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      {hint && <p className="mt-1 text-[11px] text-black/40">{hint}</p>}
    </div>
  );
};

const RouteEditor: React.FC<{
  route: Route;
  analysis: RouteAnalysis;
  catalog: EquipmentCatalog;
  onChange: (r: Route) => void;
}> = ({ route, analysis, catalog, onChange }) => {
  const set = <K extends keyof Route>(k: K, v: Route[K]) => onChange({ ...route, [k]: v });
  const setLoader = (patch: Partial<LoaderSetup>) =>
    onChange({ ...route, loader: { ...(route.loader ?? { name: '', count: 1, bucketM3: 2, fillFactor: 90, cycleSec: 24, availability: 85 }), ...patch } });
  const c = analysis.cycle;
  const parts = [
    { label: 'Carga', v: c.loadMin, cls: 'bg-amber-400' },
    { label: 'Ida carregado', v: c.travelLoadedMin, cls: 'bg-emerald-600' },
    { label: 'Descarga', v: c.dumpMin, cls: 'bg-sky-500' },
    { label: 'Volta vazio', v: c.travelEmptyMin, cls: 'bg-emerald-300' },
    { label: 'Pesagens', v: c.weighMin, cls: 'bg-violet-400' },
    { label: 'Fila/manobra', v: c.queueMin, cls: 'bg-red-400' },
  ].filter((p) => p.v > 0.01);

  return (
    <div className="space-y-5 border-t border-black/[0.06] bg-[#FAFAF8] px-5 py-5">
      <div>
        <p className="mb-2 text-xs font-medium text-black/60">
          Composição do ciclo calculado: {n1(c.calculatedMin)} min
          {c.mode === 'informed' && <span className="text-black/45"> (em uso: {n1(c.informedMin)} min informado)</span>}
        </p>
        <div className="flex h-3 overflow-hidden rounded-full bg-black/[0.06]">
          {parts.map((p) => (
            <div key={p.label} className={p.cls} style={{ width: `${(p.v / c.calculatedMin) * 100}%` }} title={`${p.label}: ${n1(p.v)} min`} />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-black/55">
          {parts.map((p) => (
            <span key={p.label} className="flex items-center gap-1.5">
              <span className={clsx('h-2 w-2 rounded-full', p.cls)} />
              {p.label} {n1(p.v)} min
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-black/60" htmlFor={`kind-${route.id}`}>
            Tipo de fluxo
          </label>
          <select id={`kind-${route.id}`} className={inputCls} value={routeKind(route)} onChange={(e) => set('kind', e.target.value as RouteKind)}>
            {(Object.keys(KIND_LABELS) as RouteKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-black/60" htmlFor={`mode-${route.id}`}>
            Tempo de ciclo
          </label>
          <select
            id={`mode-${route.id}`}
            className={inputCls}
            value={route.cycleMode ?? 'calculated'}
            onChange={(e) => set('cycleMode', e.target.value as Route['cycleMode'])}
          >
            <option value="calculated">Calcular pela DMT e velocidades</option>
            <option value="informed">Usar o cronometrado</option>
          </select>
        </div>
        {route.cycleMode === 'informed' ? (
          <NumField label="Ciclo cronometrado" suffix="min" step={0.1} value={route.cycleTime} onChange={(v) => set('cycleTime', v)} />
        ) : (
          <NumField label="Fila e manobra por ciclo" suffix="min" step={0.5} value={route.queueMin ?? 0} onChange={(v) => set('queueMin', v)} />
        )}
        <NumField
          label="Volume da caçamba"
          suffix="m³"
          step={0.5}
          value={route.truckVolumeM3}
          onChange={(v) => set('truckVolumeM3', v > 0 ? v : undefined)}
          hint="Opcional. Limita a carga pelo volume."
        />
      </div>

      <div className="rounded-xl border border-black/[0.07] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Shovel size={16} className="text-black/45" aria-hidden /> Equipamento de carga
          </p>
          <select
            aria-label="Equipamento de carga"
            className={clsx(inputCls, 'w-auto')}
            value={route.loader ? catalog.loaders.find((l) => l.name === route.loader!.name)?.id ?? 'custom' : 'none'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'none') return onChange({ ...route, loader: undefined });
              const l = catalog.loaders.find((x) => x.id === v);
              if (l) setLoader({ name: l.name, bucketM3: l.bucketM3, cycleSec: l.cycleSec });
            }}
          >
            <option value="none">Não modelar (usa o tempo de carga das premissas)</option>
            {catalog.loaders.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
            {route.loader && !catalog.loaders.some((l) => l.name === route.loader!.name) && <option value="custom">{route.loader.name || 'Personalizado'}</option>}
          </select>
        </div>
        {route.loader && (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <NumField label="Quantidade" step={1} value={route.loader.count} onChange={(v) => setLoader({ count: Math.max(0, Math.round(v)) })} />
              <NumField label="Caçamba" suffix="m³" step={0.1} value={route.loader.bucketM3} onChange={(v) => setLoader({ bucketM3: v })} />
              <NumField label="Enchimento" suffix="%" value={route.loader.fillFactor} onChange={(v) => setLoader({ fillFactor: v })} />
              <NumField label="Ciclo da caçambada" suffix="s" value={route.loader.cycleSec} onChange={(v) => setLoader({ cycleSec: v })} />
              <NumField label="Disponibilidade física" suffix="%" value={route.loader.availability} onChange={(v) => setLoader({ availability: v })} />
            </div>
            {analysis.loader && (
              <p className="mt-3 text-xs text-black/55">
                {analysis.loader.passes} caçambadas por caminhão ({n1(analysis.loader.loadMin)} min de carga)
                {analysis.loader.passesStatus !== 'ok' && <span className="text-amber-700"> · ideal: 3 a 6</span>}. Atende sem fila até{' '}
                {n1(analysis.loader.trucksToSaturate)} caminhões. Fator de compatibilidade: {n1(analysis.loader.matchFactor)}{' '}
                {analysis.loader.matchFactor > 1.05
                  ? '(caminhões esperando na carga)'
                  : analysis.loader.matchFactor < 0.95
                    ? '(carga esperando caminhão)'
                    : '(equilibrado)'}
                .
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Catálogo                                                                    */
/* -------------------------------------------------------------------------- */

const CatalogEditor: React.FC<{ premises: DetailedPremises; setPremises: (p: DetailedPremises) => void }> = ({ premises, setPremises }) => {
  const catalog = premises.equipmentCatalog ?? DEFAULT_CATALOG;
  const update = (c: EquipmentCatalog) => setPremises({ ...premises, equipmentCatalog: c });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-medium">Caminhões</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-black/45">
              <th className="py-1 font-medium">Classe</th>
              <th className="w-24 py-1 font-medium">Carga útil (t)</th>
              <th className="w-24 py-1 font-medium">Volume (m³)</th>
            </tr>
          </thead>
          <tbody>
            {catalog.trucks.map((t, i) => (
              <tr key={t.id}>
                <td className="py-1 pr-2">{t.name}</td>
                {(['payloadT', 'volumeM3'] as const).map((k) => (
                  <td key={k} className="py-1 pr-2">
                    <input
                      type="number"
                      aria-label={`${t.name}: ${k === 'payloadT' ? 'carga útil' : 'volume'}`}
                      className={inputCls}
                      value={t[k]}
                      onChange={(e) => update({ ...catalog, trucks: catalog.trucks.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)) })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Equipamentos de carga</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-black/45">
              <th className="py-1 font-medium">Classe</th>
              <th className="w-24 py-1 font-medium">Caçamba (m³)</th>
              <th className="w-24 py-1 font-medium">Ciclo (s)</th>
            </tr>
          </thead>
          <tbody>
            {catalog.loaders.map((l, i) => (
              <tr key={l.id}>
                <td className="py-1 pr-2">{l.name}</td>
                {(['bucketM3', 'cycleSec'] as const).map((k) => (
                  <td key={k} className="py-1 pr-2">
                    <input
                      type="number"
                      aria-label={`${l.name}: ${k === 'bucketM3' ? 'caçamba' : 'ciclo'}`}
                      className={inputCls}
                      value={l[k]}
                      onChange={(e) => update({ ...catalog, loaders: catalog.loaders.map((x, j) => (j === i ? { ...x, [k]: Number(e.target.value) } : x)) })}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-black/45 lg:col-span-2">
        Valores típicos de referência. Ajuste com os dados do fabricante ou com o que você mede na operação. Para voltar ao padrão,{' '}
        <button type="button" className="font-medium text-emerald-700 underline" onClick={() => update(DEFAULT_CATALOG)}>
          restaure o catálogo
        </button>
        .
      </p>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Tela                                                                        */
/* -------------------------------------------------------------------------- */

interface Props {
  analysis: FleetAnalysis;
  routes: Route[];
  setRoutes: (r: Route[]) => void;
  premises: DetailedPremises;
  setPremises: (p: DetailedPremises) => void;
  canEdit: boolean;
}

const SummaryView: React.FC<Props> = ({ analysis, routes, setRoutes, premises, setPremises, canEdit }) => {
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const a = analysis;
  const catalog = premises.equipmentCatalog ?? DEFAULT_CATALOG;
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const fleetMatches = a.routes.every((r) => r.trucksAllocated === r.trucksNeeded);
  const romPct = a.romTargetDryT > 0 ? a.romDeliverableDryT / a.romTargetDryT : 1;

  const headline = a.meetsTarget
    ? 'A operação atende a meta do mês'
    : a.bottleneck
      ? `A operação não atende a meta. Gargalo: ${a.bottleneck.label}`
      : 'Cadastre rotas para simular';

  return (
    <div className="space-y-8">
      {/* Veredito */}
      <section
        className={clsx(
          'rounded-2xl border p-6 sm:p-8',
          a.meetsTarget ? 'border-emerald-200 bg-emerald-50/60' : 'border-red-200 bg-red-50/60',
        )}
        aria-labelledby="veredito"
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <h3 id="veredito" className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
              {a.meetsTarget ? <CheckCircle2 className="shrink-0 text-emerald-600" /> : <AlertTriangle className="shrink-0 text-red-600" />}
              {headline}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-black/65">
              Com a frota e a carga cadastradas, chegam à planta <strong className="tabular-nums">{t0(a.romDeliverableDryT)} t</strong> de ROM
              no mês, de uma meta de <strong className="tabular-nums">{t0(a.romTargetDryT)} t</strong> ({pctTxt(romPct)}).
              {a.meetsTarget && a.bottleneck && (
                <> A etapa mais apertada é {a.bottleneck.label.toLowerCase()}, com {pctTxt(a.bottleneck.ratio)} da necessidade.</>
              )}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div>
              <dt className="text-black/50">Caminhões nas rotas</dt>
              <dd className="text-2xl font-semibold tabular-nums">{a.fleet.allocated}</dd>
            </div>
            <div>
              <dt className="text-black/50">Necessários</dt>
              <dd className="text-2xl font-semibold tabular-nums">{a.fleet.needed}</dd>
            </div>
            {a.fleet.idle > 0 && (
              <div className="col-span-2 text-xs text-black/55">{a.fleet.idle} caminhão(ões) não aumentam a produção (sobra ou fila na carga).</div>
            )}
          </dl>
        </div>
        {canEdit && !fleetMatches && (
          <button
            type="button"
            onClick={() => setRoutes(applySuggestedFleet(routes, a))}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#151619] px-4 py-2 text-sm font-semibold text-white hover:bg-black"
          >
            <Truck size={16} /> Ajustar as rotas para a frota necessária
          </button>
        )}
      </section>

      {/* Etapas */}
      <section aria-labelledby="etapas">
        <h3 id="etapas" className="mb-1 text-lg font-semibold">Capacidade de cada etapa</h3>
        <p className="mb-4 text-sm text-black/50">A barra mostra a capacidade em relação à necessidade do mês. O traço vertical é a meta (100%).</p>
        <div className="grid gap-3 md:grid-cols-2">
          {a.stages.map((s) => (
            <StageBar key={s.id} stage={s} isBottleneck={a.bottleneck?.id === s.id} />
          ))}
        </div>
      </section>

      {/* O que fazer */}
      <section aria-labelledby="acoes">
        <h3 id="acoes" className="mb-1 text-lg font-semibold">O que fazer</h3>
        <p className="mb-4 text-sm text-black/50">Em ordem de prioridade, com o efeito calculado sobre esta simulação.</p>
        {a.actions.length === 0 ? (
          <p className="rounded-xl border border-black/[0.07] bg-white p-5 text-sm text-black/55">Nenhuma ação necessária: a frota está dimensionada para a meta.</p>
        ) : (
          <ol className="space-y-2">
            {a.actions.map((x, i) => {
              const Icon = ACTION_ICON[x.kind];
              return (
                <li key={i} className="flex gap-4 rounded-xl border border-black/[0.07] bg-white p-4">
                  <span
                    className={clsx(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      x.kind === 'deficit' || x.kind === 'planta' ? 'bg-red-50 text-red-600' : x.kind === 'folga' ? 'bg-emerald-50 text-emerald-700' : 'bg-black/[0.04] text-black/60',
                    )}
                  >
                    <Icon size={17} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium">
                      <span className="mr-1.5 text-black/35 tabular-nums">{i + 1}.</span>
                      {x.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-black/60">{x.detail}</p>
                  </div>
                  {(x.trucksSaved ?? 0) > 0 && x.kind !== 'folga' && (
                    <span className="ml-auto shrink-0 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-emerald-800">
                      −{x.trucksSaved} caminhão(ões)
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Rotas */}
      <section aria-labelledby="rotas">
        <h3 id="rotas" className="mb-1 text-lg font-semibold">Frota por rota</h3>
        <p className="mb-4 text-sm text-black/50">Abra uma rota para ajustar o ciclo, a fila e o equipamento de carga.</p>
        <div className="overflow-hidden rounded-2xl border border-black/[0.07] bg-white">
          <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-4 border-b border-black/[0.06] px-5 py-2.5 text-xs text-black/45 md:grid">
            <span>Rota</span>
            <span className="text-right">Meta (t/mês úmida)</span>
            <span className="text-right">Ciclo</span>
            <span className="text-right">Caminhões tem / precisa</span>
            <span className="text-right">Capacidade</span>
            <span className="w-5" />
          </div>
          {a.routes.map((r) => {
            const tn = TONE[tone(r.ratio)];
            const open = openRoute === r.id;
            const route = routeById.get(r.id)!;
            return (
              <div key={r.id} className="border-b border-black/[0.06] last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenRoute(open ? null : r.id)}
                  aria-expanded={open}
                  className="grid w-full grid-cols-2 gap-x-4 gap-y-1 px-5 py-3.5 text-left text-sm hover:bg-black/[0.015] md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] md:items-center"
                >
                  <span className="col-span-2 md:col-span-1">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-black/45">
                      {KIND_LABELS[r.kind]} · {n1(r.payloadT)} t por viagem{r.loader ? ` · ${r.loader.count}× ${r.loader.name}` : ''}
                    </span>
                  </span>
                  <span className="tabular-nums md:text-right">{t0(r.targetWetT)} t</span>
                  <span className="tabular-nums md:text-right">
                    {n1(r.cycle.totalMin)} min{r.cycle.mode === 'informed' && <span className="text-black/40"> (cronom.)</span>}
                  </span>
                  <span className="tabular-nums md:text-right">
                    {r.trucksAllocated} / <strong>{r.trucksNeeded}</strong>
                  </span>
                  <span className="md:text-right">
                    <span className={clsx('inline-block rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tn.chip)}>
                      {pctTxt(r.ratio)}
                      {r.limitedBy === 'carga' ? ' · carga' : ''}
                    </span>
                  </span>
                  <ChevronDown size={18} className={clsx('hidden text-black/35 transition-transform md:block', open && 'rotate-180')} aria-hidden />
                </button>
                {open && (
                  <fieldset disabled={!canEdit}>
                    <RouteEditor
                      route={route}
                      analysis={r}
                      catalog={catalog}
                      onChange={(nr) => setRoutes(routes.map((x) => (x.id === nr.id ? nr : x)))}
                    />
                  </fieldset>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-black/45">
          Horas efetivas por caminhão = horas do calendário × disponibilidade física × utilização × eficiência operacional. Massa úmida = seca ÷ (1 −
          umidade) × (1 + perdas).
        </p>
      </section>

      {/* Comparador */}
      {a.classComparison && (
        <section aria-labelledby="classes">
          <h3 id="classes" className="mb-1 text-lg font-semibold">Qual caminhão atende "{a.classComparison.routeName}"?</h3>
          <p className="mb-4 text-sm text-black/50">Quantidade necessária de cada classe para a meta desta rota, mantendo DMT, velocidades e eficiências.</p>
          <div className="overflow-x-auto rounded-2xl border border-black/[0.07] bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-black/[0.06] text-left text-xs text-black/45">
                  <th className="px-5 py-2.5 font-medium">Classe</th>
                  <th className="px-3 py-2.5 text-right font-medium">Carga por viagem</th>
                  <th className="px-3 py-2.5 text-right font-medium">Caçambadas</th>
                  <th className="px-5 py-2.5 text-right font-medium">Caminhões necessários</th>
                </tr>
              </thead>
              <tbody>
                {a.classComparison.options.map((o) => (
                  <tr key={o.truck.id} className={clsx('border-b border-black/[0.04] last:border-b-0', o.current && 'bg-emerald-50/50')}>
                    <td className="px-5 py-2.5">
                      {o.truck.name}
                      {o.current && <span className="ml-2 text-xs text-emerald-700">atual</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{n1(o.payloadT)} t</td>
                    <td className={clsx('px-3 py-2.5 text-right tabular-nums', o.passesStatus && o.passesStatus !== 'ok' && 'text-amber-700')}>
                      {o.passes ?? '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular-nums">
                      {o.trucksNeeded} <span className="font-normal text-black/40">({n1(o.trucksNeededExact)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-black/45">
            Menos caminhões não significa menor custo: compare o custo horário de cada classe e confira largura de vias, raio de curva e a carga
            (o ideal é de 3 a 6 caçambadas por caminhão).
          </p>
        </section>
      )}

      {/* Parâmetros */}
      <section className="rounded-2xl border border-black/[0.07] bg-white">
        <button
          type="button"
          onClick={() => setShowCatalog((v) => !v)}
          aria-expanded={showCatalog}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <span className="flex items-center gap-2 font-medium">
            <Settings2 size={17} className="text-black/45" aria-hidden /> Material e catálogo de equipamentos
          </span>
          <ChevronDown size={18} className={clsx('text-black/35 transition-transform', showCatalog && 'rotate-180')} aria-hidden />
        </button>
        {showCatalog && (
          <fieldset disabled={!canEdit} className="space-y-6 border-t border-black/[0.06] px-5 py-5">
            <div className="max-w-xs">
              <NumField
                label="Densidade do material solto (úmido)"
                suffix="t/m³"
                step={0.05}
                value={premises.looseDensity ?? DEFAULT_LOOSE_DENSITY}
                onChange={(v) => setPremises({ ...premises, looseDensity: v })}
                hint="Usada para caçambadas e limite de volume dos caminhões."
              />
            </div>
            <CatalogEditor premises={premises} setPremises={setPremises} />
          </fieldset>
        )}
      </section>
    </div>
  );
};

export default SummaryView;
