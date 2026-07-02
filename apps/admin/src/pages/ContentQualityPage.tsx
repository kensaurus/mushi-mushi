/**
 * ContentQualityPage — Content Quality Debug Station.
 *
 * Shows content assets that need review: low AI scores, user flags, poor ratings.
 * Each row is one fixable asset — click to open the detail and trigger regeneration.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePageData } from '../lib/usePageData'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import {
  EmptyState,
  ErrorAlert,
  Btn,
} from '../components/ui'
import { PageHeaderBar } from '../components/PageHeaderBar'
import { PagePosture, POSTURE_PRIORITY } from '../components/PagePosture'
import { ResponsiveTable } from '../components/ResponsiveTable'
import { TableSkeleton } from '../components/skeletons/TableSkeleton'
import { SignalChip, ConfidenceMeter } from '../components/report-detail/ReportSurface'
import { ContentQualityReadout } from '../components/content-quality/ContentQualityReadout'
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

const REASON_LABELS: Record<string, string> = {
  low_judge_score:     'Low AI score',
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
 * Quality confidence: prefers AI judge score, falls back to signal-appropriate metric.
 * For user_flag items: the flag count is the signal; show "not scored" if no AI score.
 * For high_downvote_ratio: use approval rate.
 */
function qualityScore(item: ContentQualityIssue): number | null {
  if (item.judge_score != null) return item.judge_score
  if (item.avg_star != null) return item.avg_star / 5
  if (item.reason === 'high_downvote_ratio' && item.downvote_ratio != null) {
    return 1 - item.downvote_ratio
  }
  return null
}

export function ContentQualityPage() {
  const navigate = useNavigate()
  const activeProjectId = useActiveProjectId()
  const [status, setStatus] = useState<string>('open')
  const [reason, setReason] = useState<string>('')
  const [page, setPage] = useState(0)
  const LIMIT = 50

  const params = new URLSearchParams({
    project_id: activeProjectId ?? '',
    status,
    limit: String(LIMIT),
    page: String(page),
    ...(reason ? { reason } : {}),
  })

  const apiPath = activeProjectId
    ? `/v1/admin/content-quality?${params}`
    : null

  const { data, loading, error } = usePageData<ListResponse>(apiPath)
  const statsPath = activeProjectId
    ? `/v1/admin/content-quality/stats?project_id=${activeProjectId}`
    : null
  const {
    data: statsData,
    lastFetchedAt: statsFetchedAt,
    isValidating: statsValidating,
  } = usePageData<ContentQualityStats>(statsPath, { deps: [activeProjectId] })
  const contentStats = statsData ?? EMPTY_CONTENT_QUALITY_STATS
  const items = data?.items ?? []
  const total = data?.total ?? 0

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
        helpWhatIsIt="Content quality issues are surfaced by AI judge scores, user flags, star ratings, and downvote ratios. Each issue links to its Langfuse trace and full feedback history."
        helpUseCases={[
          'Find low-scoring generated content',
          'Trigger regeneration from the source project',
          'View user ratings and flags alongside AI scores',
        ]}
        helpHowToUse="Filter by status or reason, open an issue to see the full context, then click Regenerate & push to create an improved version — the source project judges the candidate and only promotes it if the score improves."
      >
        <select
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(0) }}
        >
          <option value="open">Open</option>
          <option value="in_review">In review</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All statuses</option>
        </select>
        <select
          className="rounded border border-edge bg-surface px-2 py-1 text-xs"
          value={reason}
          onChange={e => { setReason(e.target.value); setPage(0) }}
        >
          <option value="">All reasons</option>
          <option value="low_judge_score">Low AI score</option>
          <option value="user_flag">User flagged</option>
          <option value="low_star_rating">Low stars</option>
          <option value="high_downvote_ratio">High downvotes</option>
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
        {error && <ErrorAlert message={error} />}
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

            <ResponsiveTable ariaLabel="Content quality issues">
              <table className="w-full text-xs">
                <thead className="bg-surface-overlay border-b border-edge">
                  <tr>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Asset</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Reason</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-fg-muted">Quality</th>
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
                        className="hover:bg-surface-overlay cursor-pointer transition-colors group"
                        onClick={() => navigate(`/content/${item.id}`)}
                      >
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
                              <div className="text-2xs text-fg-muted truncate max-w-[200px] mt-0.5" title={item.content_key}>
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

                        {/* Quality: score bar or "not scored" */}
                        <td className="px-3 py-3 w-36">
                          {score != null
                            ? <ConfidenceMeter confidence={score} />
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

                        {/* Chevron — real <button> so keyboard and screen-reader users can
                            activate the row without the table's row semantics being overridden
                            by role="button". focus-visible:opacity-100 makes it reappear for
                            sighted keyboard users; opacity-0 is purely cosmetic for mouse. */}
                        <td className="px-3 py-3">
                          <button
                            className="text-fg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current rounded-sm"
                            tabIndex={0}
                            aria-label={`Open ${label}`}
                            onClick={e => { e.stopPropagation(); navigate(`/content/${item.id}`) }}
                          >
                            →
                          </button>
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
              <Btn size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                Previous
              </Btn>
              <Btn size="sm" variant="ghost" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)}>
                Next
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
