'use client'

import { useEffect, useState } from 'react'

/**
 * Live gateway-health pill rendered in the marketing footer.
 *
 * Why this exists
 * ---------------
 * The footer used to render a hardcoded `<span class="animate-pulse">` that
 * always said "Sentry · Langfuse · GitHub healthy" — even when the gateway
 * was down. That's the worst kind of dead UI: it actively lies. We swap it
 * for a real probe of the public `/health` endpoint exposed by
 * `packages/server/supabase/functions/api/index.ts`.
 *
 * Behaviour
 * ---------
 *   - First render: shows a neutral "checking…" state (no false green).
 *   - On 2xx + `{ status: 'ok' }` → emerald pulse, "Gateway healthy".
 *   - On non-2xx, network error, or AbortError → muted red, "Gateway unreachable".
 *   - Re-checks every 60s while mounted.
 *
 * The pill is intentionally minimal — it's a trust signal, not a status page.
 * `apps/admin` has the rich per-project Sentry/Langfuse/GitHub diagnostics.
 */

type Status = 'checking' | 'healthy' | 'down'

const HEALTH_PATH = '/health'
const POLL_MS = 60_000
const TIMEOUT_MS = 6_000

const apiBase = (): string =>
  (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '')

export function StatusPill() {
  const [status, setStatus] = useState<Status>('checking')
  const [region, setRegion] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      // No API base configured → don't pretend. Render the muted unknown state.
      const base = apiBase()
      if (!base) {
        if (!cancelled) setStatus('down')
        return
      }

      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
      try {
        const res = await fetch(`${base}${HEALTH_PATH}`, {
          signal: ctrl.signal,
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { status?: string; region?: string }
        if (cancelled) return
        if (json.status === 'ok') {
          setStatus('healthy')
          if (json.region) setRegion(json.region)
        } else {
          setStatus('down')
        }
      } catch {
        if (!cancelled) setStatus('down')
      } finally {
        clearTimeout(timer)
      }
    }

    void check()
    const id = window.setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const label =
    status === 'healthy'
      ? region
        ? `Gateway healthy · ${region}`
        : 'Gateway healthy'
      : status === 'down'
        ? 'Gateway unreachable'
        : 'Checking gateway…'

  const dotClass =
    status === 'healthy'
      ? 'h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500'
      : status === 'down'
        ? 'h-1.5 w-1.5 rounded-full bg-red-500/80'
        : 'h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mushi-ink-faint)]'

  return (
    <p
      className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--mushi-ink-muted)]"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className={dotClass} />
      {label}
    </p>
  )
}
