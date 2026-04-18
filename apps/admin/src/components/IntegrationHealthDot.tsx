/**
 * FILE: apps/admin/src/components/IntegrationHealthDot.tsx
 * PURPOSE: Sidebar status indicator for the Integrations link. Reflects
 *          actual health from /v1/admin/health/history rather than just
 *          "is anything configured" — green/yellow/red mean what they say.
 */

import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/supabase'

type Status = 'unknown' | 'green' | 'yellow' | 'red' | 'idle'

interface PlatformResp {
  platform: Record<string, Record<string, unknown> | null>
}

interface HistoryRow {
  kind: string
  status: 'ok' | 'degraded' | 'down' | string
  message: string | null
  checked_at: string
}

const COLORS: Record<Status, string> = {
  unknown: 'bg-fg-faint',
  idle: 'bg-fg-faint/50',
  green: 'bg-ok',
  yellow: 'bg-warn',
  red: 'bg-danger',
}

const TITLES: Record<Status, string> = {
  unknown: 'Integration status: loading',
  idle: 'No integrations configured yet',
  green: 'All integrations healthy',
  yellow: 'One or more integrations degraded',
  red: 'One or more integrations failing',
}

function classify(
  platform: PlatformResp | undefined,
  history: HistoryRow[],
): Status {
  if (!platform?.platform) return 'idle'
  const kinds = Object.entries(platform.platform)
  const configured = kinds.some(
    ([, v]) => v && Object.values(v).some((x) => x != null && x !== ''),
  )
  if (!configured) return 'idle'
  if (history.length === 0) return 'green'

  // Take the most recent status per kind, then pick the worst.
  const latest = new Map<string, HistoryRow>()
  for (const row of history) {
    if (!latest.has(row.kind)) latest.set(row.kind, row)
  }
  let worst: Status = 'green'
  for (const row of latest.values()) {
    if (row.status === 'down') return 'red'
    if (row.status === 'degraded') worst = 'yellow'
  }
  return worst
}

export function IntegrationHealthDot() {
  const [status, setStatus] = useState<Status>('unknown')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [platformRes, historyRes] = await Promise.all([
        apiFetch<PlatformResp>('/v1/admin/integrations/platform'),
        apiFetch<{ history: HistoryRow[] }>('/v1/admin/health/history'),
      ])
      if (cancelled) return
      const platform = platformRes.ok ? platformRes.data : undefined
      const history = historyRes.ok && historyRes.data ? historyRes.data.history : []
      const next = classify(platform, history)
      setStatus(next)
      if (next === 'red' || next === 'yellow') {
        const failing = history.find(
          (h) => h.status === 'down' || h.status === 'degraded',
        )
        setMessage(failing ? `${failing.kind}: ${failing.message ?? failing.status}` : null)
      } else {
        setMessage(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const title = message ? `${TITLES[status]} — ${message}` : TITLES[status]

  return (
    <span
      aria-label={title}
      title={title}
      className={`inline-block w-1.5 h-1.5 rounded-full ml-auto ${COLORS[status]}`}
    />
  )
}
