import React from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

/* Componentes de interface compartilhados pelas telas novas (login, empresa, dono). */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }
> = ({ variant = 'primary', loading, disabled, className, children, ...rest }) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={clsx(
      'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
      'disabled:cursor-not-allowed disabled:opacity-60',
      variant === 'primary' && 'bg-emerald-600 text-white hover:bg-emerald-700',
      variant === 'secondary' && 'border border-black/10 bg-white text-[#1A1A1A] hover:bg-black/[0.03]',
      variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
      variant === 'ghost' && 'text-black/60 hover:bg-black/5 hover:text-black',
      className,
    )}
  >
    {loading && <Loader2 size={16} className="animate-spin" aria-hidden />}
    {children}
  </button>
);

export const Field: React.FC<
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }
> = ({ label, hint, error, id, className, ...rest }) => {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={inputId} className="block text-sm font-medium text-black/75">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={hint || error ? `${inputId}-desc` : undefined}
        className={clsx(
          'w-full rounded-xl border bg-white px-4 py-2.5 text-[15px] text-[#1A1A1A] transition-colors',
          'placeholder:text-black/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/30',
          error ? 'border-red-400 focus:border-red-500' : 'border-black/12 focus:border-emerald-500',
        )}
        {...rest}
      />
      {(hint || error) && (
        <p id={`${inputId}-desc`} className={clsx('text-xs', error ? 'text-red-600' : 'text-black/45')}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
};

export const Select: React.FC<
  React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }
> = ({ label, id, className, children, ...rest }) => {
  const autoId = React.useId();
  const selectId = id ?? autoId;
  return (
    <div className={clsx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-black/75">
          {label}
        </label>
      )}
      <select
        id={selectId}
        className="w-full rounded-xl border border-black/12 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        {...rest}
      >
        {children}
      </select>
    </div>
  );
};

export const Alert: React.FC<{ tone?: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode }> = ({
  tone = 'info',
  children,
}) => (
  <div
    role={tone === 'error' ? 'alert' : 'status'}
    className={clsx(
      'rounded-xl border px-4 py-3 text-sm',
      tone === 'error' && 'border-red-200 bg-red-50 text-red-800',
      tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
      tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-900',
      tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
    )}
  >
    {children}
  </div>
);

export const Card: React.FC<{ title?: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  description,
  actions,
  children,
}) => (
  <section className="rounded-2xl border border-black/[0.07] bg-white p-6">
    {(title || actions) && (
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          {title && <h3 className="text-lg font-semibold text-[#1A1A1A]">{title}</h3>}
          {description && <p className="mt-1 text-sm text-black/50">{description}</p>}
        </div>
        {actions}
      </header>
    )}
    {children}
  </section>
);

export const FullScreenLoader: React.FC<{ label?: string }> = ({ label = 'Carregando…' }) => (
  <div className="flex h-screen items-center justify-center bg-[#F8F9FA]" role="status" aria-live="polite">
    <div className="flex items-center gap-3 text-sm text-black/50">
      <Loader2 className="animate-spin text-emerald-600" size={20} aria-hidden />
      {label}
    </div>
  </div>
);
