import { useRef, useState } from 'react';
import lessons from '@/tutorialManifest.json';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function TutorialView() {
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const lesson = lessons[selected];
  function seek(seconds: number) {
    if (!player.current) return;
    player.current.currentTime = seconds;
    player.current.focus();
  }
  return (
    <section aria-labelledby="tutorial-title" className="space-y-6">
      <div>
        <h2 id="tutorial-title" className="text-2xl font-semibold">Tutorial do T2 MinePlanner</h2>
        <p className="mt-2 text-sm text-black/60">Aprenda a preencher, configurar e usar as telas do software. Nove aulas com narração em português e legendas.</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label="Aulas do tutorial" className="flex flex-col gap-2">
          {lessons.map((item, index) => (
            <button key={item.id} type="button" aria-pressed={selected === index} onClick={() => { setSelected(index); setFailed(false); }}
              className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-emerald-600 ${selected === index ? 'border-emerald-600 bg-emerald-50 text-emerald-950' : 'border-black/10 bg-white hover:bg-black/5'}`}>
              <span className="block text-sm font-semibold">{item.id}. {item.title}</span>
              <span className="mt-1 block text-xs text-black/50">{clock(item.duration)}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <h3 className="text-lg font-semibold">{lesson.id}. {lesson.title}</h3>
          <video key={lesson.id} ref={player} controls playsInline preload="metadata" aria-label={`Aula ${lesson.id}: ${lesson.title}`}
            poster={`/tutorial/${lesson.id}-capa.jpg`} src={`/tutorial/${lesson.file}`} onError={() => setFailed(true)} className="aspect-video w-full rounded-xl bg-black" />
          {failed && <p role="alert" className="text-sm text-red-700">Não foi possível abrir o vídeo. Tente recarregar a página ou use o link para baixar a aula.</p>}
          <div className="flex flex-wrap gap-4 text-sm">
            <a href={`/tutorial/${lesson.file}`} download className="font-medium text-emerald-800 underline">Baixar esta aula</a>
            <a href={`/tutorial/${lesson.id}-tutorial.srt`} download className="font-medium text-emerald-800 underline">Baixar legendas</a>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold">{lesson.id === '09' ? 'Os sete capítulos de Simulação' : 'Ir para um passo da aula'}</h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {lesson.chapters.map((chapter) => <button type="button" key={chapter.start} onClick={() => seek(chapter.start)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-left text-sm hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-600"><span className="mr-2 font-mono text-emerald-800">{clock(chapter.start)}</span>{chapter.title}</button>)}
            </div>
          </div>
          <p className="text-xs text-black/50">Use os controles do vídeo para pausar, ajustar a velocidade e assistir em tela cheia. As telas mostram um plano de exemplo; utilize os dados da sua operação.</p>
        </div>
      </div>
    </section>
  );
}
