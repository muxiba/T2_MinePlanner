import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/** Script principal da página carregada (assets/index-xxxx.js). */
function currentBundle(): string | null {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return el ? new URL(el.src).pathname : null;
}

/**
 * Avisa quando uma versão nova do site foi publicada enquanto a aba estava aberta,
 * para ninguém testar uma tela antiga sem saber.
 */
export const NewVersionBanner: React.FC = () => {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = currentBundle();
    if (!mine) return; // ambiente de desenvolvimento
    let alive = true;
    const check = async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        const m = html.match(/\/assets\/index-[^"']+\.js/);
        if (alive && m && m[0] !== mine) setStale(true);
      } catch {
        /* sem rede: tenta depois */
      }
    };
    const id = window.setInterval(check, 2 * 60 * 1000);
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);
    void check();
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="flex items-center justify-center gap-3 bg-emerald-600 px-4 py-2 text-sm text-white" role="status">
      Há uma versão nova do T2MinePlanner publicada.
      <button onClick={() => window.location.reload()} className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1 font-semibold hover:bg-white/25">
        <RefreshCw size={14} /> Recarregar agora
      </button>
    </div>
  );
};
