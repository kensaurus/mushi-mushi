/**
 * FILE: apps/admin/src/pages/GrowthPage.tsx
 * PURPOSE: Operator-only company funnel — activated external projects per
 *          week, stage-by-stage drop-off, and a split by signup source.
 *
 * Data: GET /v1/admin/growth/funnel?weeks=8&source=all|<signup_source>
 *       (operator-only; 403 otherwise). Shape: { weeks[], by_source[], generated_at }.
 * Auth: jwtAuth + entitlements `operator` flag (useEntitlements().isOperator).
 * Nav: navRegistry 'nav:growth', sectionId 'check', operatorOnly.
 *
 * Stage order mirrors packages/core/src/analytics-taxonomy.ts:
 *   visits → signups → projects → keys → sdk_installed → activated
 *   (first_report_received) → fix_pulled → habit → paid.
 */

import { useEffect, useState } from 'react'
import { usePageData } from '../lib/usePageData'
import { usePageCopy } from '../lib/copy'
import { useEntitlements } from '../lib/useEntitlements'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import {
  Btn,
  Card,
  EmptyState,
  FreshnessPill,
  Loading,
  Section,
  SelectField,
  StatCard,
  StatGrid,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { PageLoadError } from '../components/PageLoadError'
import { LineSparkline } from '../components/charts'
import { IconGauge } from '../components/icons'

// ─── Types ────────────────────────────────────────────────────────────────────

const STAGES = [
  'visits',
  'signups',
  'projects',
  'keys',
  'sdk_installed',
  'activated',
  'fix_pulled',
  'habit',
  'paid',
] as const

type StageKey = (typeof STAGES)[number]

const STAGE_LABEL: Record<StageKey, string> = {
  visits: 'Visits',
  signups: 'Signups',
  projects: 'Projects',
  keys: 'Keys',
  sdk_installed: 'SDK installed',
  activated: 'Activated',
  fix_pulled: 'Fix pulled',
  habit: 'Habit',
  paid: 'Paid',
}

interface FunnelWeek extends Record<StageKey, number> {
  /** ISO week start (YYYY-MM-DD). */
  week: string
}

interface FunnelSource {
  source: string
  signups: number
  activated: number
}

interface GrowthFunnel {
  weeks: FunnelWeek[]
  by_source: FunnelSource[]
  generated_at: string
}

const WEEKS = 8
const ALL_SOURCES = 'all'

// ─── Page ────────────────────────────────────────────────────────────────────

export function GrowthPage() {
  const copy = usePageCopy('/growth')
  const ent = useEntitlements()
  const [source, setSource] = useState<string>(ALL_SOURCES)
  // Sources seen so far — keeps the select stable while a filtered response
  // only echoes the selected source back.
  const [knownSources, setKnownSources] = useState<string[]>([])

  const path = ent.isOperator
    ? `/v1/admin/growth/funnel?weeks=${WEEKS}&source=${encodeURIComponent(source)}`
    : null
  const {
    data,
    loading,
    error,
    errorCode,
    requestId,
    errorEndpoint,
    isValidating,
    lastFetchedAt,
    reload,
  } = usePageData<GrowthFunnel>(path, { scope: 'none' })

  const bySource = data?.by_source
  useEffect(() => {
    if (!bySource || bySource.length === 0) return
    setKnownSources((prev) => {
      const merged = Array.from(new Set([...prev, ...bySource.map((s) => s.source)])).sort()
      return merged.length === prev.length ? prev : merged
    })
  }, [bySource])

  if (ent.loading && !ent.isOperator) {
    return <Loading text="Checking access…" />
  }

  if (!ent.isOperator) {
    return (
      <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-growth">
        <PageHeaderBar
          title={copy?.title ?? 'Growth'}
          description="Activated external projects per week."
          icon={<IconGauge />}
        />
        <Card className="px-4 py-10">
          <EmptyState
            title="Operators only"
            description="The company growth funnel is visible to Mushi operators. Your account can still see per-project activity."
            hints={['Open Activity for the project-level view of sessions and users.']}
          />
        </Card>
      </div>
    )
  }

  const weeks = data?.weeks ?? []
  const latest = weeks.length > 0 ? weeks[weeks.length - 1] : null

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-growth">
      <PageHeaderBar
        title={copy?.title ?? 'Growth'}
        description={
          copy?.description ??
          'Activated external projects per week — the company funnel from visit to paid, by signup source.'
        }
        icon={<IconGauge />}
        helpTitle={copy?.help?.title ?? 'About Growth'}
        helpWhatIsIt={
          copy?.help?.whatIsIt ??
          'Weekly counts for every funnel stage across all external projects. "Activated" means a project received its first SDK-originated report.'
        }
        helpUseCases={
          copy?.help?.useCases ?? [
            'Spot the stage with the biggest week-over-week drop-off',
            'Compare activation rate by signup source before spending on a channel',
            'Track whether paid follows activation with a lag',
          ]
        }
        helpHowToUse={
          copy?.help?.howToUse ??
          'Pick a source to filter the weekly table. Drop-off is measured between adjacent stages within the same week.'
        }
      >
        <FreshnessPill at={lastFetchedAt} isValidating={isValidating} />
        <Btn size="sm" variant="ghost" onClick={reload} loading={isValidating}>
          Refresh
        </Btn>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.heroOrSnapshot,
            show: Boolean(latest),
            children: latest ? (
              <StatGrid>
                <StatCard
                  label="Signups"
                  value={fmt(latest.signups)}
                  detail={`week of ${shortWeek(latest.week)}`}
                  trend={weeks.map((w) => w.signups ?? 0)}
                />
                <StatCard
                  label="Projects"
                  value={fmt(latest.projects)}
                  detail={pctDetail(latest.projects, latest.signups, 'of signups')}
                  trend={weeks.map((w) => w.projects ?? 0)}
                />
                <StatCard
                  label="Activated"
                  value={fmt(latest.activated)}
                  detail={pctDetail(latest.activated, latest.projects, 'of projects')}
                  trend={weeks.map((w) => w.activated ?? 0)}
                />
                <StatCard
                  label="Paid"
                  value={fmt(latest.paid)}
                  detail={pctDetail(latest.paid, latest.activated, 'of activated')}
                  trend={weeks.map((w) => w.paid ?? 0)}
                />
              </StatGrid>
            ) : null,
          },
        ]}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <SelectField
            label="Signup source"
            id="growth-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value={ALL_SOURCES}>All sources</option>
            {knownSources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
        </div>
        {data?.generated_at && (
          <p className="text-2xs text-fg-faint">
            Generated {new Date(data.generated_at).toLocaleString()}
          </p>
        )}
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-faint">Loading funnel…</div>
      )}
      {error && (
        <PageLoadError
          error={error}
          code={errorCode}
          resource="growth funnel"
          endpoint={errorEndpoint}
          requestId={requestId}
          onRetry={reload}
        />
      )}

      {data && weeks.length === 0 && (
        <Card className="px-4 py-10">
          <EmptyState
            title="No funnel data yet"
            description={
              source === ALL_SOURCES
                ? 'Weekly rows appear once product events and signups have been recorded.'
                : `No signups attributed to "${source}" in the last ${WEEKS} weeks.`
            }
            action={
              source !== ALL_SOURCES ? (
                <Btn size="sm" variant="ghost" onClick={() => setSource(ALL_SOURCES)}>
                  Show all sources
                </Btn>
              ) : undefined
            }
          />
        </Card>
      )}

      {data && weeks.length > 0 && latest && (
        <>
          <Section title={`Activated projects — last ${weeks.length} weeks`}>
            <LineSparkline
              values={weeks.map((w) => w.activated ?? 0)}
              xLabels={weeks.map((w) => shortWeek(w.week))}
              height={64}
              showAxes
              scaleToData
              yAxisCaption="Activated"
              ariaLabel="Activated external projects per week"
            />
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-fg-muted">
              <span>Peak: {fmt(Math.max(...weeks.map((w) => w.activated ?? 0)))}</span>
              <span>Total: {fmt(sum(weeks.map((w) => w.activated ?? 0)))}</span>
            </div>
          </Section>

          <Section title="Weekly funnel — drop-off between adjacent stages">
            <div className="overflow-x-auto">
              <table className="w-full min-w-4xl text-xs">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wider text-fg-faint">
                    <th className="py-1.5 pr-3 font-medium">Week</th>
                    {STAGES.map((stage) => (
                      <th key={stage} className="py-1.5 px-2 text-right font-medium">
                        {STAGE_LABEL[stage]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...weeks].reverse().map((w) => (
                    <tr key={w.week} className="border-t border-edge-subtle align-top">
                      <td className="py-2 pr-3 font-mono text-fg-muted whitespace-nowrap">{shortWeek(w.week)}</td>
                      {STAGES.map((stage, i) => {
                        const value = w[stage] ?? 0
                        const prev = i > 0 ? (w[STAGES[i - 1]] ?? 0) : null
                        const drop = prev == null ? null : dropOff(prev, value)
                        return (
                          <td key={stage} className="py-2 px-2 text-right tabular-nums">
                            <div className="text-fg">{fmt(value)}</div>
                            {drop != null && (
                              <div className={`text-2xs ${dropTone(drop)}`}>
                                {drop === 0 ? '±0%' : `−${drop}%`}
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-2xs text-fg-faint">
              Drop-off = share lost from the previous stage in the same week. Newest week first.
            </p>
          </Section>

          <Section title="By signup source">
            {data.by_source.length === 0 ? (
              <p className="text-xs text-fg-faint">No attributed signups in this window.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wider text-fg-faint">
                    <th className="py-1.5 pr-3 font-medium">Source</th>
                    <th className="py-1.5 px-2 text-right font-medium">Signups</th>
                    <th className="py-1.5 px-2 text-right font-medium">Activated</th>
                    <th className="py-1.5 px-2 text-right font-medium">Activation rate</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.by_source]
                    .sort((a, b) => b.signups - a.signups)
                    .map((row) => (
                      <tr key={row.source} className="border-t border-edge-subtle">
                        <td className="py-2 pr-3 text-fg">
                          <button
                            type="button"
                            className="text-left hover:text-brand hover:underline"
                            onClick={() => setSource(row.source)}
                          >
                            {row.source}
                          </button>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums text-fg">{fmt(row.signups)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-fg">{fmt(row.activated)}</td>
                        <td className="py-2 px-2 text-right tabular-nums text-fg-muted">
                          {row.signups > 0 ? `${Math.round((row.activated / row.signups) * 100)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  const v = n ?? 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/** Percent lost from `prev` to `next`, clamped to [0, 100]; null when prev is 0. */
function dropOff(prev: number, next: number): number | null {
  if (prev <= 0) return null
  return Math.max(0, Math.min(100, Math.round((1 - next / prev) * 100)))
}

function dropTone(drop: number): string {
  if (drop >= 70) return 'text-danger'
  if (drop >= 40) return 'text-warn'
  return 'text-fg-faint'
}

function pctDetail(part: number | null | undefined, whole: number | null | undefined, suffix: string): string {
  const p = part ?? 0
  const w = whole ?? 0
  if (w <= 0) return suffix
  return `${Math.round((p / w) * 100)}% ${suffix}`
}

/** "2026-09-14" → "Sep 14". Falls back to the raw label for non-ISO input. */
function shortWeek(week: string): string {
  const d = new Date(`${week}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return week
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
