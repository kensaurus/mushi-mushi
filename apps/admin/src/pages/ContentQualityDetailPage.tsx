/**
 * ContentQualityDetailPage — Rich detail view for a single content quality issue.
 *
 * Shows: what the asset is, why it was flagged, its quality signals, Langfuse trace,
 * user feedback, and actions (Regenerate, Dismiss, Resolve).
 */

import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/supabase'
import { usePageData } from '../lib/usePageData'
import { useToast } from '../lib/toast'
import { langfuseTraceUrl } from '../lib/env'
import { PageHeaderBar } from '../components/PageHeaderBar'
import {
  Btn,
  ErrorAlert,
} from '../components/ui'
import { DetailSkeleton } from '../components/skeletons/DetailSkeleton'
import {
  ContainedBlock,
  SignalChip,
  InlineProof,
  ActionPill,
  ActionPillRow,
} from '../components/report-detail/ReportSurface'

interface FeedbackSummary {
  avg_star: number | null
  total_ratings: number
  upvotes: number
  downvotes: number
  flag_count: number
  flagged_for_review: boolean
  judge_score: number | null
  ai_feedback: { positive: number; negative: number; neutral: number }
  top_comments: Array<{ id: string; body: string; vote_score: number; created_at: string }>
}

interface ContentQualityIssue {
  id: string
  project_id: string
  content_ref: string
  content_type: string
  content_key: string
  reason: string
  judge_score: number | null
  avg_star: number | null
  downvote_ratio: number | null
  flag_count: number
  langfuse_trace_id: string | null
  source_deeplink: string | null
  feedback_summary: FeedbackSummary | null
  source: string | null
  source_description: string | null
  status: string
  regen_status: string | null
  regen_requested_at: string | null
  regen_completed_at: string | null
  regen_result: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

const LANG_NAMES: Record<string, string> = {
  vi: 'Vietnamese', zh: 'Chinese', ja: 'Japanese',
  de: 'German', fr: 'French', es: 'Spanish',
  ko: 'Korean', th: 'Thai', en: 'English',
  ru: 'Russian', ar: 'Arabic', hi: 'Hindi',
  pt: 'Portuguese', it: 'Italian', nl: 'Dutch',
  tr: 'Turkish', pl: 'Polish', sv: 'Swedish',
}

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'neutral' | 'info' | 'danger'> = {
  open: 'warn', in_review: 'info', resolved: 'ok', dismissed: 'neutral',
}

const REGEN_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  queued: 'info', running: 'info', completed: 'ok', failed: 'danger',
}

function extractLang(key: string): string | null {
  const match = key.match(/:([a-z]{2})$/)
  return match ? match[1] : null
}

function humanTitle(issue: ContentQualityIssue): string {
  const type = issue.content_type.replace(/_/g, ' ')
  const lang = extractLang(issue.content_key)
  if (lang && LANG_NAMES[lang]) {
    return `${type} (${LANG_NAMES[lang]})`
  }
  if (issue.content_key && !issue.content_key.match(/^[0-9a-f]{60,}/)) {
    // Human-readable key like "reduplication-patterns"
    return `${type} · ${issue.content_key}`
  }
  return type
}

function ScoreBar({ score, label }: { score: number | null; label: string }) {
  if (score == null) return null
  const pct = Math.round(score * 100)
  const tone = pct >= 70 ? 'ok' : pct >= 50 ? 'warn' : 'danger'
  const bgColors = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' }
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-xs text-fg-muted shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface-overlay overflow-hidden">
        <div className={`h-full rounded-full ${bgColors[tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs tabular-nums font-mono">{pct}%</span>
    </div>
  )
}

/** Score improvement card shown after a completed regen. */
function RegenImprovedCard({ result }: { result: Record<string, unknown> }) {
  const oldScore = typeof result.old_score === 'number' ? result.old_score : null
  const newScore = typeof result.new_score === 'number' ? result.new_score : null
  const action = typeof result.action === 'string' ? result.action : null
  const promoted = action === 'promoted'

  if (oldScore == null || newScore == null) {
    // Fallback: show raw JSON
    return (
      <pre className="text-xs whitespace-pre-wrap overflow-auto max-h-48 text-fg-muted">
        {JSON.stringify(result, null, 2)}
      </pre>
    )
  }

  const delta = Math.round((newScore - oldScore) * 100)
  const oldPct = Math.round(oldScore * 100)
  const newPct = Math.round(newScore * 100)
  const improved = delta > 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {/* Old score */}
        <div className="text-center">
          <div className="text-2xl font-bold tabular-nums text-fg-muted">{oldPct}%</div>
          <div className="text-2xs text-fg-muted mt-0.5">before</div>
        </div>

        {/* Arrow + delta */}
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-lg" aria-hidden="true">→</span>
          <span className={`text-xs font-semibold tabular-nums ${improved ? 'text-ok' : 'text-danger'}`}>
            {improved ? '+' : ''}{delta}%
          </span>
        </div>

        {/* New score */}
        <div className="text-center">
          <div className={`text-2xl font-bold tabular-nums ${improved ? 'text-ok' : 'text-fg-primary'}`}>
            {newPct}%
          </div>
          <div className="text-2xs text-fg-muted mt-0.5">after</div>
        </div>

        {/* Verdict */}
        <div className="ml-2">
          {promoted
            ? <SignalChip tone="ok">✓ promoted live</SignalChip>
            : <SignalChip tone="neutral">not promoted (no improvement)</SignalChip>
          }
        </div>
      </div>

      {/* Visual bars */}
      <div className="space-y-1.5">
        <ScoreBar score={oldScore} label="Before" />
        <ScoreBar score={newScore} label="After" />
      </div>
    </div>
  )
}

/** Renders source description markdown as readable paragraphs (no external library needed). */
function SourceDescription({ text }: { text: string }) {
  // Parse simple bold (**text**) and newlines
  const lines = text.split('\n').filter(Boolean)
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const parts = line.split(/\*\*([^*]+)\*\*/g)
        return (
          <p key={i} className="text-xs text-fg-muted">
            {parts.map((part, j) =>
              j % 2 === 1
                ? <strong key={j} className="text-fg-secondary font-medium">{part}</strong>
                : part
            )}
          </p>
        )
      })}
    </div>
  )
}

export function ContentQualityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const [regenerating, setRegenerating] = useState(false)

  const { data: issue, loading, error, reload } = usePageData<ContentQualityIssue>(
    id ? `/v1/admin/content-quality/${id}` : null,
  )

  async function handleRegenerate() {
    if (!id) return
    setRegenerating(true)
    try {
      const res = await apiFetch(`/v1/admin/content-quality/${id}/regen`, { method: 'POST' })
      if (!res.ok) {
        toast.error(res.error?.message ?? 'Failed to trigger regeneration')
        return
      }
      toast.success('Regeneration queued — the source project will generate a candidate and promote it if the score improves.')
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger regeneration')
    } finally {
      setRegenerating(false)
    }
  }

  async function handleResolve(newStatus: 'resolved' | 'dismissed') {
    if (!id) return
    try {
      const res = await apiFetch(`/v1/admin/content-quality/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        toast.error(res.error?.message ?? 'Failed to update')
        return
      }
      toast.success(`Issue ${newStatus}`)
      reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update')
    }
  }

  if (loading) return <DetailSkeleton />
  if (error || !issue) return (
    <div className="p-8">
      <ErrorAlert title="Issue not found" message={error ?? 'The content quality issue could not be loaded.'} />
    </div>
  )

  const fb = issue.feedback_summary
  const traceUrl = langfuseTraceUrl(issue.langfuse_trace_id)
  const canRegen = issue.status !== 'resolved'
    && issue.status !== 'dismissed'
    && issue.regen_status !== 'running'
    && issue.regen_status !== 'queued'

  const title = humanTitle(issue)
  const regenRunDuration = issue.regen_requested_at && issue.regen_completed_at
    ? Math.round((new Date(issue.regen_completed_at).getTime() - new Date(issue.regen_requested_at).getTime()) / 1000)
    : null

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-edge">
        <Link to="/content" className="text-xs text-fg-muted hover:text-fg-secondary mb-3 inline-flex items-center gap-1">
          <span aria-hidden="true">←</span> Content Quality
        </Link>

        <PageHeaderBar
          title={title}

          helpTitle="About content quality issues"
          helpWhatIsIt="Rich detail for a flagged learning asset — quality signals, Langfuse trace, user feedback, and regenerate or resolve actions."
          helpUseCases={[
            'Review why an asset was flagged (low judge score, user flags, downvotes)',
            'Trigger regeneration when the source project can improve the asset',
            'Resolve or dismiss after manual review',
          ]}
          helpHowToUse="Inspect signals and feedback, open the Langfuse trace if needed, then Regenerate, Resolve, or Dismiss."
          showCopyLink={false}
        >
          <div className="flex items-center gap-2 shrink-0">
            {canRegen && (
              <Btn
                variant="primary"
                size="sm"
                loading={regenerating}
                onClick={handleRegenerate}
                title="Ask the source project to regenerate this asset. A candidate is generated and only promoted if the quality score improves."
              >
                Regenerate &amp; push
              </Btn>
            )}
            {issue.status === 'open' && (
              <Btn variant="ghost" size="sm" onClick={() => handleResolve('resolved')}
                title="Mark as manually resolved — the content was fixed or is acceptable.">
                Resolve
              </Btn>
            )}
            {issue.status === 'open' && (
              <Btn variant="ghost" size="sm" onClick={() => handleResolve('dismissed')}
                title="Dismiss — this issue doesn't need action.">
                Dismiss
              </Btn>
            )}
          </div>
        </PageHeaderBar>

        {/* Status strip */}
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <SignalChip tone={STATUS_TONE[issue.status] ?? 'neutral'}>
            {issue.status.replace(/_/g, ' ')}
          </SignalChip>
          {issue.regen_status && (
            <SignalChip tone={REGEN_TONE[issue.regen_status] ?? 'neutral'}>
              regen: {issue.regen_status}
            </SignalChip>
          )}
          {issue.source && <InlineProof>{issue.source}</InlineProof>}
          <InlineProof>flagged {new Date(issue.created_at).toLocaleDateString()}</InlineProof>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4 max-w-4xl w-full">

        {/* Quality signals — the most important section */}
        <ContainedBlock label="Quality Signals">
          {issue.judge_score == null
            && fb?.avg_star == null
            && (issue.downvote_ratio == null || (issue.reason !== 'high_downvote_ratio' && issue.downvote_ratio === 0)) ? (
            <div className="space-y-1">
              <p className="text-xs text-fg-muted italic">
                No AI quality score yet — this asset was flagged directly by users.
              </p>
              {issue.flag_count > 0 && (
                <p className="text-xs text-fg-muted">
                  {issue.flag_count} user flag{issue.flag_count !== 1 ? 's' : ''} recorded.
                  Use Regenerate &amp; push to have the source project re-score and potentially improve this asset.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <ScoreBar score={issue.judge_score} label="AI judge" />
              {fb?.avg_star != null && (
                <ScoreBar score={fb.avg_star / 5} label="User stars" />
              )}
              {/* Only show approval bar for high_downvote_ratio reason, or when downvotes are actually non-zero */}
              {issue.downvote_ratio != null && (issue.reason === 'high_downvote_ratio' || issue.downvote_ratio > 0) && (
                <ScoreBar score={1 - issue.downvote_ratio} label="Approval" />
              )}
              {fb && (
                <div className="flex flex-wrap gap-3 pt-1 text-xs text-fg-muted border-t border-edge mt-1">
                  {fb.total_ratings > 0 && <span>{fb.total_ratings} rating{fb.total_ratings !== 1 ? 's' : ''}</span>}
                  {(fb.upvotes > 0 || fb.downvotes > 0) && <span>{fb.upvotes} ↑ · {fb.downvotes} ↓</span>}
                  {fb.flag_count > 0 && <span>{fb.flag_count} flag{fb.flag_count !== 1 ? 's' : ''}</span>}
                  {(fb.ai_feedback.positive + fb.ai_feedback.negative) > 0 && (
                    <span>{fb.ai_feedback.positive} 👍 · {fb.ai_feedback.negative} 👎 AI feedback</span>
                  )}
                </div>
              )}
            </div>
          )}
        </ContainedBlock>

        {/* Regen result — show immediately after quality signals if available */}
        {issue.regen_result && (
          <ContainedBlock
            label={`Regeneration result${regenRunDuration != null ? ` · completed in ${regenRunDuration}s` : ''}`}
            tone={issue.regen_status === 'completed' ? 'ok' : 'warn'}
          >
            <RegenImprovedCard result={issue.regen_result} />
          </ContainedBlock>
        )}

        {/* Regen running/queued state */}
        {(issue.regen_status === 'running' || issue.regen_status === 'queued') && !issue.regen_result && (
          <ContainedBlock label="Regeneration in progress" tone="info">
            <p className="text-xs text-fg-muted">
              A new version is being generated by the source project. This page will update when it completes.
              Refresh in a few seconds.
            </p>
          </ContainedBlock>
        )}

        {/* What to do next — shown for open issues with no regen yet */}
        {issue.status === 'open' && !issue.regen_result && issue.regen_status == null && (
          <ContainedBlock label="Next step" tone="info">
            <p className="text-xs text-fg-muted leading-relaxed">
              Click <strong className="text-fg-secondary">Regenerate &amp; push</strong> to ask the source project to create
              an improved version of this asset. The source project will judge the candidate against the original
              and only promote it to users if the quality score improves.
            </p>
          </ContainedBlock>
        )}

        {/* User comments */}
        {fb && fb.top_comments.length > 0 && (
          <ContainedBlock label={`User comments (${fb.top_comments.length})`}>
            <div className="space-y-2.5">
              {fb.top_comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  <span className="text-fg-muted text-xs shrink-0 mt-0.5">
                    {c.vote_score > 0 ? `+${c.vote_score}` : c.vote_score}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs">{c.body}</p>
                    <p className="text-2xs text-fg-muted mt-0.5">{new Date(c.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </ContainedBlock>
        )}

        {/* Langfuse trace */}
        {traceUrl && (
          <ContainedBlock label="Langfuse trace" tone="info">
            <ActionPillRow>
              <ActionPill href={traceUrl}>Open in Langfuse →</ActionPill>
            </ActionPillRow>
            <p className="mt-1.5 text-2xs text-fg-muted font-mono">{issue.langfuse_trace_id}</p>
          </ContainedBlock>
        )}

        {/* Source description */}
        {issue.source_description && (
          <ContainedBlock label="Details from source" tone="muted">
            <SourceDescription text={issue.source_description} />
          </ContainedBlock>
        )}

        {/* Asset identity — technical details collapsed at the bottom */}
        <details className="group">
          <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg-secondary list-none flex items-center gap-1 select-none">
            <span className="group-open:hidden">▶</span>
            <span className="hidden group-open:inline">▼</span>
            Technical identifiers
          </summary>
          <div className="mt-2 rounded-md border border-edge bg-surface-overlay px-3 py-2 space-y-1.5">
            <div className="flex gap-2 items-center">
              <InlineProof>type</InlineProof>
              <span className="text-xs font-mono">{issue.content_type}</span>
            </div>
            <div className="flex gap-2 items-start">
              <InlineProof>key</InlineProof>
              <span className="text-xs font-mono break-all text-fg-muted">{issue.content_key || '(none)'}</span>
            </div>
            <div className="flex gap-2 items-center">
              <InlineProof>ref</InlineProof>
              <span className="text-xs font-mono text-fg-muted">{issue.content_ref}</span>
            </div>
            {(issue.regen_requested_at || issue.regen_completed_at) && (
              <div className="flex gap-4 pt-1 border-t border-edge mt-1">
                {issue.regen_requested_at && (
                  <span className="text-2xs text-fg-muted">Requested: {new Date(issue.regen_requested_at).toLocaleString()}</span>
                )}
                {issue.regen_completed_at && (
                  <span className="text-2xs text-fg-muted">Completed: {new Date(issue.regen_completed_at).toLocaleString()}</span>
                )}
              </div>
            )}
          </div>
        </details>
      </div>
    </div>
  )
}
