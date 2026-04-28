'use client'

import { useEffect, useState } from 'react'

/**
 * Live gateway-health pill.
 *
 * The pill polls `${apiBaseUrl}/health` every 60s and renders one of four
 * states: unknown (no URL configured), checking (probe in flight), healthy,
 * or down. When `apiBaseUrl` is undefined / empty we skip the probe entirely
 * and render the muted unknown state — used by the admin app's marketing
 * surface where there's no public API to probe. Rendering "Gateway
 * unreachable" in that case would be a false alarm to visitors.
 *
 * apps/cloud was previously responsible for reading `process.env.NEXT_PUBLIC_API_BASE_URL`
 * inside this component. To keep the package framework-agnostic the URL is
 * now passed in as a prop; the consuming app decides how to source it
 * (env var, runtime config, etc).
 */

type Status = 'unknown' | 'checking' | 'healthy' | 'down'

const HEALTH_PATH = '/health'
const POLL_MS = 60_000
const TIMEOUT_MS = 6_000

export interface StatusPillProps {
  apiBaseUrl?: string
}

export function StatusPill({ apiBaseUrl }: StatusPillProps) {
  const base = (apiBaseUrl ?? '').replace(/\/+$/, '')
  const [status, setStatus] = useState<Status>(base ? 'checking' : 'unknown')
  const [region, setRegion] = useState<string | null>(null)

  useEffect(() => {
    if (!base) {
      // No probe URL → stay in the muted unknown state, don't poll.
      setStatus('unknown')
      setRegion(null)
      return
    }

    let cancelled = false
    setStatus('checking')

    async function check() {
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
  }, [base])

  const label =
    status === 'healthy'
      ? region
        ? `Gateway healthy · ${region}`
        : 'Gateway healthy'
      : status === 'down'
        ? 'Gateway unreachable'
        : status === 'checking'
          ? 'Checking gateway…'
          : 'Gateway status unknown'

  const dotClass =
    status === 'healthy'
      ? 'h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500'
      : status === 'down'
        ? 'h-1.5 w-1.5 rounded-full bg-red-500/80'
        : status === 'checking'
          ? 'h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mushi-ink-faint)]'
          : 'h-1.5 w-1.5 rounded-full bg-[var(--mushi-ink-faint)]/60'

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
