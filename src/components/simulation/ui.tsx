import React from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* Formatação e campos                                                         */
/* -------------------------------------------------------------------------- */

export const t0 = (n: number) => Math.round(n).toLocaleString('pt-BR');
export const n1 = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const pc = (n: number) => `${Math.round(n * 100)}%`;
export const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

export const inputCls =
  'w-full rounded-lg border border-black/12 bg-white px-2 py-1.5 text-sm tabular-nums focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 focus:outline-none';

export const Num: React.FC<{ label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number; className?: string }> = ({
  label,
  value,
  onChange,
  suffix,
  step = 1,
  className,
}) => {
  const id = React.useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs text-black/55">
        {label}
        {suffix && <span className="text-black/35"> ({suffix})</span>}
      </label>
      <input id={id} type="number" step={step} className={inputCls} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
};

export const Card: React.FC<{ title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({ title, description, actions, children }) => (
  <section className="rounded-2xl border border-black/[0.07] bg-white p-5">
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-black/50">{description}</p>}
      </div>
      {actions}
    </header>
    {children}
  </section>
);

export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'light'; busy?: boolean }> = ({
  tone = 'dark',
  busy,
  className,
  children,
  disabled,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || busy}
    className={clsx(
      'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
      tone === 'dark' ? 'bg-[#151619] text-white hover:bg-black' : 'border border-black/10 bg-white hover:bg-black/[0.03]',
      className,
    )}
  >
    {busy && <Loader2 size={15} className="animate-spin" />}
    {children}
  </button>
);

export const Progress: React.FC<{ value: number; label?: string }> = ({ value, label }) => (
  <div className="flex items-center gap-3 text-xs text-black/55">
    <div className="h-1.5 w-40 overflow-hidden rounded-full bg-black/[0.07]">
      <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
    {label ?? `${Math.round(value * 100)}%`}
  </div>
);

