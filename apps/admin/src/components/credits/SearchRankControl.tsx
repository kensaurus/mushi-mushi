/**
 * FILE: apps/admin/src/components/credits/SearchRankControl.tsx
 * PURPOSE: /credits, one app's search rank check: where it ranks in web
 *          search for the words its users would type, checked weekly through
 *          Firecrawl (about 4 credits a keyword), with Edit keywords and
 *          Check now. A visibility number for the owner; it files no reports.
 */

import { useState } from 'react'
import { Btn, Textarea } from '../ui'
import { apiFetch } from '../../lib/supabase'

export interface RankKeyword {
  id: string
  query: string
  country: string
  last_rank: number | null
  last_top: string[] | null
  last_checked_at: string | null
  last_error: string | null
  history?: Array<{ at: string; rank: number | null }>
}

interface Props {
  projectId: string
  name: string
  keywords: RankKeyword[]
  target: string | null
  firecrawlReady: boolean
  onChanged: (message: { ok: boolean; message: string }) => void
}

/** "#2", "#2 (was #5)", "not in the top 20", "not checked yet". */
export function rankLabel(k: RankKeyword): string {
  if (!k.last_checked_at) return 'not checked yet'
  if (k.last_error) return 'could not check'
  const now = k.last_rank == null ? 'not in the top 20' : `#${k.last_rank}`
  const prev = k.history?.[1]
  if (!prev) return now
  return prev.rank === k.last_rank ? now : `${now} (was ${prev.rank == null ? 'not ranked' : `#${prev.rank}`})`
}

function lines(keywords: RankKeyword[]): string {
  return keywords.map((k) => (k.country === 'US' ? k.query : `${k.query} @${k.country}`)).join('\n')
}

export function SearchRankControl({ projectId, name, keywords, target, firecrawlReady, onChanged }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    if (draft == null) return
    setBusy(true)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/search-ranks`, { method: 'PUT', body: JSON.stringify({ keywords: draft }) })
    setBusy(false)
    if (res.ok) setDraft(null)
    onChanged(res.ok ? { ok: true, message: `${name}: keywords saved; Check now reads them, or they are checked within a day.` } : { ok: false, message: res.error?.message ?? 'Not saved.' })
  }

  async function checkNow() {
    setBusy(true)
    const res = await apiFetch(`/v1/admin/projects/${projectId}/search-ranks/run`, { method: 'POST' })
    setBusy(false)
    onChanged(res.ok ? { ok: true, message: `${name}: checking search ranks now.` } : { ok: false, message: res.error?.message ?? 'Not started.' })
  }

  return (
    <div className="space-y-1 pl-3 border-l border-edge-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg">
          Search rank{target ? <span className="text-fg-muted"> · looking for {target}</span> : null}
        </p>
        <div className="flex gap-1">
          {draft == null && (
            <Btn size="sm" variant="ghost" type="button" disabled={!target} onClick={() => setDraft(lines(keywords))}>
              {keywords.length ? 'Edit keywords' : 'Add keywords'}
            </Btn>
          )}
          {keywords.length > 0 && draft == null && (
            <Btn size="sm" variant="ghost" type="button" loading={busy} disabled={!firecrawlReady} onClick={() => void checkNow()}>
              Check now
            </Btn>
          )}
        </div>
      </div>
      {!target && <p className="text-xs text-fg-muted">Watch or audit the live site first, so Mushi knows which address to look for.</p>}
      {keywords.length > 0 && draft == null && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-fg-secondary" aria-label={`Search ranks for ${name}`}>
          {keywords.map((k) => (
            <li key={k.id} title={k.last_top?.length ? `Top results: ${k.last_top.join(', ')}` : undefined}>
              {k.query}
              {k.country !== 'US' && <span className="text-fg-muted"> ({k.country})</span>}: <span className="tabular-nums">{rankLabel(k)}</span>
            </li>
          ))}
        </ul>
      )}
      {draft != null && (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Textarea
            id={`rank-keywords-${projectId}`}
            label="Keywords, one per line; add @JP, @TH … for another country (default US); at most 10"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex gap-2">
            <Btn type="submit" size="sm" loading={busy}>
              Save
            </Btn>
            <Btn type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Btn>
          </div>
        </form>
      )}
    </div>
  )
}
