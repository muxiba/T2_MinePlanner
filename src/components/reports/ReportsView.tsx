import React, { useMemo, useState } from 'react';
import clsx from 'clsx';
import { CheckCircle2, Circle, FileSpreadsheet, FileText, Play, Presentation, Sparkles } from 'lucide-react';
import type { DetailedPremises, Route } from '@/types';
import { buildReportData, defaultConfigIds, effectiveModel, type ReportOptions } from '@/reports/data';
import type { ReportKind } from '@/reports';
import { brl, dateBR, fmt, pct } from '@/reports/theme';
import { Btn, Card, Progress, inputCls } from '@/components/simulation/ui';

/**
 * Aba Relatórios: gera o relatório em Word, a apresentação e a planilha em Excel no mesmo padrão
 * (memórias de cálculo, dados do software e "como ler"), a partir do plano salvo.
 */

interface Props {
  routes: Route[];
  premises: DetailedPremises;
  setPremises: (p: DetailedPremises) => void;
  canEdit: boolean;
  companyName?: string;
}

const KINDS: { id: ReportKind; label: string; help: string; icon: React.ElementType }[] = [
  { id: 'docx', label: 'Relatório em Word', help: 'Memorial completo: passo a passo, fórmulas, memórias de cálculo, gráficos e a escolha.', icon: FileText },
  { id: 'pptx', label: 'Apresentação', help: 'Um passo por slide, com gráficos, caixas de memória e a recomendação no fim.', icon: Presentation },
  { id: 'xlsx', label: 'Planilha em Excel', help: 'Premissas em azul, memórias com fórmulas vivas, dados exportados da simulação e gráficos.', icon: FileSpreadsheet },
];

const Status: React.FC<{ ok: boolean; title: string; detail: string; optional?: boolean }> = ({ ok, title, detail, optional }) => (
  <li className="flex items-start gap-2.5 py-1.5">
    {ok ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" /> : <Circle size={17} className={clsx('mt-0.5 shrink-0', optional ? 'text-black/25' : 'text-amber-500')} />}
    <div>
      <p className="text-sm font-medium">
        {title}
        {optional && !ok && <span className="ml-1.5 text-xs font-normal text-black/40">opcional</span>}
      </p>
      <p className="text-xs text-black/50">{detail}</p>
    </div>
  </li>
);

const ReportsView: React.FC<Props> = ({ routes, premises, setPremises, canEdit, companyName }) => {
  const model = useMemo(() => effectiveModel(premises, routes), [premises, routes]);
  const saved = premises.reportOptions ?? {};
  const [local, setLocal] = useState<Partial<ReportOptions>>({});
  const opts: ReportOptions = {
    title: 'Dimensionamento da frota',
    client: '',
    company: companyName ?? '',
    ...saved,
    ...local,
  };
  const setOpt = (patch: Partial<ReportOptions>) => {
    setLocal((l) => ({ ...l, ...patch }));
    if (canEdit) setPremises({ ...premises, reportOptions: { ...saved, ...local, ...patch } });
  };
  const allConfigs = model?.configs ?? [];
  const selected = opts.configIds?.length ? opts.configIds : defaultConfigIds(model);
  const toggleConfig = (id: string) => setOpt({ configIds: selected.includes(id) ? selected.filter((x) => x !== id) : allConfigs.map((c) => c.id).filter((x) => x === id || selected.includes(x)) });

  const data = useMemo(() => {
    try {
      return buildReportData(routes, premises, { ...opts, configIds: selected });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, premises, JSON.stringify(opts), selected.join(',')]);

  const [busy, setBusy] = useState<{ kind: ReportKind | 'all' | 'run'; stage: string; f?: number } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const run = model?.reportRun;
  const ready = routes.some((r) => r.active);

  const generate = async (kinds: ReportKind[]) => {
    setMsg(null);
    const files: string[] = [];
    try {
      const { generateReport } = await import('@/reports');
      for (const k of kinds) {
        setBusy({ kind: kinds.length > 1 ? 'all' : k, stage: KINDS.find((x) => x.id === k)!.label });
        files.push(await generateReport(k, routes, premises, { ...opts, configIds: selected }, (s) => setBusy({ kind: kinds.length > 1 ? 'all' : k, stage: s })));
      }
      setMsg({ tone: 'ok', text: `Pronto: ${files.join(', ')}` });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const runSims = async () => {
    setMsg(null);
    setBusy({ kind: 'run', stage: 'Preparando', f: 0 });
    try {
      const { runReportSimulations } = await import('@/reports');
      const res = await runReportSimulations(routes, premises, selected, (f, stage) => setBusy({ kind: 'run', stage, f }));
      const sim = premises.simulation ?? model!;
      setPremises({ ...premises, simulation: { ...sim, reportRun: res } });
      setMsg({ tone: 'ok', text: 'Simulações do relatório concluídas e guardadas no plano.' });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const rec = data?.recommended;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Relatórios</h2>
        <p className="mt-1 max-w-3xl text-sm text-black/55">
          Gera o relatório em Word, a apresentação e a planilha em Excel com as memórias de cálculo, os resultados da simulação e a escolha do equipamento. Tudo sai do plano salvo: Premissas, Dimensionamento e
          Simulação.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card title="Dados do relatório" description="Aparecem na capa, no cabeçalho e na conclusão.">
          <fieldset disabled={!canEdit} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="text-xs text-black/55 sm:col-span-2">
              Título
              <input className={clsx(inputCls, 'mt-1')} value={opts.title} onChange={(e) => setOpt({ title: e.target.value })} />
            </label>
            <label className="text-xs text-black/55 sm:col-span-2">
              Subtítulo
              <input className={clsx(inputCls, 'mt-1')} placeholder="Memorial de cálculo, resultados simulados e escolha do equipamento" value={opts.subtitle ?? ''} onChange={(e) => setOpt({ subtitle: e.target.value })} />
            </label>
            <label className="text-xs text-black/55">
              Cliente
              <input className={clsx(inputCls, 'mt-1')} value={opts.client} onChange={(e) => setOpt({ client: e.target.value })} />
            </label>
            <label className="text-xs text-black/55">
              Empresa
              <input className={clsx(inputCls, 'mt-1')} value={opts.company} onChange={(e) => setOpt({ company: e.target.value })} />
            </label>
            <label className="text-xs text-black/55">
              Responsável
              <input className={clsx(inputCls, 'mt-1')} value={opts.author ?? ''} onChange={(e) => setOpt({ author: e.target.value })} />
            </label>
            <label className="text-xs text-black/55">
              Recomendação
              <select className={clsx(inputCls, 'mt-1')} value={opts.recommendedId ?? ''} onChange={(e) => setOpt({ recommendedId: e.target.value || undefined })}>
                <option value="">Automática (menor custo que atende a meta)</option>
                {allConfigs
                  .filter((c) => selected.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            {allConfigs.length > 0 && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-xs text-black/55">Configurações comparadas</p>
                <div className="flex flex-wrap gap-2">
                  {allConfigs.map((c) => (
                    <label key={c.id} className={clsx('flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs', selected.includes(c.id) ? 'border-[#C8641E] bg-[#FBE9D9]' : 'border-black/10')}>
                      <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggleConfig(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="text-xs text-black/55 sm:col-span-2">
              Conclusão (vazio = gerada pelos resultados)
              <textarea className={clsx(inputCls, 'mt-1 h-20')} placeholder={data?.conclusion} value={opts.conclusion ?? ''} onChange={(e) => setOpt({ conclusion: e.target.value })} />
            </label>
            <label className="text-xs text-black/55 sm:col-span-2">
              Condições, restrições e próximos passos (uma por linha)
              <textarea className={clsx(inputCls, 'mt-1 h-24')} placeholder={'Ex.: confirmar 2 pontos de descarga\nverificar a ponte do km 16'} value={opts.notes ?? ''} onChange={(e) => setOpt({ notes: e.target.value })} />
            </label>
          </fieldset>
        </Card>

        <div className="space-y-6">
          <Card title="O que entra no relatório" description="Quanto mais etapas prontas, mais completo o relatório.">
            <ul className="divide-y divide-black/[0.05]">
              <Status ok={ready} title="Premissas e 2. Dimensionamento" detail={ready ? `${routes.filter((r) => r.active).length} movimentação(ões), meta de ${fmt(data?.target.monthT ?? 0)} t/mês` : 'Cadastre as movimentações no 2. Dimensionamento.'} />
              <Status ok={!!model && selected.length > 0} title="Configurações de caminhão" detail={model ? `${selected.length} de ${allConfigs.length} configuração(ões) no relatório` : 'Monte o modelo na aba Simulação para comparar caminhões.'} />
              <Status
                ok={!!run}
                title="Simulações do relatório"
                detail={run ? `Rodada em ${dateBR(run.at)}: matriz de ${run.matrix.length} combinações e frota mínima de ${run.minFleet.length} configuração(ões)` : 'Matriz de cenários e frota mínima de cada configuração.'}
              />
              <Status ok={!!model?.lastSweep} optional title="Curva da frota mínima" detail={model?.lastSweep ? `${model.lastSweep.config}, ${dateBR(model.lastSweep.at)}` : 'Simulação → Resultados → Buscar frota mínima.'} />
              <Status ok={!!model?.lastDecision} optional title="Decisão no horizonte do plano" detail={model?.lastDecision ? `${model.lastDecision.periods} período(s), ${dateBR(model.lastDecision.at)}` : 'Simulação → Resultados e decisão.'} />
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Btn tone="light" onClick={runSims} busy={busy?.kind === 'run'} disabled={!canEdit || !model || !selected.length || !!busy}>
                <Play size={15} /> {run ? 'Rodar de novo as simulações' : 'Rodar simulações do relatório'}
              </Btn>
              {busy?.kind === 'run' && <Progress value={busy.f ?? 0} label={busy.stage} />}
            </div>
            {!canEdit && <p className="mt-2 text-xs text-black/45">Só quem edita o plano pode rodar as simulações; os relatórios podem ser gerados por todos.</p>}
          </Card>

          {rec && data && (
            <Card title="Prévia da recomendação">
              <p className="text-sm">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs font-bold text-white" style={{ background: `#${rec.color}` }}>
                  {rec.tag}
                </span>{' '}
                <b>{rec.name}</b>
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-[#FBE9D9] p-2">
                  <p className="text-lg font-bold text-[#A8521A]">{fmt(rec.fleet)}</p>
                  <p className="text-[11px] text-black/55">caminhões ({rec.fleetSource})</p>
                </div>
                <div className="rounded-xl bg-[#FBE9D9] p-2">
                  <p className="text-lg font-bold text-[#A8521A]">{brl(rec.cost.perT)}</p>
                  <p className="text-[11px] text-black/55">por tonelada</p>
                </div>
                <div className="rounded-xl bg-[#FBE9D9] p-2">
                  <p className="text-lg font-bold text-[#A8521A]">{rec.dump ? pct(rec.dump.occupancy) : '—'}</p>
                  <p className="text-[11px] text-black/55">ocupação da descarga</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-black/55">{data.conclusion}</p>
            </Card>
          )}
        </div>
      </div>

      <Card title="Gerar" description="Os arquivos são montados no navegador e baixados na hora. Gráficos e fórmulas vão como imagem; a planilha mantém as fórmulas.">
        <div className="grid gap-3 md:grid-cols-3">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => generate([k.id])}
              disabled={!ready || !!busy}
              className="group flex flex-col items-start gap-2 rounded-2xl border border-black/[0.08] bg-white p-4 text-left transition-colors hover:border-[#C8641E] hover:bg-[#FBF6EE] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <k.icon size={22} className="text-[#C8641E]" />
              <span className="font-semibold">{k.label}</span>
              <span className="text-xs text-black/55">{k.help}</span>
              {busy && (busy.kind === k.id || busy.kind === 'all') && <span className="text-xs font-medium text-[#A8521A]">{busy.stage}…</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Btn onClick={() => generate(['docx', 'pptx', 'xlsx'])} busy={busy?.kind === 'all'} disabled={!ready || !!busy}>
            <Sparkles size={15} /> Gerar os três
          </Btn>
          {msg && <p className={clsx('text-sm', msg.tone === 'ok' ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</p>}
        </div>
      </Card>
    </div>
  );
};

export default ReportsView;
