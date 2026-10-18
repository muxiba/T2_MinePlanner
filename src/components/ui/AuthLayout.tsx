import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';

/**
 * Curvas de nível geradas proceduralmente: o "terreno" é um morro com ruído
 * suave, desenhado como isolinhas — a linguagem visual de quem trabalha com cava e topografia.
 */
function useContours(count = 16) {
  return useMemo(() => {
    const paths: string[] = [];
    const cx = 330;
    const cy = 380;
    for (let k = 0; k < count; k++) {
      const r = 40 + k * 26;
      const pts: string[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const wobble =
          1 + 0.09 * Math.sin(3 * a + k * 0.35) + 0.05 * Math.cos(5 * a - k * 0.2) + 0.03 * Math.sin(9 * a + k);
        const x = cx + Math.cos(a) * r * 1.25 * wobble;
        const y = cy + Math.sin(a) * r * 0.9 * wobble;
        pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
      }
      paths.push(pts.join(' ') + 'Z');
    }
    return paths;
  }, [count]);
}

export const AuthLayout: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => {
  const contours = useContours();
  return (
    <div className="grid min-h-screen bg-[#F7F7F5] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-[#151619] text-white lg:block" aria-hidden>
        <svg viewBox="0 0 660 760" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
          {contours.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={i % 5 === 0 ? '#34d399' : '#ffffff'}
              strokeOpacity={i % 5 === 0 ? 0.55 : 0.09}
              strokeWidth={i % 5 === 0 ? 1.4 : 1}
            />
          ))}
        </svg>
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500">
              <TrendingUp size={22} />
            </div>
            <span className="text-lg font-bold tracking-tight">T2MinePlanner</span>
          </div>
          <p className="max-w-sm font-serif text-[2.1rem] leading-[1.15] italic text-white/90">
            Da meta mensal de ROM à frota de cada rota, num só plano.
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
              <TrendingUp size={20} />
            </div>
            <span className="font-bold tracking-tight">T2MinePlanner</span>
          </div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-[#1A1A1A]">{title}</h1>
          {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-black/55">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
};
