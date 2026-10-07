/**
 * ContentQualityPage — Content Quality Debug Station.
 *
 * Shows content assets that need review: low source scores, user flags, poor ratings.
 * Each row is one fixable asset — click to open the detail and trigger regeneration.
 * Noise is cleared in bulk with ContentBulkDismissBar (ticked rows or the filter).
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { useEntitlements } from '../lib/useEntitlements'
import { useToast } from '../lib/toast'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  EmptyState,
  Btn,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PageLoadError } from '../components/PageLoadError'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { ResponsiveTable } from '../components/ResponsiveTable'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SignalChip, ConfidenceMeter } from '../components/report-detail/ReportSurface'
import { ContentQualityReadout } from '../components/content-quality/ContentQualityReadout'
import {
  ContentBulkDismissBar,
  type ContentDismissFilter,
} from '../components/content-quality/ContentBulkDismiss'
import {
  EMPTY_CONTENT_QUALITY_STATS,
  type ContentQualityStats,
} from '../components/content-quality/ContentQualityStatsTypes'

interface ContentQualityIssue {
  id: string
  content_ref: string
  content_type: string
  content_key: string
  reason: 'low_judge_score' | 'user_flag' | 'low_star_rating' | 'high_downvote_ratio'
  judge_score: number | null
  avg_star: number | null
  downvote_ratio: number | null
  flag_count: number
  status: string
  regen_status: string | null
  created_at: string
  source: string | null
}

interface ListResponse {
  items: ContentQualityIssue[]
  total: number
  page: number
  limit: number
}

// `low_judge_score` means the score the source app sent was low. That score is
// not always an AI grade: glot.it, for one, sends its up/down vote score.
const REASON_LABELS: Record<string, string> = {
  low_judge_score:     'Low score',
  user_flag:           'User flagged',
  low_star_rating:     'Low stars',
  high_downvote_ratio: 'High downvotes',
}

const REASON_TONE: Record<string, 'danger' | 'warn' | 'neutral' | 'info'> = {
  low_judge_score:     'danger',
  user_flag:           'warn',
  low_star_rating:     'warn',
  high_downvote_ratio: 'neutral',
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'info' | 'danger'> = {
  open:         'warn',
  in_review:    'info',
  regenerating: 'info',
  resolved:     'ok',
  dismissed:    'neutral',
}

const REGEN_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  queued:    'info',
  running:   'info',
  completed: 'ok',
  failed:    'danger',
}

const TYPE_ICON: Record<string, string> = {
  mnemonic:         '🧠',
  grammar_lesson:   '📖',
  listening_exercise: '🎧',
  lesson_story:     '📝',
  podcast:          '🎙️',
  word_thumbnail:   '🖼️',
}

const LANG_FLAG: Record<string, string> = {
  vi: '🇻🇳', zh: '🇨🇳', ja: '🇯🇵',
  de: '🇩🇪', fr: '🇫🇷', es: '🇪🇸',
  ko: '🇰🇷', th: '🇹🇭', en: '🇬🇧',
  ru: '🇷🇺', ar: '🇸🇦', hi: '🇮🇳',
  pt: '🇵🇹', it: '🇮🇹', nl: '🇳🇱',
  tr: '🇹🇷', pl: '🇵🇱', sv: '🇸🇪',
}

/** Extract language code from "sha256hash:vi" keys. Returns null for non-hash keys. */
function extractLang(key: string): string | null {
  const match = key.match(/:([a-z]{2})$/)
  return match ? match[1] : null
}

/** Return a human-friendly label for the content key. */
function humanKey(key: string, contentType: string): string {
  if (!key) return '(unnamed)'
  const lang = extractLang(key)
  if (lang) {
    // Hash-based key — the useful part is the language tag
    const typeShort: Record<string, string> = {
      mnemonic: 'word',
      word_thumbnail: 'thumbnail',
    }
    return `${typeShort[contentType] ?? contentType} · ${lang}`
  }
  // Human-readable slug key — show as-is (max 40 chars)
  return key.length > 40 ? key.slice(0, 38) + '…' : key
}

/**
 * The number the Score column shows, and what it is. Prefers the score the
 * source sent (`judge_score` — an AI grade or a vote score, depending on the
 * source), then stars, then the approval rate for high-downvote rows.
 */
function qualityScore(item: ContentQualityIssue): { value: number; basis: string } | null {
  if (item.judge_score != null) return { value: item.judge_score, basis: 'score sent by source' }
  if (item.avg_star != null) return { value: item.avg_star / 5, basis: 'star rating' }
  if (item.reason === 'high_downvote_ratio' && item.downvote_ratio != null) {
    return { value: 1 - item.downvote_ratio, basis: 'approval rate' }
  }
  return null
}

/** List query value for "rows with no source" (seed and test rows). */
const NO_SOURCE = '__none__'

const SCORE_BANDS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any score' },
  { value: 'unscored', label: 'No score' },
  { value: 'below_0_3', label: 'Score below 0.3' },
  { value: '0_3_to_0_6', label: 'Score 0.3–0.6' },
  { value: '0_6_and_up', label: 'Score 0.6 and up' },
]

export function ContentQualityPage() {
  const navigate = useNavigate()
  const activeProjectId = useActiveProjectId()
  const { canEditProject } = useEntitlements()
  const toast = useToast()
  const [status, setStatus] = useState<string>('open')
  const [reason, setReason] = useState<string>('')
  const [contentType, setContentType] = useState<string>('')
  const [source, setSource] = useState<string>('')
  const [scoreBand, setScoreBand] = useState<string>('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const LIMIT = 50

  const params = new URLSearchParams({
    project_id: activeProjectId ?? '',
    status,
    limit: String(LIMIT),
    page: String(page),
    ...(reason ? { reason } : {}),
    ...(contentType ? { content_type: contentType } : {}),
    ...(source ? { source } : {}),
    ...(scoreBand ? { score_band: scoreBand } : {}),
  })

  const apiPath = activeProjectId
    ? `/v1/admin/content-quality?${params}`
    : null

  const { data, loading, error, reload } = usePageData<ListResponse>(apiPath)
  const statsPath = activeProjectId
    ? `/v1/admin/content-quality/stats?project_id=${activeProjectId}`
    : null
  const {
    data: statsData,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
    reload: reloadStats,
  } = usePageData<ContentQualityStats>(statsPath, { deps: [activeProjectId] })
  const contentStats = statsData ?? EMPTY_CONTENT_QUALITY_STATS
  const items = data?.items ?? []
  const total = data?.total ?? 0

  // Any filter or page change starts a fresh selection, so "Dismiss
  // selected" never acts on rows the person can no longer see.
  const changeFilter = (apply: () => void) => {
    apply()
    setPage(0)
    setSelected(new Set())
  }
  const canBulkDismiss = canEditProject && (status === 'open' || status === 'in_review')
  const dismissFilter: ContentDismissFilter = {
    status: status === 'in_review' ? 'in_review' : 'open',
    ...(reason ? { reason } : {}),
    ...(contentType ? { content_type: contentType } : {}),
    ...(source ? { source: source === NO_SOURCE ? null : source } : {}),
    ...(scoreBand ? { score_band: scoreBand } : {}),
  }
  const pageIds = items.map(item => item.id)
  const allOnPageSelected = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  const toggleRow = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const togglePage = () => setSelected(allOnPageSelected ? new Set() : new Set(pageIds))
  // Filter options: the known content types plus whatever this page shows,
  // and the sources this page shows (the list has no facet endpoint).
  const typeOptions = [...new Set([...Object.keys(TYPE_ICON), ...items.map(i => i.content_type), ...(contentType ? [contentType] : [])])].sort()
  const sourceOptions = [...new Set([...items.map(i => i.source).filter((s): s is string => !!s), ...(source && source !== NO_SOURCE ? [source] : [])])].sort()

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState title="Select a project" description="Choose a project to view content quality issues." />
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeaderBar
        title="Content Quality"

        helpTitle="About Content Quality"
        helpWhatIsIt="Content quality issues are surfaced by the score the source app sends, user flags, star ratings, and downvote ratios. The score is whatever the source sends: an AI judge grade or, for some sources, an up/down vote score. Each issue links to its Langfuse trace and full feedback history."
        helpUseCases={[
          'Find low-scoring generated content',
          'Trigger regeneration from the source project',
          'View user ratings and flags alongside the source score',
          'Clear noise in bulk: tick rows or filter, then dismiss with a reason',
        ]}
        helpHowToUse="Filter by status, reason, type, source or score, open an issue to see the full context, then click Regenerate & push to create an improved version — the source project judges the candidate and only promotes it if the score improves. To clear noise, tick rows or use Dismiss all matching; the dialog states the exact number of rows first."
      >
        <select
          aria-label="Status"
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={status}
          onChange={e => changeFilter(() => setStatus(e.target.value))}
        >
          <option value="open">Open</option>
          <option value="in_review">In review</option>
          <option value="regenerating">Regenerating</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All statuses</option>
        </select>
        <select
          aria-label="Reason"
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={reason}
          onChange={e => changeFilter(() => setReason(e.target.value))}
        >
          <option value="">All reasons</option>
          <option value="low_judge_score">Low score</option>
          <option value="user_flag">User flagged</option>
          <option value="low_star_rating">Low stars</option>
          <option value="high_downvote_ratio">High downvotes</option>
        </select>
        <select
          aria-label="Content type"
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={contentType}
          onChange={e => changeFilter(() => setContentType(e.target.value))}
        >
          <option value="">All types</option>
          {typeOptions.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <select
          aria-label="Source"
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={source}
          onChange={e => changeFilter(() => setSource(e.target.value))}
        >
          <option value="">All sources</option>
          <option value={NO_SOURCE}>No source</option>
          {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          aria-label="Score sent by source"
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={scoreBand}
          onChange={e => changeFilter(() => setScoreBand(e.target.value))}
        >
          {SCORE_BANDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </PageHeaderBar>

      <PagePosture
        slots={[
          {
            priority: POSTURE_PRIORITY.guide,
            children: (
              <ContentQualityReadout
                stats={contentStats}
                fetchedAt={statsFetchedAt}
                isValidating={statsValidating}
              />
            ),
          },
        ]}
      />

      <div className="flex-1 overflow-auto p-4">
        {error && <PageLoadError error={error} resource="content issues" />}
        {loading && <TableSkeleton rows={8} />}

        {!loading && items.length === 0 && (
          <EmptyState
            title="No content issues"
            description={
              status === 'open'
                ? 'No open issues. The bridge job syncs every 15 minutes — check back soon, or check that the source project is running.'
                : `No issues with status "${status}".`
            }
          />
        )}

        {!loading && items.length > 0 && (
          <>
            {/* Column guide — only visible when table is populated */}
            <p className="mb-2 text-2xs text-fg-muted">
              Click any row to view the full asset context and trigger regeneration.
            </p>

            {canBulkDismiss && (
              <ContentBulkDismissBar
                projectId={activeProjectId}
                selectedIds={[...selected]}
                matchingTotal={total}
                filter={dismissFilter}
                onDismissed={({ dismissed, remaining }) => {
                  setSelected(new Set())
                  setPage(0)
                  toast.success(
                    remaining > 0
                      ? `Dismissed ${dismissed.toLocaleString()} rows. ${remaining.toLocaleString()} still match: run it again for the rest.`
                      : `Dismissed ${dismissed.toLocaleString()} row${dismissed === 1 ? '' : 's'}.`,
                  )
                  reload()
                  reloadStats()
                }}
              />
            )}

            <ResponsiveTable ariaLabel="Content quality issues">
              <table className="w-full text-xs">
                <thead className="bg-surface-overlay border-b border-edge">
                  <tr>
                    {canBulkDismiss && (
                      <th className="w-8 px-3 py-2.5 text-left">
                        <input
                          type="checkbox"
                          aria-label="Select every row on this page"
                          checked={allOnPageSelected}
                          onChange={togglePage}
                          className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                        />
                      </th>
                    )}
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Asset</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Reason</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Score</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Status</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Detected</th>
                    <th className="w-5 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {items.map(item => {
                    const lang = extractLang(item.content_key)
                    const icon = TYPE_ICON[item.content_type] ?? '📄'
                    const langFlag = lang ? (LANG_FLAG[lang] ?? '') : ''
                    const label = humanKey(item.content_key, item.content_type)
                    const score = qualityScore(item)

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-surface-overlay cursor-pointer transition-opacity group"
                        onClick={() => navigate(`/content/${item.id}`)}
                      >
                        {canBulkDismiss && (
                          <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${label}`}
                              checked={selected.has(item.id)}
                              onChange={() => toggleRow(item.id)}
                              className="h-3.5 w-3.5 rounded-sm border-edge bg-surface-raised accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                            />
                          </td>
                        )}
                        {/* Asset: icon + type + human key */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base leading-none" aria-hidden="true">{icon}</span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-fg-primary capitalize">{item.content_type.replace(/_/g, ' ')}</span>
                                {langFlag && (
                                  <span className="text-sm leading-none" title={lang ?? ''}>{langFlag}</span>
                                )}
                              </div>
                              <div className="text-2xs text-fg-muted truncate max-w-48 mt-0.5" title={item.content_key}>
                                {label}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Reason chip */}
                        <td className="px-3 py-3">
                          <SignalChip tone={REASON_TONE[item.reason] ?? 'neutral'}>
                            {REASON_LABELS[item.reason] ?? item.reason}
                          </SignalChip>
                          {item.flag_count > 0 && (
                            <span className="ml-1.5 text-2xs text-fg-muted">{item.flag_count} flag{item.flag_count !== 1 ? 's' : ''}</span>
                          )}
                        </td>

                        {/* Score: bar plus what the number is, or "not scored" */}
                        <td className="px-3 py-3 w-36">
                          {score != null
                            ? (
                              <div className="flex flex-col gap-0.5">
                                <ConfidenceMeter confidence={score.value} />
                                <span className="text-2xs text-fg-muted">{score.basis}</span>
                              </div>
                            )
                            : <span className="text-2xs text-fg-muted italic">not scored</span>
                          }
                        </td>

                        {/* Status: chip + regen sub-status */}
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-1">
                            <SignalChip tone={STATUS_TONE[item.status] ?? 'neutral'}>
                              {item.status.replace(/_/g, ' ')}
                            </SignalChip>
                            {item.regen_status && (
                              <SignalChip tone={REGEN_TONE[item.regen_status] ?? 'neutral'} className="self-start">
                                regen: {item.regen_status}
                              </SignalChip>
                            )}
                          </div>
                        </td>

                        {/* Date */}
                        <td className="px-3 py-3 text-fg-muted whitespace-nowrap">
                          {new Date(item.created_at).toLocaleDateString()}
                        </td>

                        {/* Chevron — Btn so keyboard and screen-reader users can
                            activate the row without the table's row semantics being overridden
                            by role="button". focus-visible:opacity-100 makes it reappear for
                            sighted keyboard users; opacity-0 is purely cosmetic for mouse. */}
                        <td className="px-3 py-3">
                          <Btn
                            variant="ghost"
                            size="sm"
                            className="border-0 bg-transparent shadow-none hover:bg-transparent px-1 py-0 min-h-0 text-fg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:ring-1 focus-visible:ring-current"
                            tabIndex={0}
                            aria-label={`Open ${label}`}
                            onClick={e => { e.stopPropagation(); navigate(`/content/${item.id}`) }}
                          >
                            →
                          </Btn>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </ResponsiveTable>
          </>
        )}

        {total > LIMIT && (
          <div className="flex justify-between items-center mt-4">
            <span className="text-xs text-fg-muted">
              Showing {page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Btn size="sm" variant="ghost" disabled={page === 0} onClick={() => { setPage(p => Math.max(0, p - 1)); setSelected(new Set()) }}>
                Previous
              </Btn>
              <Btn size="sm" variant="ghost" disabled={(page + 1) * LIMIT >= total} onClick={() => { setPage(p => p + 1); setSelected(new Set()) }}>
                Next
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
