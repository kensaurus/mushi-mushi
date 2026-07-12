/**
 * FILE: apps/admin/src/components/report-detail/BeforeAfterCard.tsx
 * PURPOSE: Side-by-side "Before → After" panel for a report that has a fix
 * attempt. Answers the question triagers and reporters keep asking — "what
 * did the app look like when this was filed, and what actually changed?" —
 * on one surface instead of scattering it across screenshot hero, fix panel,
 * judge card, and CI cell.
 *
 * BEFORE = capture-time evidence (screenshot, severity/category, error count,
 * reported time). AFTER = the fix outcome (PR state + link, files/lines
 * changed, CI conclusion, judge verdict, close time). No new data — this
 * composes fields already on `ReportDetail`.
 */

import { RelativeTime } from '../ui'
import { ActionPill, InlineProof } from './ReportSurface'
import type { ReportDetail, ReportFixAttempt } from './types'

interface Props {
  report: ReportDetail
  className?: string
}

const PR_STATE_TONE: Record<string, string> = {
  merged: 'bg-ok/15 text-ok',
  open: 'bg-brand/15 text-brand',
  draft: 'bg-surface-overlay/60 text-fg-muted',
  closed: 'bg-danger/15 text-danger',
}

function Chip({ tone, children }: { tone?: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-3xs font-mono ${
        tone ?? 'border border-edge-subtle bg-surface-overlay/40 text-fg-muted'
      }`}
    >
      {children}
    </span>
  )
}

export function BeforeAfterCard({ report, className = '' }: Props) {
  const fix: ReportFixAttempt | undefined = report.fix_attempts?.[0]
  // Only render once there is an "after" to show — a PR, a finished attempt,
  // or a closed loop. A report that is still just classified has no after side.
  const status = report.status?.toLowerCase() ?? ''
  const hasAfter = Boolean(fix?.pr_url) || status === 'fixed' || status === 'verified'
  if (!fix || !hasAfter) return null

  const errorCount = (report.console_logs ?? []).filter((l) => l.level === 'error').length
  const ci = fix.check_run_conclusion?.toLowerCase() ?? null
  const judge = report.judge_eval ?? null
  const prState = fix.pr_state ?? (status === 'fixed' ? 'merged' : 'open')
  const closedAt = fix.completed_at ?? fix.check_run_updated_at ?? null

  return (
    <section
      aria-label="Before and after this fix"
      className={`mb-3 rounded-lg border border-edge-subtle bg-surface-raised/30 p-3 motion-safe:animate-mushi-fade-in ${className}`}
    >
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-2xs font-semibold text-fg-muted uppercase tracking-wider">
          Before → After
        </h3>
        <span className="text-3xs text-fg-faint">as reported vs. after the fix</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* BEFORE — capture-time evidence */}
        <div className="rounded-md border border-edge-subtle/70 p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xs font-semibold text-danger">Before</span>
            <span className="text-3xs text-fg-faint">
              reported <RelativeTime value={report.created_at} />
            </span>
          </div>
          {report.screenshot_url && (
            <a
              href={report.screenshot_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2 block max-h-36 overflow-hidden rounded-sm border border-edge-subtle hover:border-brand/50 motion-safe:transition-colors"
              title="Open capture-time screenshot"
            >
              <img
                src={report.screenshot_url}
                alt="Screenshot captured when the bug was reported"
                loading="lazy"
                className="w-full object-cover object-top"
              />
            </a>
          )}
          <InlineProof>{report.summary || report.description}</InlineProof>
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {report.severity && <Chip>severity: {report.severity}</Chip>}
            <Chip>{report.category}</Chip>
            {errorCount > 0 && (
              <Chip tone="bg-danger/15 text-danger">
                {errorCount} console error{errorCount === 1 ? '' : 's'}
              </Chip>
            )}
          </div>
        </div>

        {/* AFTER — the fix outcome */}
        <div className="rounded-md border border-edge-subtle/70 p-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-2xs font-semibold text-ok">After</span>
            {closedAt && (
              <span className="text-3xs text-fg-faint">
                <RelativeTime value={closedAt} />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Chip tone={PR_STATE_TONE[prState] ?? undefined}>PR {prState}</Chip>
            {ci && (
              <Chip tone={ci === 'success' ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}>
                CI {ci.replace(/_/g, ' ')}
              </Chip>
            )}
            {judge?.judge_score != null && (
              <Chip
                tone={
                  judge.classification_agreed === false
                    ? 'bg-danger/15 text-danger'
                    : 'bg-ok/15 text-ok'
                }
              >
                judge {(judge.judge_score * 100).toFixed(0)}%
              </Chip>
            )}
          </div>
          <div className="mt-1.5">
            <InlineProof>
              {fix.files_changed?.length
                ? `${fix.files_changed.length} file${fix.files_changed.length === 1 ? '' : 's'} changed${
                    fix.lines_changed != null ? `, ${fix.lines_changed} lines` : ''
                  }${fix.agent ? ` — via ${fix.agent}` : ''}`
                : fix.agent
                  ? `Fix drafted via ${fix.agent}`
                  : 'Fix attempt recorded'}
            </InlineProof>
          </div>
          {judge?.judge_reasoning?.trim() && (
            <p className="mt-1 text-3xs text-fg-muted line-clamp-3">{judge.judge_reasoning.trim()}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {fix.pr_url && (
              <ActionPill href={fix.pr_url} tone="brand">
                {fix.pr_number ? `PR #${fix.pr_number}` : 'Review PR'} ↗
              </ActionPill>
            )}
            {fix.branch && <Chip>{fix.branch}</Chip>}
          </div>
        </div>
      </div>
    </section>
  )
}
