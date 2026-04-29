/**
 * FILE: apps/admin/src/components/migrations/MigrationsInProgressCard.tsx
 * PURPOSE: Surface in-flight migration checklists from the docs hub on the
 *          admin console (OnboardingPage post-setup-complete, ProjectsPage).
 *
 * BEHAVIOUR
 *   - Lazily fetches /v1/admin/migrations/progress on mount.
 *   - Renders nothing when the user has no in-progress migrations — we
 *     intentionally hide instead of showing an empty state, so the card
 *     never adds dead chrome to the page (NN/g #8 minimalist design).
 *   - Shows up to 4 most-recent rows with a deep link back to the docs.
 *   - Distinguishes self vs teammate progress in the project-scoped view
 *     so the operator can see "Alice is in step 3 of Cordova → Capacitor".
 *
 * DATA CONTRACT
 *   - Uses apiFetch + MigrationProgressListSchema (apps/admin/src/lib/apiSchemas.ts)
 *     so a backend drift surfaces with a Sentry-fingerprinted parse error
 *     rather than a silent undefined render.
 *
 * COSMETICS
 *   - Reuses Card / Btn / Badge primitives. No new tokens introduced.
 *   - Progress is rendered as an inline ratio + a 6-track segmented bar so
 *     the eye picks up "5 / 8" at the same time as visual fill — pinning
 *     NN/g #1 (visibility of system status) with redundant encoding.
 */

import { useEffect, useMemo, useState } from 'react'

import { apiFetch } from '../../lib/supabase'
import { MigrationProgressListSchema, type MigrationProgressRow } from '../../lib/apiSchemas'
import { Badge, Btn, Card } from '../ui'
import { findGuideMeta, docsUrlForGuide } from '../../lib/migrationsCatalog'

export interface MigrationsInProgressCardProps {
  /** When set, scopes the fetch to one project AND shows progress from
   *  every project member (so a team can see "Alice has 4/8 on Cap → RN").
   *  When undefined, renders the caller's account-scoped progress only. */
  projectId?: string | null
  /** Title override. Defaults to "Migrations in progress". */
  title?: string
  /** Maximum rows rendered. Defaults to 4 to keep the card visually quiet. */
  limit?: number
}

interface CardState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: MigrationProgressRow[]
  errorMessage: string | null
}

const INITIAL_STATE: CardState = { status: 'idle', rows: [], errorMessage: null }

function relativeTime(isoTimestamp: string | null): string {
  if (!isoTimestamp) return '—'
  const ts = Date.parse(isoTimestamp)
  if (Number.isNaN(ts)) return '—'
  const diff = Date.now() - ts
  if (diff < 0) return 'just now'
  const seconds = Math.round(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

/* Visual width of the segmented progress bar. Fixed at 6 so the card
 * stays a constant width regardless of how many steps the underlying
 * guide ships — the same number the file header advertises and the same
 * number a user sees on the docs hub. The `done / total` fraction is
 * scaled into the 6 segments at render time. */
const PROGRESS_BAR_TRACKS = 6

function ProgressBar({ done, total }: { done: number; total: number }) {
  const safeTotal = Math.max(total, 1)
  const safeDone = Math.min(Math.max(done, 0), safeTotal)
  /* Round so a 1/8 progress shows 1 segment (not 0) — half-segment is
   * the visual floor that signals "started". Any non-zero `done` lights
   * at least one track. */
  const filledTracks =
    safeDone === 0
      ? 0
      : Math.min(
          PROGRESS_BAR_TRACKS,
          Math.max(1, Math.round((safeDone / safeTotal) * PROGRESS_BAR_TRACKS)),
        )

  return (
    <div
      role="progressbar"
      aria-valuenow={safeDone}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-label={`${safeDone} of ${safeTotal} steps complete`}
      className="flex items-center gap-0.5"
    >
      {Array.from({ length: PROGRESS_BAR_TRACKS }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1.5 w-3 rounded-sm ${
            i < filledTracks ? 'bg-ok' : 'bg-surface-raised border border-border'
          }`}
        />
      ))}
    </div>
  )
}

export function MigrationsInProgressCard({
  projectId,
  title = 'Migrations in progress',
  limit = 4,
}: MigrationsInProgressCardProps) {
  const [state, setState] = useState<CardState>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', rows: [], errorMessage: null })
    const scope = projectId ? 'all' : 'mine'
    const queryProject = projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''
    const path = `/v1/admin/migrations/progress?scope=${scope}${queryProject}`

    void apiFetch(path, { schema: MigrationProgressListSchema }).then((res) => {
      if (cancelled) return
      if (!res.ok || !res.data) {
        setState({
          status: 'error',
          rows: [],
          errorMessage: res.error?.message ?? 'Could not load migrations',
        })
        return
      }
      setState({ status: 'ready', rows: res.data.progress, errorMessage: null })
    })

    return () => {
      cancelled = true
    }
  }, [projectId])

  const visibleRows = useMemo(() => {
    // The API returns rows newest-first; we additionally drop fully-complete
    // rows so the card focuses on actually-in-progress work. A migration the
    // user finished a week ago shouldn't take up valuable card space.
    return state.rows
      .filter((r) => {
        const required = r.required_step_count ?? r.completed_step_ids.length
        if (required <= 0) return false
        return r.completed_required_count < required
      })
      .slice(0, limit)
  }, [state.rows, limit])

  // Hide the card entirely when there's nothing to show. Zero in-progress
  // migrations is the common case for a brand-new account; rendering a "no
  // migrations" empty state would be dead chrome (NN/g #8).
  if (state.status === 'ready' && visibleRows.length === 0) return null
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
        </div>
        <p className="mt-2 text-xs text-fg-muted">Loading…</p>
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
        </div>
        <p className="mt-2 text-xs text-warn">{state.errorMessage}</p>
      </Card>
    )
  }

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        <span className="text-2xs text-fg-muted">
          {projectId ? 'Across this project' : 'Your account'}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {visibleRows.map((row) => {
          const meta = findGuideMeta(row.guide_slug)
          const required = row.required_step_count ?? row.completed_step_ids.length
          const done = row.completed_required_count
          const href = docsUrlForGuide(row.guide_slug, projectId ?? row.project_id ?? null)
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">
                    {meta?.title ?? row.guide_slug}
                  </span>
                  {projectId && !row.is_self && (
                    <Badge
                      className="bg-surface-raised text-fg-muted"
                      title="Progress recorded by another project member"
                    >
                      teammate
                    </Badge>
                  )}
                </div>
                {meta?.summary && (
                  <p className="mt-0.5 truncate text-xs text-fg-muted" title={meta.summary}>
                    {meta.summary}
                  </p>
                )}
                <div className="mt-1.5 flex items-center gap-3">
                  <ProgressBar done={done} total={required} />
                  <span className="text-2xs font-medium text-fg-muted">
                    {done} / {required}
                  </span>
                  <span className="text-2xs text-fg-faint">
                    Updated {relativeTime(row.updated_at)}
                  </span>
                </div>
              </div>
              <Btn
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.open(href, '_blank', 'noopener,noreferrer')
                  }
                }}
              >
                Open guide
              </Btn>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
