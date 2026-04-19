/**
 * FILE: apps/admin/src/lib/toast.tsx
 * PURPOSE: Tiny toast system. Every mutation site uses this to surface
 *          success/error feedback. Replaces silent apiFetch failures across
 *          Projects, SSO, Storage, DLQ, Fine-Tuning, etc.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type ToastTone = 'success' | 'error' | 'info' | 'warn'
// `warning` is accepted as an alias for `warn` so existing call sites that
// say `tone: 'warning'` keep working alongside the canonical names.
type ToastInputTone = ToastTone | 'warning'

interface ToastItem {
  id: string
  tone: ToastTone
  title: string
  description?: string
  duration: number
}

// `message` is accepted as an alias for `title` because most call sites in
// the admin console reach for the more colloquial property name. We map it
// down to `title` inside `push`.
type ToastInput = {
  tone: ToastInputTone
  title?: string
  message?: string
  description?: string
  duration?: number
}

interface ToastContextValue {
  push: (toast: ToastInput) => void
  success: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
  warn: (title: string, description?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE_CLS: Record<ToastTone, string> = {
  success: 'border-ok/30 bg-ok-muted/20 text-ok',
  error: 'border-danger/30 bg-danger-muted/20 text-danger',
  info: 'border-info/30 bg-info-muted/20 text-info',
  warn: 'border-warn/30 bg-warn-muted/20 text-warn',
}

const TONE_ICON: Record<ToastTone, string> = {
  success: '✓',
  error: '✕',
  info: 'i',
  warn: '!',
}

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback<ToastContextValue['push']>(
    ({ tone, title, message, description, duration }) => {
      const id = `t${Date.now()}-${counter++}`
      const normalisedTone: ToastTone = tone === 'warning' ? 'warn' : tone
      const dur = duration ?? (normalisedTone === 'error' ? 6000 : 3500)
      const finalTitle = title ?? message ?? ''
      if (!finalTitle) return
      setToasts((prev) => [
        ...prev,
        { id, tone: normalisedTone, title: finalTitle, description, duration: dur },
      ])
      const timer = setTimeout(() => dismiss(id), dur)
      timers.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  // Memoise the context value so consumers using `toast` in `useCallback` or
  // `useEffect` deps don't re-fire on every toast push/dismiss render. Without
  // this, e.g. QueryPage re-fetched /v1/admin/query/history every time any
  // toast appeared or auto-dismissed.
  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ tone: 'success', title, description }),
      error: (title, description) => push({ tone: 'error', title, description }),
      info: (title, description) => push({ tone: 'info', title, description }),
      warn: (title, description) => push({ tone: 'warn', title, description }),
    }),
    [push],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(22rem,calc(100vw-2rem))]"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto rounded-md border ${TONE_CLS[t.tone]} bg-surface-raised shadow-raised p-3 flex items-start gap-2`}
          >
            <span
              className={`shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${TONE_CLS[t.tone]}`}
              aria-hidden="true"
            >
              {TONE_ICON[t.tone]}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-fg leading-tight">{t.title}</div>
              {t.description && (
                <div className="text-2xs text-fg-muted mt-0.5 break-words">
                  {t.description}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-fg-faint hover:text-fg text-xs leading-none px-1"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Stub fallback so components can call useToast() before the provider is
    // wired in tests or storybook contexts. Logs to console so failures aren't
    // truly silent.
    return {
      push: (t) =>
        console.warn(
          '[toast:nostore]',
          t.tone,
          t.title ?? t.message,
          t.description,
        ),
      success: (t, d) => console.log('[toast:success]', t, d),
      error: (t, d) => console.error('[toast:error]', t, d),
      info: (t, d) => console.info('[toast:info]', t, d),
      warn: (t, d) => console.warn('[toast:warn]', t, d),
    }
  }
  return ctx
}
