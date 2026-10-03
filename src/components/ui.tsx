import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { ApiError } from '../api/client'

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-400" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
      {label}
    </span>
  )
}

export function ErrorNotice({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-sm text-rose-200" role="alert">
      <p>{error.message}</p>
      {error.status === 429 && error.retryAfter !== null && (
        <p className="mt-1 text-rose-300/80">Nouvelle tentative possible dans environ {error.retryAfter} s.</p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-rose-400/50 px-2 py-1 text-xs hover:bg-rose-900/50"
        >
          Réessayer
        </button>
      )}
    </div>
  )
}

export function Button({
  active = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md border px-2.5 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-sky-400 bg-sky-500/20 text-sky-100'
          : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500 hover:bg-slate-700'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export function Panel({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/70 p-4 ${className}`}>
      {title && <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">{title}</h2>}
      {children}
    </section>
  )
}

export const inputClass =
  'rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-400'
