import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60 ${className}`}
    >
      <header className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60 ${props.className || ''}`}
    />
  );
}

export function Button({
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary:
      'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500/30 disabled:bg-indigo-300',
    secondary:
      'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus:ring-slate-400/20',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500/30',
    ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${props.className || ''}`}
    />
  );
}

export function Alert({ type, children }: { type: 'success' | 'error' | 'info'; children: ReactNode }) {
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-slate-200 bg-slate-50 text-slate-700',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${styles[type]}`} role="status">
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'oauth' | 'password' | 'passkey';
}) {
  const tones = {
    default: 'bg-slate-100 text-slate-700',
    oauth: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
    password: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200',
    passkey: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}
