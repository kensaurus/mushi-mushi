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
  /** False when the app's status row above already draws the chips (Firecrawl table). */
  showChips?: boolean
}

/** "#2", "#2 (was #5)", "not in the top 20", "not checked yet". */
function rankLabel(k: RankKeyword): string {
  if (!k.last_checked_at) return 'not checked yet'
  if (k.last_error) return 'could not check'
  const now = k.last_rank == null ? 'not in the top 20' : `#${k.last_rank}`
  const prev = k.history?.[1]
  if (!prev) return now
  return prev.rank === k.last_rank ? now : `${now} (was ${prev.rank == null ? 'not ranked' : `#${prev.rank}`})`
}

/**
 * @internal Exported for tests. A keyword's rank as a chip: the number (or
 * "20+" / not checked) and its move since the last check, so the ranks read
 * at a glance instead of as "…: not in the top 20" sentences.
 */
function rankChip(k: RankKeyword): { value: string; move: string | null; tone: 'ok' | 'off' | 'warn' | 'neutral' } {
  if (!k.last_checked_at) return { value: 'not checked', move: null, tone: 'off' }
  if (k.last_error) return { value: 'could not check', move: null, tone: 'warn' }
  const value = k.last_rank == null ? '20+' : `#${k.last_rank}`
  const prev = k.history?.[1]
  if (!prev || prev.rank === k.last_rank) return { value, move: null, tone: k.last_rank != null && k.last_rank <= 10 ? 'ok' : 'neutral' }
  // A smaller number is a better rank; unranked counts as below 20.
  const before = prev.rank ?? 21
  const after = k.last_rank ?? 21
  const move = after < before ? `↑${before - after}` : `↓${after - before}`
  return { value, move, tone: k.last_rank != null && k.last_rank <= 10 ? 'ok' : 'neutral' }
}

const RANK_TONE: Record<ReturnType<typeof rankChip>['tone'], string> = {
  ok: 'text-ok-foreground',
  warn: 'text-warn-foreground',
  off: 'text-fg-muted',
  neutral: 'text-fg',
}

function lines(keywords: RankKeyword[]): string {
  return keywords.map((k) => (k.country === 'US' ? k.query : `${k.query} @${k.country}`)).join('\n')
}

/**
 * One chip per keyword: the words (wrapping, never cut mid-word), the rank and
 * its move. "20+" means not in the top 20; the chip's label says so.
 */
export function RankChips({ name, keywords, inline = false }: { name: string; keywords: RankKeyword[]; inline?: boolean }) {
  if (keywords.length === 0) return null
  // Inside a <summary> (phrasing content only) the list is spans with list roles.
  const List = inline ? 'span' : 'ul'
  const Item = inline ? 'span' : 'li'
  return (
    <List
      className="flex flex-wrap gap-1.5 text-xs text-fg-secondary"
      aria-label={`Search ranks for ${name}`}
      {...(inline ? { role: 'list' } : {})}
    >
      {keywords.map((k) => {
        const chip = rankChip(k)
        const label = `${k.query}${k.country !== 'US' ? ` (${k.country})` : ''}: ${rankLabel(k)}`
        return (
          <Item
            key={k.id}
            {...(inline ? { role: 'listitem' } : {})}
            className="inline-flex max-w-full items-baseline gap-1.5 rounded-sm border border-edge-subtle bg-surface-raised px-1.5 py-0.5"
            title={k.last_top?.length ? `${label}. Top results: ${k.last_top.join(', ')}` : label}
            aria-label={label}
            data-testid="search-rank-chip"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {k.query}
              {k.country !== 'US' && <span className="text-fg-muted"> {k.country}</span>}
            </span>
            <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${RANK_TONE[chip.tone]}`}>{chip.value}</span>
            {chip.move && (
              <span className={`shrink-0 text-2xs tabular-nums ${chip.move.startsWith('↑') ? 'text-ok-foreground' : 'text-danger-foreground'}`}>
                {chip.move}
              </span>
            )}
          </Item>
        )
      })}
    </List>
  )
}

export function SearchRankControl({ projectId, name, keywords, target, firecrawlReady, onChanged, showChips = true }: Props) {
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
      {!target && <p className="text-xs text-fg-muted">Watch or audit the live site first, so Mushi Mushi knows which address to look for.</p>}
      {showChips && keywords.length > 0 && draft == null && <RankChips name={name} keywords={keywords} />}
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
