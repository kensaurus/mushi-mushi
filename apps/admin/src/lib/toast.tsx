/**
 * FILE: apps/admin/src/lib/toast.tsx
 * PURPOSE: Tiny toast system. Every mutation site uses this to surface
 *          success/error feedback. Replaces silent apiFetch failures across
 *          Projects, SSO, Storage, DLQ, Fine-Tuning, etc.
 *
 *
 *           - Pause auto-dismiss on hover/focus (so the user can read it)
 *           - Optional `action` slot for "Undo" / "View report" CTAs
 *           - Stack cap (3) — oldest auto-dismisses if a 4th arrives
 *           - `focus-visible` ring + larger hit-target on dismiss
 *           - Dismiss = real button (not a glyph) for screen readers
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

interface ToastAction {
  /** Visible button label (e.g. "Undo", "View report"). */
  label: string
  onClick: () => void
}

interface ToastItem {
  id: string
  tone: ToastTone
  title: string
  description?: string
  duration: number
  action?: ToastAction
  /** When true, the toast is animating out and will be unmounted shortly. */
  closing?: boolean
  /** When true, the auto-dismiss countdown is paused (hover/focus). The
   *  drain animation pauses with it so the user sees how long they have. */
  paused?: boolean
}

const EXIT_ANIMATION_MS = 140
const STACK_LIMIT = 3

// `message` is accepted as an alias for `title` because most call sites in
// the admin console reach for the more colloquial property name. We map it
// down to `title` inside `push`.
type ToastInput = {
  tone: ToastInputTone
  title?: string
  message?: string
  description?: string
  duration?: number
  action?: ToastAction
}

interface ToastContextValue {
  push: (toast: ToastInput) => void
  success: (title: string, description?: string, action?: ToastAction) => void
  error: (title: string, description?: string, action?: ToastAction) => void
  info: (title: string, description?: string, action?: ToastAction) => void
  warn: (title: string, description?: string, action?: ToastAction) => void
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
  // We keep two parallel maps:
  //  - `dismissTimers`  → the auto-dismiss countdown (cancelled/restarted on hover)
  //  - `exitTimers`     → the unmount-after-animation timer (never paused)
  // and one `remaining` map that tracks how much of the auto-dismiss budget
  // is left, so a 2-second hover doesn't reset the toast back to its full
  // duration when the user moves the mouse away.
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const remaining = useRef<Map<string, { startedAt: number; ms: number }>>(new Map())

  const dismiss = useCallback((id: string) => {
    const dt = dismissTimers.current.get(id)
    if (dt) {
      clearTimeout(dt)
      dismissTimers.current.delete(id)
    }
    remaining.current.delete(id)
    if (exitTimers.current.has(id)) return
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, closing: true } : t)))
    const exitTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      exitTimers.current.delete(id)
    }, EXIT_ANIMATION_MS)
    exitTimers.current.set(id, exitTimer)
  }, [])

  const scheduleDismiss = useCallback((id: string, ms: number) => {
    const existing = dismissTimers.current.get(id)
    if (existing) clearTimeout(existing)
    remaining.current.set(id, { startedAt: Date.now(), ms })
    const timer = setTimeout(() => dismiss(id), ms)
    dismissTimers.current.set(id, timer)
  }, [dismiss])

  const pauseDismiss = useCallback((id: string) => {
    const t = dismissTimers.current.get(id)
    if (!t) return
    clearTimeout(t)
    dismissTimers.current.delete(id)
    const tracker = remaining.current.get(id)
    if (!tracker) return
    const elapsed = Date.now() - tracker.startedAt
    const left = Math.max(800, tracker.ms - elapsed)
    remaining.current.set(id, { startedAt: 0, ms: left })
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: true } : t)))
  }, [])

  const resumeDismiss = useCallback((id: string) => {
    const tracker = remaining.current.get(id)
    if (!tracker) return
    if (dismissTimers.current.has(id)) return
    scheduleDismiss(id, tracker.ms)
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, paused: false } : t)))
  }, [scheduleDismiss])

  const push = useCallback<ToastContextValue['push']>(
    ({ tone, title, message, description, duration, action }) => {
      const id = `t${Date.now()}-${counter++}`
      const normalisedTone: ToastTone = tone === 'warning' ? 'warn' : tone
      const dur = duration ?? (normalisedTone === 'error' ? 6000 : 3500)
      const finalTitle = title ?? message ?? ''
      if (!finalTitle) return
      setToasts((prev) => {
        const next = [
          ...prev,
          { id, tone: normalisedTone, title: finalTitle, description, duration: dur, action },
        ]
        // Cap the stack: when over the limit, dismiss the oldest non-closing
        // toast immediately so the new one has room. We don't dismiss closing
        // ones (already animating out) to avoid double-fire.
        if (next.length > STACK_LIMIT) {
          const overflow = next.find((t) => !t.closing)
          if (overflow) {
            queueMicrotask(() => dismiss(overflow.id))
          }
        }
        return next
      })
      scheduleDismiss(id, dur)
    },
    [scheduleDismiss, dismiss],
  )

  useEffect(() => {
    const dt = dismissTimers.current
    const et = exitTimers.current
    return () => {
      for (const t of dt.values()) clearTimeout(t)
      for (const t of et.values()) clearTimeout(t)
      dt.clear()
      et.clear()
      remaining.current.clear()
    }
  }, [])

  // Memoise the context value so consumers using `toast` in `useCallback` or
  // `useEffect` deps don't re-fire on every toast push/dismiss render. Without
  // this, e.g. QueryPage re-fetched /v1/admin/query/history every time any
  // toast appeared or auto-dismissed.
  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description, action) => push({ tone: 'success', title, description, action }),
      error: (title, description, action) => push({ tone: 'error', title, description, action }),
      info: (title, description, action) => push({ tone: 'info', title, description, action }),
      warn: (title, description, action) => push({ tone: 'warn', title, description, action }),
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
            role={t.tone === 'error' ? 'alert' : 'status'}
            aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
            onMouseEnter={() => pauseDismiss(t.id)}
            onMouseLeave={() => resumeDismiss(t.id)}
            onFocusCapture={() => pauseDismiss(t.id)}
            onBlurCapture={() => resumeDismiss(t.id)}
            className={`relative overflow-hidden pointer-events-auto rounded-md border ${TONE_CLS[t.tone]} bg-surface-raised shadow-raised p-3 flex items-start gap-2 ${t.closing ? 'motion-safe:animate-mushi-toast-out' : 'motion-safe:animate-mushi-toast-in'}`}
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
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick()
                    dismiss(t.id)
                  }}
                  className="mt-1.5 inline-flex items-center gap-1 text-2xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface rounded-sm motion-safe:transition-colors"
                >
                  {t.action.label}
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-sm text-fg-faint hover:text-fg hover:bg-surface-overlay text-xs leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-surface motion-safe:transition-colors"
              aria-label="Dismiss notification"
            >
              <span aria-hidden="true">✕</span>
            </button>
            {!t.closing && (
              <span
                aria-hidden="true"
                className={`absolute bottom-0 left-0 h-0.5 w-full bg-current opacity-30 origin-left motion-safe:animate-mushi-toast-progress ${t.paused ? '[animation-play-state:paused]' : ''}`}
                style={{ animationDuration: `${t.duration}ms` }}
              />
            )}
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
