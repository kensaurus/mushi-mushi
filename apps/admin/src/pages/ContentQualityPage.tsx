/**
 * ContentQualityPage — Content Quality Debug Station.
 *
 * Shows content assets that need review: low source scores, user flags, poor ratings.
 * Each row is one fixable asset — click to open the detail and trigger regeneration.
 * Noise is cleared in bulk with ContentBulkDismissBar (ticked rows or the filter).
 */

import { Fragment, useMemo, useState, type ComponentType } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'
import { usePageData } from '../lib/usePageData'
import { useEntitlements } from '../lib/useEntitlements'
import { useToast } from '../lib/toast'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  EmptyState,
  Btn,
  FilterSelect,
  Input,
} from '../components/ui'
import {
  IconCamera,
  IconCatalog,
  IconIntelligence,
  IconLessons,
  IconMic,
  IconNote,
} from '../components/icons'
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

// Icons from components/icons (were emoji, which render as letters on some
// platforms). Unknown types fall back to the catalog icon.
const TYPE_ICON: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  mnemonic:           IconIntelligence,
  grammar_lesson:     IconLessons,
  listening_exercise: IconMic,
  lesson_story:       IconNote,
  podcast:            IconMic,
  word_thumbnail:     IconCamera,
}

const STATUS_OPTIONS = ['open', 'in_review', 'regenerating', 'resolved', 'dismissed'] as const
const REASON_OPTIONS = Object.keys(REASON_LABELS)

const SCORE_HEADER_TIP =
  'The score the source app sent (an AI grade or, for some sources, an up/down vote score). Rows without one show their star rating or approval rate; hover a bar to see which.'

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
  // `?reason=` / `?status=` let a link land on a slice (e.g. the sidebar's
  // user-flag count → ?reason=user_flag).
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<string>(() => searchParams.get('status') ?? 'open')
  const [reason, setReason] = useState<string>(() => {
    const r = searchParams.get('reason') ?? ''
    return r in REASON_LABELS ? r : ''
  })
  const [search, setSearch] = useState('')
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
  const pageItems = data?.items ?? []
  const total = data?.total ?? 0
  // The list route has no text search, so search filters the loaded page.
  const needle = search.trim().toLowerCase()
  const items = needle
    ? pageItems.filter((i) => i.content_key.toLowerCase().includes(needle) || i.content_ref.toLowerCase().includes(needle))
    : pageItems
  // Grouped by type and language so 50 near-identical rows read as a few groups.
  const groups = useMemo(() => {
    const map = new Map<string, { type: string; lang: string | null; rows: ContentQualityIssue[] }>()
    for (const item of items) {
      const lang = extractLang(item.content_key)
      const key = `${item.content_type}|${lang ?? ''}`
      const g = map.get(key) ?? { type: item.content_type, lang, rows: [] }
      g.rows.push(item)
      map.set(key, g)
    }
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length)
  }, [items])
  const showStatusColumn = status === 'all'

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
  const typeOptions = [...new Set([...Object.keys(TYPE_ICON), ...pageItems.map(i => i.content_type), ...(contentType ? [contentType] : [])])].sort()
  const sourceOptions = [NO_SOURCE, ...new Set([...pageItems.map(i => i.source).filter((s): s is string => !!s), ...(source && source !== NO_SOURCE ? [source] : [])])].sort()

  if (!activeProjectId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <EmptyState title="Select a project" description="Choose a project to view content quality issues." />
      </div>
    )
  }

  return (
    <div className={PAGE_CONTENT_STACK} data-testid="mushi-page-content">
      <PageHeaderBar
        title="Content checks"

        helpTitle="About Content checks"
        helpWhatIsIt="Content quality issues are surfaced by the score the source app sends, user flags, star ratings, and downvote ratios. The score is whatever the source sends: an AI judge grade or, for some sources, an up/down vote score. Each issue links to its Langfuse trace and full feedback history."
        helpUseCases={[
          'Find low-scoring generated content',
          'Trigger regeneration from the source project',
          'View user ratings and flags alongside the source score',
          'Clear noise in bulk: tick rows or filter, then dismiss with a reason',
        ]}
        helpHowToUse="Filter by status, reason, type, source or score, open an issue to see the full context, then click Regenerate & push to create an improved version — the source project judges the candidate and only promotes it if the score improves. To clear noise, tick rows or use Dismiss all matching; the dialog states the exact number of rows first."
      />

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

      <div role="toolbar" aria-label="Filter content issues" className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search content key on this page…"
          aria-label="Search content key"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-64"
        />
        <FilterSelect
          label="statuses"
          value={status === 'all' ? '' : status}
          options={STATUS_OPTIONS}
          optionLabel={v => v.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}
          onChange={e => changeFilter(() => setStatus(e.currentTarget.value || 'all'))}
        />
        <FilterSelect
          label="reasons"
          value={reason}
          options={REASON_OPTIONS}
          optionLabel={v => REASON_LABELS[v] ?? v}
          onChange={e => changeFilter(() => setReason(e.currentTarget.value))}
        />
        <FilterSelect
          label="types"
          value={contentType}
          options={typeOptions}
          optionLabel={v => v.replace(/_/g, ' ')}
          onChange={e => changeFilter(() => setContentType(e.currentTarget.value))}
        />
        <FilterSelect
          label="sources"
          value={source}
          options={sourceOptions}
          optionLabel={v => (v === NO_SOURCE ? 'No source' : v)}
          onChange={e => changeFilter(() => setSource(e.currentTarget.value))}
        />
        <FilterSelect
          label="scores"
          value={scoreBand}
          options={SCORE_BANDS.map(b => b.value)}
          optionLabel={v => SCORE_BANDS.find(b => b.value === v)?.label ?? v}
          onChange={e => changeFilter(() => setScoreBand(e.currentTarget.value))}
        />
      </div>

      <div>
        {error && <PageLoadError error={error} resource="content issues" />}
        {loading && <TableSkeleton rows={8} />}

        {!loading && items.length === 0 && (
          <EmptyState
            title={needle ? 'No matches on this page' : 'No content issues'}
            description={
              needle
                ? 'No content key on this page contains that text. Clear the search or change page.'
                : status === 'open'
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
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted" title={SCORE_HEADER_TIP}>
                      Score <span aria-hidden="true" className="text-fg-faint">ⓘ</span>
                    </th>
                    {showStatusColumn && (
                      <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Status</th>
                    )}
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Detected</th>
                    <th className="w-5 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-edge">
                  {groups.map(group => {
                    const GroupIcon = TYPE_ICON[group.type] ?? IconCatalog
                    return (
                    <Fragment key={`${group.type}|${group.lang ?? ''}`}>
                    <tr className="bg-surface-overlay/60">
                      <td colSpan={(canBulkDismiss ? 1 : 0) + (showStatusColumn ? 6 : 5)} className="px-3 py-1.5">
                        <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-fg-secondary">
                          <GroupIcon size={14} className="text-fg-muted" />
                          <span className="capitalize">{group.type.replace(/_/g, ' ')}</span>
                          {group.lang && <span className="font-mono uppercase text-fg-muted">{group.lang}</span>}
                          <span className="font-normal text-fg-muted">· {group.rows.length}</span>
                        </span>
                      </td>
                    </tr>
                  {group.rows.map(item => {
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
                        {/* Asset: human key; type and language are in the group row */}
                        <td className="px-3 py-3">
                          <div className="min-w-0">
                            <div className="font-medium text-fg-primary truncate max-w-48" title={item.content_key}>
                              {label}
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
                          {!showStatusColumn && item.regen_status && (
                            <SignalChip tone={REGEN_TONE[item.regen_status] ?? 'neutral'} className="ml-1.5">
                              regen: {item.regen_status}
                            </SignalChip>
                          )}
                        </td>

                        {/* Score: bar plus what the number is, or "not scored" */}
                        <td className="px-3 py-3 w-36">
                          {score != null
                            ? (
                              <div title={score.basis}>
                                <ConfidenceMeter confidence={score.value} />
                              </div>
                            )
                            : <span className="text-2xs text-fg-muted italic">not scored</span>
                          }
                        </td>

                        {/* Status: only when listing every status — a filtered
                            list would repeat the filter on every row. */}
                        {showStatusColumn && (
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
                        )}

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
                    </Fragment>
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
