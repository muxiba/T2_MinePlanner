import React, { useMemo } from 'react';
import { processPct } from '@/engine/process';
import { createPortal } from 'react-dom';
import type { DetailedPremises, Route } from '@/types';
import { targetLabels, catalogOf, fmtTrucks, KIND_LABELS, sumCalendarHours, type FleetAnalysis } from '@/engine/fleet';
import { flowSvg } from '@/components/FlowDiagram';
import { buildFleetReport } from '@/engine/fleetReport';
import { fleetTypesOf, hourlyCost, mixedOn } from '@/engine/mix';
import { transportMode, transportTargetMonth } from '@/engine/network';
import { mapSvg } from '@/sim/mapSvg';
import { fleetScenarios } from '@/engine/optimize';
import { t0, n1, n2, pc, KIND_COLOR, FlowBox, Arrow, HoursCascade, CycleBars, StageBar } from './parts';

/**
 * Relatório impresso da memória de cálculo (A4, colorido). Fica oculto na tela e
 * é o único conteúdo da página durante a impressão (o app some via CSS).
 */

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

interface Props {
  analysis: FleetAnalysis;
  premises: DetailedPremises;
  results: any;
  companyName?: string;
  planName?: string;
  /** movimentações (rede de fluxos) para o desenho, a frota por tipo, a carga e o mapa */
  routes?: Route[];
}

const PAGE_CSS = `
@page { size: A4; margin: 13mm 12mm 15mm 12mm;
  @bottom-left { content: "T2MinePlanner · Memória de cálculo"; font: 7.5pt Inter, sans-serif; color: #8a8f98; }
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 7.5pt Inter, sans-serif; color: #8a8f98; }
}
@media screen { .calc-report { display: none; } }
@media print {
  html, body { background: #fff !important; height: auto !important; overflow: visible !important; }
  body.printing-report > *:not(.calc-report) { display: none !important; }
  .calc-report { display: block; }
  .calc-report, .calc-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .calc-report .avoid { break-inside: avoid; page-break-inside: avoid; }
  .calc-report .page-break { break-before: page; page-break-before: always; }
  .calc-report h2 { break-after: avoid; }
  .calc-report .fig svg { width: 100%; height: auto; display: block; }
}
`;

export const CalcReport: React.FC<Props> = ({ analysis: a, premises: p, results, companyName, planName, routes = [] }) => {
  const tm = transportMode(p);
  const meta = transportTargetMonth(p);
  const net = flowSvg(routes, p);
  const map = mapSvg(p.simulation, routes, p);
  const rep = buildFleetReport(routes, p);
  const mixed = mixedOn(p);
  const cat = catalogOf(p);
  const lname = (id?: string) => (id === 'silo' ? 'Silo / correia' : cat.loaders.find((l) => l.id === id)?.name ?? '—');
  const run = p.simulation?.lastRun;
  const tmOk = a.routes.every((r) => r.ratio >= 0.999);
  const delivered = tm ? a.routes.filter((r) => !(p.nodes ?? []).some((n) => n.group === 'passagem' && routes.find((x) => x.id === r.id)?.toId === n.id)).reduce((acc, r) => acc + r.targetDryT, 0) : 0;
  const f = a.fleet;
  const b = a.bottleneck;
  const now = new Date();
  const period = `${MONTHS[p.month] ?? ''} de ${p.year}`;
  const calMina = sumCalendarHours(p, 'mina');
  const calPlanta = sumCalendarHours(p, 'planta');
  const rom = a.routes.filter((r) => r.kind === 'rom');
  const romWet = rom.reduce((s, r) => s + r.targetWetT, 0);
  const prodDry = a.routes.filter((r) => r.kind === 'product').reduce((s, r) => s + r.targetDryT, 0);
  const tailDry = a.routes.filter((r) => r.kind === 'tailings').reduce((s, r) => s + r.targetDryT, 0);
  const plantStage = a.stages.find((s) => s.id === 'planta');
  const mineEff = rom[0]?.hours.effective ?? calMina * (p.dfMina / 100) * (p.ufMina / 100);

  const premisesRows: [string, string][] = [
    ['Meta de ROM (consumo da planta)', `${t0(p.targetMonthlyROM)} t seca/mês`],
    ['Processo', p.processType === 'umido' ? 'A úmido' : 'A seco'],
    ['Recuperação mássica (produto)', `${n1(processPct(p).rm)}%`],
    ['Rejeito', `${n1(processPct(p).rej)}%`],
    ['Perda de processo (não transportada)', `${n1(processPct(p).loss)}%`],
    ['Umidade natural / perdas', `${n1(p.umidadeNatural)}% / ${n1(p.perdaMaterial)}%`],
    ['Taxa de alimentação da planta', `${t0(p.plantFeedRateTPH)} t/h`],
    ['DF / UF da mina', `${n1(p.dfMina)}% / ${n1(p.ufMina)}%`],
    ['DF / UF da planta', `${n1(p.dfPlanta)}% / ${n1(p.ufPlanta)}%`],
    ['Frota', `${f.premise} caminhões de ${n1(p.truckCapacity)} t${p.truckVolumeM3 ? ` (${n1(p.truckVolumeM3)} m³)` : ''}`],
    ['Velocidade carregado / vazio', `${n1(p.velocidadeCheio)} / ${n1(p.velocidadeVazio)} km/h`],
    ['Carga / basculamento', `${n1(p.loadingTime)} / ${n1(p.dumpingTime)} min`],
    ['Pesagem carregado / vazio', `${n1(p.weighingTimeLoaded)} / ${n1(p.weighingTimeEmpty)} min`],
    ['Fila por ciclo', `${n1(p.queueMin ?? 0)} min`],
    ['Calendário', `${p.calendarDays} dias · ${t0(calMina)} h mina · ${t0(calPlanta)} h planta`],
    ['Modo da rede', tm ? 'Só transporte (origem → destino)' : 'Processo (mina → planta → produto/rejeito)'],
    ...(tm ? ([['Meta de transporte', meta.tph > 0 ? `${t0(meta.tph)} t/h = ${t0(meta.monthT)} t/mês` : 'pela massa de cada movimentação']] as [string, string][]) : []),
    ['Frota por tipo', mixed ? fleetTypesOf(p).map((t) => `${t.count}× ${t.cls.name}`).join(' + ') : 'um tipo'],
    ['Distribuição da frota', mixed ? ({ auto: 'automática (menor custo por t)', manual: 'manual', estatistico: 'estatística (caminhões compartilhados)' } as Record<string, string>)[p.mixMode ?? 'auto'] : '—'],
    ['Equipamento de carga padrão', p.defaultLoaderClassId ? lname(p.defaultLoaderClassId) : 'tempo de carga das premissas'],
  ];
  const tmRows = tm ? premisesRows.filter((r) => !/Meta de ROM|Processo|Recuperação|Rejeito|Perda de processo|Taxa de alimentação|da planta/.test(r[0])) : premisesRows;

  return createPortal(
    <div className="calc-report bg-white font-sans text-[10pt] leading-snug text-[#1A1A1A]">
      <style>{PAGE_CSS}</style>

      {/* ------------------------------ capa ------------------------------ */}
      <header className="avoid overflow-hidden rounded-xl">
        <div className="flex items-center justify-between bg-[#151619] px-6 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500" />
            <span className="text-[13pt] font-bold tracking-tight">T2MinePlanner</span>
          </div>
          <span className="text-[9pt] tracking-widest text-white/70 uppercase">Memória de cálculo · {period}</span>
        </div>
        <div className="border-x border-b border-black/10 bg-[#F6F8F7] px-6 py-4">
          <h1 className="text-[18pt] font-bold tracking-tight">Dimensionamento de frota e balanço de massas</h1>
          <p className="mt-1 text-[9pt] text-black/55">
            {companyName ? `${companyName} · ` : ''}
            {planName ? `${planName} · ` : ''}
            Emitido em {now.toLocaleDateString('pt-BR')} às {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </header>

      {/* ------------------------------ veredito ------------------------------ */}
      {tm ? (
        <div className={`avoid mt-4 rounded-xl border-l-4 px-4 py-3 ${tmOk ? 'border-emerald-600 bg-emerald-50 text-emerald-950' : 'border-red-600 bg-red-50 text-red-950'}`}>
          <p className="text-[10.5pt]">
            <b>{tmOk ? 'A frota atende todas as movimentações.' : 'A frota não atende todas as movimentações.'}</b> Só transporte: {t0(delivered)} t secas entregues nos destinos no mês
            {meta.tph > 0 ? ` (meta ${t0(meta.tph)} t/h = ${t0(meta.monthT)} t/mês, ${pc(meta.monthT ? delivered / meta.monthT : 1)})` : ''}, com {fmtTrucks(f.allocated)} dos {f.premise} caminhões.
          </p>
        </div>
      ) : null}
      {!tm && (<>
      <div className={`avoid mt-4 rounded-xl border-l-4 px-4 py-3 ${a.meetsTarget ? 'border-emerald-600 bg-emerald-50 text-emerald-950' : 'border-red-600 bg-red-50 text-red-950'}`}>
        <p className="text-[10.5pt]">
          {a.meetsTarget ? (
            <>
              <b>O plano atende a meta.</b> Chegam à planta {t0(a.romDeliverableDryT)} t de ROM no mês (meta {t0(a.romTargetDryT)} t), com {fmtTrucks(f.allocated)} dos {f.premise} caminhões nas rotas.
              {b ? ` A etapa mais justa é ${b.label.toLowerCase()}, com ${pc(b.ratio)} da necessidade.` : ''}
            </>
          ) : (
            <>
              <b>O plano não atende a meta.</b> Chegam {t0(a.romDeliverableDryT)} t de {t0(a.romTargetDryT)} t ({pc(a.romTargetDryT ? a.romDeliverableDryT / a.romTargetDryT : 0)}).
              {b ? ` O gargalo é ${b.label.toLowerCase()}: capacidade de ${t0(b.capacityT)} t para ${t0(b.needT)} t necessárias.` : ''}
            </>
          )}
        </p>
      </div>

      {/* ------------------------------ indicadores ------------------------------ */}
      <div className="avoid mt-3 grid grid-cols-4 gap-2">
        <RKpi label={targetLabels(p).target} value={`${t0(a.romTargetDryT)} t`} sub="seca por mês" />
        <RKpi label={targetLabels(p).delivered} value={`${t0(a.romDeliverableDryT)} t`} sub={`${pc(a.romTargetDryT ? a.romDeliverableDryT / a.romTargetDryT : 1)} da meta · possível ${t0(a.romPossibleDryT)} t`} tone={a.meetsTarget ? 'ok' : 'bad'} />
        <RKpi label="Caminhões" value={`${f.premise} / ${fmtTrucks(f.allocated)} / ${f.needed}`} sub={`frota / nas rotas / necessários (${n2(f.neededExact)} exatos)`} />
        <RKpi label="Etapa mais justa" value={b ? pc(b.ratio) : '—'} sub={b?.label ?? ''} tone={b && b.ratio < 0.999 ? 'bad' : 'ok'} />
      </div>

      </>)}

      {/* ------------------------------ premissas ------------------------------ */}
      <RSection title="Premissas utilizadas">
        <table className="w-full text-[9pt]">
          <tbody>
            {Array.from({ length: Math.ceil(tmRows.length / 2) }, (_, i) => (
              <tr key={i} className="border-b border-black/5">
                {[tmRows[i * 2], tmRows[i * 2 + 1]].map((row, j) =>
                  row ? (
                    <React.Fragment key={j}>
                      <td className="py-1 pr-2 text-black/55">{row[0]}</td>
                      <td className="py-1 pr-4 text-right font-mono font-semibold">{row[1]}</td>
                    </React.Fragment>
                  ) : (
                    <td key={j} colSpan={2} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </RSection>

      {/* ------------------------------ 1 ------------------------------ */}
      {!tm && <RSection n={1} title="Do objetivo às massas transportadas" note={`Massa úmida = seca ${p.moistureMode === 'base_umida' ? `÷ (1 − ${n1(p.umidadeNatural)}%) × (1 + ${n1(p.perdaMaterial)}%)` : `× (1 + ${n1(p.umidadeNatural)}% umidade + ${n1(p.perdaMaterial)}% perda)`}. Produto e rejeito saem do ROM pela recuperação mássica.`}>
        <div className="flex items-stretch gap-1.5 text-[9pt]">
          <FlowBox color="#059669" title="ROM na mina" main={`${t0(a.romTargetDryT)} t seca`} lines={[`${t0(romWet)} t úmidas transportadas`, `${n1(mineEff ? romWet / mineEff : 0)} t/h efetiva`]} />
          <Arrow />
          <FlowBox color="#334155" title="Planta" main={`${t0(plantStage?.capacityT ?? 0)} t de capacidade`} lines={[`${t0(p.plantFeedRateTPH)} t/h × ${t0(a.planta.effective)} h efetivas`, plantStage ? `${pc(plantStage.ratio)} da alimentação necessária` : '']} warn={!!plantStage && plantStage.ratio < 0.999} />
          <Arrow />
          <div className="flex flex-1 flex-col gap-1.5">
            <FlowBox color="#2563eb" title={`Produto (${n1(processPct(p).rm)}%)`} main={`${t0(prodDry)} t seca`} lines={['expedição']} />
            {p.processType === 'umido' && <FlowBox color="#d97706" title={`Rejeito (${n1(processPct(p).rej)}%)`} main={`${t0(tailDry)} t seca`} lines={['disposição']} />}
          </div>
        </div>
      </RSection>}

      {/* ------------------------------ 2 ------------------------------ */}
      <RSection n={2} title="Horas disponíveis no mês" note="Horas efetivas = horas de calendário × DF (disponibilidade física) × UF (utilização). São as horas em que cada caminhão realmente transporta.">
        <div className="grid grid-cols-2 gap-6">
          <HoursCascade title="Mina (ROM e estéril)" cal={calMina} df={p.dfMina} uf={p.ufMina} />
          {!tm && <HoursCascade title="Planta (produto e rejeito)" cal={calPlanta} df={p.dfPlanta} uf={p.ufPlanta} />}
        </div>
      </RSection>

      {/* ------------------------------ 3 ------------------------------ */}
      <RSection n={3} title="Ciclo de cada caminhão" note="Ciclo = carga + viagem cheio + descarga + viagem vazio + pesagens + paradas no trajeto + fila + interferências. Viagens por hora = 60 ÷ ciclo.">
        <CycleBars routes={a.routes} />
        <table className="mt-3 w-full text-[8.5pt]">
          <thead>
            <tr className="border-b border-black/15 text-left text-black/50">
              <th className="py-1 font-medium">Rota</th>
              {['Carga', 'Ida cheio', 'Descarga', 'Volta vazio', 'Pesagens', 'Paradas', 'Fila', 'Interf.', 'Ciclo'].map((h) => (
                <th key={h} className="w-[10%] py-1 pl-2 text-right font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {a.routes.map((r) => (
              <tr key={r.id} className="border-b border-black/5">
                <td className="py-1">{r.name}</td>
                {[r.cycle.loadMin, r.cycle.travelLoadedMin, r.cycle.dumpMin, r.cycle.travelEmptyMin, r.cycle.weighMin, r.cycle.stopsMin ?? 0, r.cycle.queueMin, r.cycle.interferenceMin ?? 0].map((v, i) => (
                  <td key={i} className="py-1 text-right font-mono">{n1(v)}</td>
                ))}
                <td className="py-1 text-right font-mono font-bold">{n1(r.cycle.totalMin)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </RSection>

      {/* ------------------------------ 4 ------------------------------ */}
      <RSection n={4} title="Frota necessária por rota" note="Caminhões necessários = meta úmida ÷ (carga útil × viagens por hora × horas efetivas). O número exato é arredondado para cima em cada rota.">
        <table className="w-full text-[8.5pt]">
          <thead>
            <tr className="border-b border-black/15 text-left text-black/50">
              <th className="py-1 font-medium">Rota</th>
              <th className="py-1 text-right font-medium">Meta úmida</th>
              <th className="py-1 text-right font-medium">Carga útil</th>
              <th className="py-1 text-right font-medium">t/h por cam.</th>
              <th className="py-1 text-right font-medium">Horas ef.</th>
              <th className="py-1 text-right font-medium">t/mês por cam.</th>
              <th className="py-1 text-right font-medium">Necessários</th>
              <th className="py-1 text-right font-medium">Na rota</th>
              <th className="py-1 text-right font-medium">Atend.</th>
            </tr>
          </thead>
          <tbody>
            {a.routes.map((r) => (
              <tr key={r.id} className="border-b border-black/5">
                <td className="py-1.5">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[r.kind] }} />
                  <b className="font-semibold">{r.name}</b>
                  <span className="block pl-3.5 text-[7.5pt] text-black/45">{tm ? routes.find((x) => x.id === r.id)?.materialName || 'Transporte' : KIND_LABELS[r.kind]}</span>
                </td>
                <td className="py-1.5 text-right font-mono">{t0(r.targetWetT)} t</td>
                <td className="py-1.5 text-right font-mono">{n1(r.payloadT)} t</td>
                <td className="py-1.5 text-right font-mono">{n1(r.truckRateTph)}</td>
                <td className="py-1.5 text-right font-mono">{t0(r.hours.effective)} h</td>
                <td className="py-1.5 text-right font-mono">{t0(r.truckMonthT)} t</td>
                <td className="py-1.5 text-right font-mono"><b>{r.trucksNeeded}</b> <span className="text-black/45">({n2(r.trucksNeededExact)})</span></td>
                <td className="py-1.5 text-right font-mono">{fmtTrucks(r.trucksAllocated)}</td>
                <td className={`py-1.5 text-right font-mono font-bold ${r.ratio >= 0.999 ? 'text-emerald-700' : 'text-red-600'}`}>{pc(r.ratio)}</td>
              </tr>
            ))}
            <tr className="bg-[#F6F8F7]">
              <td className="py-1.5 font-bold" colSpan={6}>Total</td>
              <td className="py-1.5 text-right font-mono"><b>{f.needed}</b> <span className="text-black/45">({n2(f.neededExact)})</span></td>
              <td className="py-1.5 text-right font-mono font-bold">{fmtTrucks(f.allocated)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </RSection>

      {/* ------------------------------ 5 ------------------------------ */}
      <RSection n={5} title="Capacidade × necessidade por etapa" note="A produção que chega à planta é limitada pela etapa mais justa do caminho mina → planta. Acima de 100%, a etapa tem folga. O traço preto marca 100%.">
        <div className="space-y-2">
          {a.stages.filter((s) => !tm || s.id !== 'planta').map((s) => (
            <StageBar key={s.id} label={s.label} need={s.needT} cap={s.capacityT} ratio={s.ratio} basis={s.basis} isBottleneck={b?.id === s.id} />
          ))}
        </div>
      </RSection>

      {/* ------------------------------ 6 ------------------------------ */}
      {!tm && <RSection n={6} title="Acompanhamento do mês (lançamentos)" note="Planejado = meta diária das premissas. Realizado = ROM lançado em Lançamento Produção.">
        <Tracking results={results} target={p.targetMonthlyROM} />
      </RSection>}

      {/* ------------------------------ 7 ------------------------------ */}
      {a.actions.length > 0 && (
        <RSection n={7} title="O que fazer">
          <ol className="space-y-1.5">
            {a.actions.slice(0, 5).map((x, i) => (
              <li key={i} className="avoid flex gap-2.5 rounded-lg bg-[#F6F8F7] px-3 py-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#151619] text-[8pt] font-bold text-white">{i + 1}</span>
                <div>
                  <p className="font-semibold">{x.title}</p>
                  <p className="text-[9pt] text-black/60">{x.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </RSection>
      )}

      {/* ------------------------------ 8 rede ------------------------------ */}
      {routes.length > 0 && (
        <RSection n={8} title="Rede de fluxos: locais, movimentações e massas" note={tm ? 'Só transporte: massas informadas por movimentação ou pela meta; pontos de passagem repassam o que recebem (± variação de estoque).' : 'Massas do balanço: ROM das frentes pela participação, produto e rejeito pela recuperação mássica, estoques repassam o que recebem (± variação).'}>
          {net && <div className="fig avoid mb-3 overflow-hidden rounded-lg border border-black/10" dangerouslySetInnerHTML={{ __html: net }} />}
          <table className="w-full text-[8.5pt]">
            <thead>
              <tr className="border-b border-black/15 text-left text-black/50">
                <th className="py-1 font-medium">Movimentação</th>
                <th className="py-1 font-medium">Material</th>
                <th className="py-1 text-right font-medium">DMT</th>
                <th className="py-1 text-right font-medium">Massa seca</th>
                <th className="py-1 text-right font-medium">Massa úmida</th>
                <th className="py-1 font-medium pl-2">Paradas no trajeto</th>
                <th className="py-1 font-medium">DXF</th>
              </tr>
            </thead>
            <tbody>
              {a.routes.map((r) => {
                const rt = routes.find((x) => x.id === r.id);
                return (
                  <tr key={r.id} className="border-b border-black/5">
                    <td className="py-1">{r.name}</td>
                    <td className="py-1">{rt?.materialName || KIND_LABELS[r.kind].split(' (')[0]}</td>
                    <td className="py-1 text-right font-mono">{t0(rt?.distance ?? 0)} m</td>
                    <td className="py-1 text-right font-mono">{t0(r.targetDryT)} t</td>
                    <td className="py-1 text-right font-mono">{t0(r.targetWetT)} t</td>
                    <td className="py-1 pl-2">{rt?.stops?.length ? rt.stops.map((x) => `${x.name} (${t0(x.distM)} m, ${n1(x.stopMin)} min, ${x.dir})`).join('; ') : '—'}</td>
                    <td className="py-1">{rt?.geo?.length ? `${rt.geo.length} período(s)` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </RSection>
      )}

      {/* ------------------------------ 9 frota por tipo ------------------------------ */}
      {mixed && (
        <RSection n={9} title="Frota por tipo de caminhão" note={`Distribuição ${({ auto: 'automática, pelo menor custo por tonelada (custo horário ÷ t/h na rota), sem caminhão fora de estrada em estrada pública', manual: 'manual, definida por movimentação', estatistico: 'estatística: caminhões compartilhados entre as rotas; frota do tipo = soma das frações arredondada para cima' } as Record<string, string>)[p.mixMode ?? 'auto']}.`}>
          <table className="w-full text-[8.5pt]">
            <thead>
              <tr className="border-b border-black/15 text-left text-black/50">
                <th className="py-1 font-medium">Modelo</th>
                <th className="py-1 text-right font-medium">Quantidade</th>
                <th className="py-1 text-right font-medium">Carga útil</th>
                <th className="py-1 text-right font-medium">Vel. cheio / vazio</th>
                <th className="py-1 text-right font-medium">Custo por hora</th>
                <th className="py-1 text-right font-medium">Necessários</th>
              </tr>
            </thead>
            <tbody>
              {fleetTypesOf(p).map((t) => (
                <tr key={t.classId} className="border-b border-black/5">
                  <td className="py-1">{t.cls.manufacturer ? `${t.cls.manufacturer} ` : ''}{t.cls.name}</td>
                  <td className="py-1 text-right font-mono">{t.count}</td>
                  <td className="py-1 text-right font-mono">{n1(t.cls.payloadT)} t</td>
                  <td className="py-1 text-right font-mono">{n1(t.speedLoaded || p.velocidadeCheio)} / {n1(t.speedEmpty || p.velocidadeVazio)} km/h</td>
                  <td className="py-1 text-right font-mono">R$ {t0(hourlyCost(t.cls, p))}</td>
                  <td className="py-1 text-right font-mono">{t0(rep.byType.find((b) => b.classId === t.classId)?.required ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="mt-2 w-full text-[8.5pt]">
            <tbody>
              {a.routes.filter((r) => r.mix?.length).map((r) => (
                <tr key={r.id} className="border-b border-black/5">
                  <td className="py-1">{r.name}</td>
                  <td className="py-1">{r.mix!.map((m) => `${m.count.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}× ${m.name} (${n1(m.payloadT)} t, ciclo ${n1(m.cycleMin)} min)`).join(' + ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </RSection>
      )}

      {/* ------------------------------ 10 carga ------------------------------ */}
      {a.loaderNeeds.length > 0 && (
        <RSection n={10} title="Equipamentos de carga por local" note="Necessários = horas de uso no mês ÷ horas efetivas de um equipamento (calendário × DF × UF). Carregar caminhões: caminhões carregados × tempo de carga. Alimentar a planta: massa que chega ÷ produção do equipamento.">
          <table className="w-full text-[8.5pt]">
            <thead>
              <tr className="border-b border-black/15 text-left text-black/50">
                <th className="py-1 font-medium">Local</th>
                <th className="py-1 font-medium">Equipamento</th>
                <th className="py-1 font-medium">Função</th>
                <th className="py-1 text-right font-medium">Caçambadas</th>
                <th className="py-1 text-right font-medium">Carga / produção</th>
                <th className="py-1 text-right font-medium">Horas de uso</th>
                <th className="py-1 text-right font-medium">Necessários</th>
                <th className="py-1 text-right font-medium">Disponíveis</th>
                <th className="py-1 text-right font-medium">Ocupação</th>
              </tr>
            </thead>
            <tbody>
              {a.loaderNeeds.map((l, i) => (
                <tr key={i} className="border-b border-black/5">
                  <td className="py-1">{l.where}</td>
                  <td className="py-1">{l.loaderName}</td>
                  <td className="py-1">{l.role === 'alimentacao' ? 'alimentar a planta' : l.source === 'rota' ? 'carregar (rota)' : `carregar: ${l.routeIds.map((id) => routes.find((x) => x.id === id)?.name ?? '').join(', ')}`}</td>
                  <td className="py-1 text-right font-mono">{l.role === 'alimentacao' ? '—' : n1(l.passes)}</td>
                  <td className="py-1 text-right font-mono">{l.role === 'alimentacao' ? `${t0(l.feedTph ?? 0)} t/h` : `${n1(l.loadMin)} min`}</td>
                  <td className="py-1 text-right font-mono">{t0(l.busyH)} h</td>
                  <td className="py-1 text-right font-mono"><b>{l.needed}</b> ({n2(l.neededExact)})</td>
                  <td className="py-1 text-right font-mono">{l.available ?? '—'}</td>
                  <td className="py-1 text-right font-mono">{pc(l.utilization)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </RSection>
      )}

      {/* ------------------------------ 11 frota necessária ------------------------------ */}
      {routes.length > 0 && (
        <RSection n={11} title="Frota necessária" note="Caminhões por tipo em cada movimentação, horas efetivas e custo estimado (custo horário do modelo × horas).">
          <div className="avoid mb-2 grid grid-cols-4 gap-2">
            <RKpi label="Caminhões" value={`${rep.totals.trucksRequired.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`} sub={`de ${rep.totals.trucksAvailable} disponíveis`} tone={rep.totals.trucksRequired > rep.totals.trucksAvailable ? 'bad' : 'ok'} />
            <RKpi label="Equip. de carga" value={`${rep.totals.loadersRequired}`} sub="necessários" />
            <RKpi label="Horas de caminhão" value={`${t0(rep.totals.truckHours)} h`} sub="efetivas no mês" />
            <RKpi label="Custo do transporte" value={`R$ ${t0(rep.totals.costMonth / 1000)} mil`} sub={`${n2(rep.totals.massWetT ? rep.totals.costMonth / rep.totals.massWetT : 0)} R$/t`} />
          </div>
          <table className="w-full text-[8.5pt]">
            <tbody>
              {rep.movements.map((m) => (
                <tr key={m.id} className="border-b border-black/5">
                  <td className="py-1">{m.name}</td>
                  <td className="py-1">{m.types.filter((x) => x.count > 0).map((x) => `${x.count.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}× ${x.name}`).join(' + ') || '—'}</td>
                  <td className="py-1 text-right font-mono">{t0(m.truckHours)} h</td>
                  <td className="py-1 text-right font-mono">R$ {t0(m.costMonth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ScenariosTable routes={routes} premises={p} />
        </RSection>
      )}

      {/* ------------------------------ 12 simulação ------------------------------ */}
      {run && (
        <RSection n={12} title="Resultado da simulação" note={`Última matriz simulada em ${new Date(run.at).toLocaleString('pt-BR')}. Produção média por dia com intervalo de 95% das repetições.${run.targetTpd ? ` Meta: ${t0(run.targetTpd)} t/dia.` : ''}`}>
          <table className="w-full text-[8.5pt]">
            <thead>
              <tr className="border-b border-black/15 text-left text-black/50">
                <th className="py-1 font-medium">Configuração</th>
                <th className="py-1 font-medium">Cenário</th>
                <th className="py-1 text-right font-medium">t/dia</th>
                <th className="py-1 text-right font-medium">Intervalo</th>
                <th className="py-1 text-right font-medium">Ciclo</th>
                <th className="py-1 text-right font-medium">Fila na carga</th>
                <th className="py-1 text-right font-medium">R$/t</th>
              </tr>
            </thead>
            <tbody>
              {run.rows.map((x, i) => (
                <tr key={i} className="border-b border-black/5">
                  <td className="py-1">{x.config}</td>
                  <td className="py-1">{x.scenario}</td>
                  <td className={`py-1 text-right font-mono font-bold ${run.targetTpd && x.tpd < run.targetTpd ? 'text-red-600' : ''}`}>{t0(x.tpd)}</td>
                  <td className="py-1 text-right font-mono">{t0(x.lo)}–{t0(x.hi)}</td>
                  <td className="py-1 text-right font-mono">{n1(x.cycleMin)} min</td>
                  <td className="py-1 text-right font-mono">{n1(x.queueLoadMin)} min</td>
                  <td className="py-1 text-right font-mono">{n2(x.costPerT)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {run.circuits.length > 0 && (
            <p className="mt-2 text-[8.5pt] text-black/60">Por circuito (configuração e cenário de referência): {run.circuits.map((c) => `${c.name}: ${t0(c.tpd)} t/dia, ciclo ${n1(c.cycleMin)} min`).join(' · ')}.</p>
          )}
        </RSection>
      )}

      {/* ------------------------------ 13 mapa ------------------------------ */}
      {map && (
        <section className="page-break mt-5">
          <h2 className="flex items-center gap-2 border-b-2 border-emerald-600 pb-1 text-[12pt] font-bold">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 font-mono text-[9pt] text-white">13</span>
            Mapa da simulação
          </h2>
          <p className="mt-1 mb-2.5 text-[8.5pt] text-black/55">Áreas de origem (azul) e destino (verde) e trajetos dos DXF das movimentações{(p.simulation?.geoPeriod ?? 1) > 1 ? ` — período ${p.simulation?.geoPeriod}` : ''}; losangos = paradas no trajeto.</p>
          <div className="fig overflow-hidden rounded-lg border border-black/10" dangerouslySetInnerHTML={{ __html: map }} />
        </section>
      )}

      <p className="mt-6 border-t border-black/10 pt-2 text-[7.5pt] text-black/45">
        Relatório gerado pelo T2MinePlanner. Os valores são calculados a partir das Premissas Fundamentais e do Dimensionamento de Frota do plano no momento da emissão.
      </p>
    </div>,
    document.body,
  );
};

const ScenariosTable: React.FC<{ routes: Route[]; premises: DetailedPremises }> = ({ routes, premises }) => {
  const s = useMemo(() => fleetScenarios(routes, premises), [routes, premises]);
  const rows = [...s.trucks.map((r) => ({ k: 'Caminhão', r })), ...s.loaders.map((r) => ({ k: 'Carga', r }))];
  if (!rows.length) return null;
  const shared = s.shared.filter((u) => u.parts.length > 1);
  return (
    <div className="avoid mt-3">
      <p className="mb-1 text-[9pt] font-semibold">Cenários: exata, inteira por fluxo e otimizada</p>
      <table className="w-full text-[8.5pt]">
        <thead>
          <tr className="border-b border-black/15 text-left text-black/50">
            <th className="py-1 font-medium">Equipamento</th>
            <th className="py-1 font-medium">Modelo</th>
            <th className="py-1 text-right font-medium">Exata</th>
            <th className="py-1 text-right font-medium">Inteiro por fluxo</th>
            <th className="py-1 text-right font-medium">Otimizada</th>
            <th className="py-1 text-right font-medium">Disponível</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ k, r }) => (
            <tr key={k + r.model} className="border-b border-black/5">
              <td className="py-1">{k}</td>
              <td className="py-1">{r.model}</td>
              <td className="py-1 text-right font-mono">{n2(r.exact)}</td>
              <td className="py-1 text-right font-mono">{r.perFlow}</td>
              <td className="py-1 text-right font-mono font-bold">{r.optimized}</td>
              <td className="py-1 text-right font-mono">{r.available ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shared.length > 0 && (
        <p className="mt-1 text-[8.5pt] text-black/60">
          Compartilhados: {shared.map((u) => `1 ${u.kind === 'caminhao' ? 'caminhão' : 'equipamento'} ${u.model} (${Math.round(u.load * 100)}%): ${u.parts.map((x) => `${x.name} (${n2(x.frac)})`).join(' + ')}`).join('; ')}.
        </p>
      )}
    </div>
  );
};

const RSection: React.FC<{ n?: number; title: string; note?: string; children: React.ReactNode }> = ({ n, title, note, children }) => (
  <section className="avoid mt-5">
    <h2 className="flex items-center gap-2 border-b-2 border-emerald-600 pb-1 text-[12pt] font-bold">
      {n !== undefined && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 font-mono text-[9pt] text-white">{n}</span>}
      {title}
    </h2>
    {note && <p className="mt-1 mb-2.5 text-[8.5pt] text-black/55">{note}</p>}
    {!note && <div className="mb-2.5" />}
    {children}
  </section>
);

const RKpi: React.FC<{ label: string; value: string; sub?: string; tone?: 'ok' | 'bad' }> = ({ label, value, sub, tone }) => (
  <div className="rounded-lg border border-black/10 px-3 py-2">
    <p className="text-[7pt] font-bold tracking-widest text-black/45 uppercase">{label}</p>
    <p className={`font-mono text-[13pt] font-bold ${tone === 'ok' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-600' : ''}`}>{value}</p>
    {sub && <p className="text-[7.5pt] text-black/50">{sub}</p>}
  </div>
);

/** Planejado × realizado por semana, em SVG (imprime nítido, sem depender do canvas). */
const Tracking: React.FC<{ results: any; target: number }> = ({ results, target }) => {
  const days: any[] = results?.dailyBreakdown ?? [];
  const weeks = useMemo(() => {
    const out: { label: string; plan: number; real: number; logged: number }[] = [];
    days.forEach((d, i) => {
      const w = Math.floor(i / 7);
      if (!out[w]) out[w] = { label: `Sem. ${w + 1}`, plan: 0, real: 0, logged: 0 };
      out[w].plan += d.plannedMina || 0;
      if (d.actualMina !== null) {
        out[w].real += d.actualMina;
        out[w].logged++;
      }
    });
    return out;
  }, [days]);
  const logged = days.filter((d) => d.actualMina !== null);
  const planToDate = logged.reduce((s, d) => s + (d.plannedMina || 0), 0);
  const real = results?.totalActualProduction ?? 0;
  const W = 440;
  const H = 150;
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.plan, w.real))) * 1.1;
  const bw = (W - 40) / Math.max(1, weeks.length);
  const rows: [string, string, string?][] = [
    ['Realizado acumulado', `${t0(real)} t`],
    ['Planejado nos dias lançados', `${t0(planToDate)} t`],
    ['Aderência', planToDate ? pc(real / planToDate) : '—', planToDate && real < planToDate ? 'text-red-600' : 'text-emerald-700'],
    ['Dias lançados', `${logged.length} de ${days.length}`],
    ['Saldo da meta', `${t0(Math.max(0, target - real))} t`],
    ['Nova meta diária', `${t0(results?.requiredDailyProduction)} t/dia`],
  ];
  return (
    <div className="grid grid-cols-[1fr_1.6fr] gap-5">
      <table className="w-full self-start text-[9pt]">
        <tbody>
          {rows.map(([k, v, c]) => (
            <tr key={k} className="border-b border-black/5">
              <td className="py-1 text-black/55">{k}</td>
              <td className={`py-1 text-right font-mono font-semibold ${c ?? ''}`}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full">
          {[0, 0.5, 1].map((t) => (
            <g key={t}>
              <line x1={36} x2={W} y1={H - t * (H - 10)} y2={H - t * (H - 10)} stroke="#e5e7eb" />
              <text x={32} y={H - t * (H - 10) + 3} textAnchor="end" fontSize={8} fill="#6b7280">{t0((max * t) / 1000)} mil</text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const x = 40 + i * bw;
            const hp = (w.plan / max) * (H - 10);
            const hr = (w.real / max) * (H - 10);
            return (
              <g key={i}>
                <rect x={x + bw * 0.12} y={H - hp} width={bw * 0.36} height={hp} rx={2} fill="#cbd5e1" />
                {w.logged > 0 && <rect x={x + bw * 0.52} y={H - hr} width={bw * 0.36} height={hr} rx={2} fill="#059669" />}
                <text x={x + bw / 2} y={H + 12} textAnchor="middle" fontSize={8} fill="#6b7280">{w.label}</text>
              </g>
            );
          })}
        </svg>
        <p className="mt-1 flex gap-4 text-[8pt] text-black/60">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-[#cbd5e1]" /> Planejado</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm bg-emerald-600" /> Realizado</span>
          {!logged.length && <span className="text-black/45">Ainda não há lançamentos no mês.</span>}
        </p>
      </div>
    </div>
  );
};
