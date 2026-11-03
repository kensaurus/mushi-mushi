/**
 * FILE: apps/admin/src/components/fullstack-audit/DatabaseHealthCard.tsx
 * PURPOSE: Full-stack audit → "Database health": this app's Supabase project
 *          as a grade, its size against the compute tier, cache hit,
 *          connections, the advisors' top issues with Supabase's fix links,
 *          and what to do, in plain words (2026-10-31: the owner asked to see
 *          the health and the advice for every Supabase project from Mushi).
 *          Read live through the app's scoped read-only token
 *          (GET /v1/admin/projects/:id/db-advisors, _shared/db-health.ts).
 *          A project several apps share says so, so one project's health is
 *          not read as one app's.
 */

import { Link } from 'react-router-dom'
import { Badge, Callout, Section, type BadgeTone } from '../ui'
import { PageLoadError } from '../PageLoadError'
import { usePageData } from '../../lib/usePageData'
import { LINK_ACCENT } from '../../lib/chipTone'

type Grade = 'good' | 'watch' | 'act'

interface DbIssue {
  name: string
  title: string
  level: 'ERROR' | 'WARN' | 'INFO'
  category: 'security' | 'performance' | 'other'
  count: number
  remediation: string | null
}

export interface DbHealthPayload {
  projectRef: string | null
  /** Set instead of health when the app is not linked yet. */
  reason?: 'no_supabase_pat' | 'no_project_ref'
  sharedWith?: string[]
  /** Why size, cache and connections are missing, when the stats read failed. */
  statsError?: string | null
  health?: {
    grade: Grade
    tier: { name: string; memoryGb: number; recommendedMaxGb: number; monthlyUsd: number } | null
    sizeMb: number | null
    sizePctOfRecommended: number | null
    cacheHitPct: number | null
    connections: number | null
    maxConnections: number | null
    statsReset: string | null
    counts: { error: number; warn: number; info: number }
    top: DbIssue[]
    advice: string[]
    /** Where time and space go; null when neither read worked. */
    hotspots?: {
      slow: Array<{ label?: string; query: string; calls: number; meanMs: number; pct: number }> | null
      slowSince: string | null
      tables: Array<{ name: string; bytes: number; rows: number; dead: number }>
      unusedIndexes: Array<{ name: string; table: string; bytes: number }>
    } | null
  }
}

type Hotspots = NonNullable<NonNullable<DbHealthPayload['health']>['hotspots']>

function bytes(n: number): string {
  return size(Math.round(n / 1_048_576))
}

const GRADE: Record<Grade, { label: string; tone: BadgeTone }> = {
  good: { label: 'Healthy', tone: 'ok' },
  watch: { label: 'Worth a look', tone: 'warn' },
  act: { label: 'Needs a fix', tone: 'danger' },
}

const LEVEL_TONE: Record<DbIssue['level'], BadgeTone> = { ERROR: 'danger', WARN: 'warn', INFO: 'neutral' }

function size(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

/**
 * "2.1 GB of 10 GB (Micro, about $10/mo)"
 *
 * @internal Exported for tests only.
 */
export function sizeLine(h: NonNullable<DbHealthPayload['health']>): string | null {
  if (h.sizeMb == null) return null
  if (!h.tier) return size(h.sizeMb)
  return `${size(h.sizeMb)} of ${h.tier.recommendedMaxGb} GB recommended (${h.tier.name}, ${h.tier.memoryGb} GB memory, about $${h.tier.monthlyUsd}/mo)`
}

export function DatabaseHealthCard({ projectId }: { projectId: string }) {
  const q = usePageData<DbHealthPayload | null>(`/v1/admin/projects/${projectId}/db-advisors`)
  const payload = q.data
  const reason = payload?.reason

  return (
    <Section title="Database health" id="database-health">
      {q.loading && !q.data ? (
        <p className="text-sm text-fg-muted">Reading your Supabase project…</p>
      ) : q.error ? (
        <PageLoadError error={q.error} resource="database health" endpoint={`/v1/admin/projects/${projectId}/db-advisors`} onRetry={() => q.reload()} />
      ) : !payload?.health ? (
        <p className="text-sm text-fg-secondary">
          {reason === 'no_project_ref'
            ? 'Link this app to its Supabase project to see its health: save the project ref in '
            : 'Add a scoped, read-only Supabase token to see this app’s database health: '}
          <Link className={LINK_ACCENT} to={reason === 'no_project_ref' ? '/settings?tab=general' : '/settings?tab=byok'}>
            {reason === 'no_project_ref' ? 'Settings → General → Supabase project' : 'Settings → AI keys → Supabase'}
          </Link>
          .
        </p>
      ) : (
        <HealthBody payload={payload} />
      )}
    </Section>
  )
}

function HealthBody({ payload }: { payload: DbHealthPayload }) {
  const h = payload.health!
  const grade = GRADE[h.grade]
  const facts = [
    sizeLine(h),
    h.cacheHitPct != null ? `${h.cacheHitPct}% of reads from memory` : null,
    h.connections != null && h.maxConnections != null ? `${h.connections} of ${h.maxConnections} connections in use` : null,
  ].filter((x): x is string => Boolean(x))
  const counts = [
    h.counts.error ? `${h.counts.error} error${h.counts.error === 1 ? '' : 's'}` : null,
    h.counts.warn ? `${h.counts.warn} warning${h.counts.warn === 1 ? '' : 's'}` : null,
    h.counts.info ? `${h.counts.info} suggestion${h.counts.info === 1 ? '' : 's'}` : null,
  ].filter((x): x is string => Boolean(x))

  return (
    <div className="space-y-3" data-testid="database-health">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={grade.tone}>{grade.label}</Badge>
        <span className="text-sm text-fg-secondary">
          Supabase project <code className="text-xs">{payload.projectRef ?? '—'}</code>
          {payload.sharedWith && payload.sharedWith.length > 0 ? ` · shared with ${payload.sharedWith.join(', ')}` : ''}
        </span>
      </div>
      {facts.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary" aria-label="Database facts">
          {facts.map((f) => (
            <li key={f} className="tabular-nums">{f}</li>
          ))}
        </ul>
      )}
      {payload.statsError && (
        <p className="text-xs text-fg-muted">Size, cache and connections could not be read this time ({payload.statsError}). The advisors below are current.</p>
      )}
      {h.advice.length > 0 && (
        <Callout tone={h.grade === 'act' ? 'danger' : h.grade === 'watch' ? 'warn' : 'info'}>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            {h.advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Callout>
      )}
      {h.top.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-fg-muted">Supabase advisors{counts.length ? `: ${counts.join(', ')}` : ''}. The top ones:</p>
          <ul className="divide-y divide-edge-subtle" aria-label="Top database issues">
            {h.top.map((i) => (
              <li key={i.name} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <Badge tone={LEVEL_TONE[i.level]}>{i.level === 'ERROR' ? 'Error' : i.level === 'WARN' ? 'Warning' : 'Suggestion'}</Badge>
                <span className="text-fg">{i.title}</span>
                <span className="text-xs tabular-nums text-fg-muted">
                  {i.count} · {i.category}
                </span>
                {i.remediation && (
                  <a href={i.remediation} target="_blank" rel="noopener noreferrer" className={`ml-auto text-xs ${LINK_ACCENT}`}>
                    How to fix ↗
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {h.hotspots && <HotspotLists hotspots={h.hotspots} />}
      {h.statsReset && (
        <p className="text-2xs text-fg-faint">Read-rate counted since {new Date(h.statsReset).toLocaleDateString()} (the database last restarted then).</p>
      )}
    </div>
  )
}

/**
 * Where the database spends its time and space, folded so the grade and the
 * advice stay the first read. Each list says why it is empty instead of
 * vanishing, so "nothing here" and "could not read" never look alike.
 */
function HotspotLists({ hotspots }: { hotspots: Hotspots }) {
  const unusedTotal = hotspots.unusedIndexes.reduce((n, i) => n + i.bytes, 0)
  return (
    <div className="space-y-1 text-sm" data-testid="database-hotspots">
      <details>
        <summary className="cursor-pointer text-fg-secondary">
          Where database time goes
          {hotspots.slowSince ? <span className="text-xs text-fg-muted"> · since {new Date(hotspots.slowSince).toLocaleString()}</span> : null}
        </summary>
        {hotspots.slow == null ? (
          <p className="py-1 text-xs text-fg-muted">Query timings could not be read (pg_stat_statements is off or not readable with this token).</p>
        ) : hotspots.slow.length === 0 ? (
          <p className="py-1 text-xs text-fg-muted">No app queries counted yet; the counters start again after a restart.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle" aria-label="Busiest queries">
            {hotspots.slow.map((q, i) => (
              <li key={`${i}-${q.query}`} className="py-1.5">
                <code className="block truncate text-xs text-fg" title={q.query}>{q.label ?? q.query}</code>
                <span className="text-xs tabular-nums text-fg-muted">
                  {q.pct}% of time · {q.meanMs} ms avg · {q.calls.toLocaleString()} calls
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
      <details>
        <summary className="cursor-pointer text-fg-secondary">Biggest tables</summary>
        <ul className="divide-y divide-edge-subtle" aria-label="Biggest tables">
          {hotspots.tables.map((t) => (
            <li key={t.name} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
              <code className="text-xs text-fg">{t.name}</code>
              <span className="text-xs tabular-nums text-fg-muted">
                {bytes(t.bytes)} · about {t.rows.toLocaleString()} rows{t.dead >= 10_000 ? ` · ${t.dead.toLocaleString()} dead rows` : ''}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer text-fg-secondary">
          Unused indexes{hotspots.unusedIndexes.length > 0 ? ` (${hotspots.unusedIndexes.length}, ${bytes(unusedTotal)})` : ''}
        </summary>
        {hotspots.unusedIndexes.length === 0 ? (
          <p className="py-1 text-xs text-fg-muted">Every index over 8 MB has been read at least once.</p>
        ) : (
          <ul className="divide-y divide-edge-subtle" aria-label="Unused indexes">
            {hotspots.unusedIndexes.map((i) => (
              <li key={i.name} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <code className="text-xs text-fg">{i.name}</code>
                <span className="text-xs tabular-nums text-fg-muted">on {i.table} · {bytes(i.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
