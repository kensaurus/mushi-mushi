/**
 * FILE: apps/admin/src/components/ConsoleHelpPanel.tsx
 * PURPOSE: Settings panel for the global console help knowledge index (Cmd+K assist).
 */

import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiFetchMutate } from '../lib/supabase'
import { Btn, Section } from './ui'

interface Status {
  chunkCount: number
  lastUpdated: string | null
  schemaPending?: boolean
}

export function ConsoleHelpPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await apiFetch<Status>('/v1/admin/console-knowledge/status')
    if (res.ok && res.data) setStatus(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function rebuild() {
    setRebuilding(true)
    setMessage(null)
    const res = await apiFetchMutate<{ upserted?: number; data?: { upserted?: number } }>(
      '/v1/admin/console-knowledge/rebuild',
      { method: 'POST', body: '{}' },
    )
    setRebuilding(false)
    if (res.ok) {
      const upserted = res.data?.upserted ?? res.data?.data?.upserted
      setMessage(`Indexed ${upserted ?? '—'} chunks.`)
      void load()
    } else {
      setMessage(res.error?.message ?? 'Rebuild failed')
    }
  }

  return (
    <Section title="Console help index" freshness={{ at: status?.lastUpdated ?? null, isValidating: loading }}>
      <p className="text-xs text-fg-muted mb-3 max-w-prose">
        Powers Cmd+K natural-language answers (how-to steps and page deep links). Rebuild after
        deploying admin copy or recipe changes.
      </p>
      {loading ? (
        <p className="text-xs text-fg-faint">Loading…</p>
      ) : (
        <p className="text-xs text-fg mb-3">
          {status?.schemaPending
            ? 'Migration pending — run deploy first.'
            : `${status?.chunkCount ?? 0} chunks · last updated ${status?.lastUpdated ? new Date(status.lastUpdated).toLocaleString() : 'never'}`}
        </p>
      )}
      <Btn variant="ghost" size="sm" disabled={rebuilding || status?.schemaPending} onClick={() => void rebuild()}>
        {rebuilding ? 'Rebuilding…' : 'Rebuild console help index'}
      </Btn>
      {message && <p className="text-2xs text-fg-muted mt-2">{message}</p>}
    </Section>
  )
}
