/**
 * FILE: apps/admin/src/components/report-detail/ReportPdcaStory.tsx
 * PURPOSE: The report page's one Plan → Do → Check → Act progress display.
 *
 *          It walks the user through what happened to *their* bug, with
 *          per-stage timestamps, model identifiers, judge scores and the next
 *          step in a sentence.
 *
 *          Visual:
 *
 *            ●━━━━ Plan        Classified 2 min ago by Haiku → Sonnet
 *            ┃              "submit-button-broken" • severity: high
 *            ●━━━━ Do          Dispatched to claude-code · branch fix/123
 *            ┃              PR 482 opened
 *            ◐━━━━ Check       Judge agreed (94%) · CI running
 *            ┃              [thumbnail of screenshot diff if present]
 *            ○      Act         Awaiting merge
 *
 *          The page used to show this progress three times before the triage
 *          bar (a React Flow pipeline, a 4-up receipt strip and this story;
 *          REPORT D, 2026-10-04). This story is the one kept, in every mode:
 *          it says what happened and what to do next in plain sentences.
 *          "Classified" comes from `isReportClassified` so it can never
 *          disagree with the recommendation card or the classification card.
 */

import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import { CATEGORY_LABELS } from '../../lib/tokens'
import { STAMP_VISUAL, type StageStamp } from '../../lib/pdcaStamp'
import { ACT_BLOCKER_COPY, ACT_BLOCKER_LINK_LABEL, ACT_BLOCKER_STAMP, actBlocker } from '../../lib/pdcaAct'
import { Card, InfoHint, RelativeTime } from '../ui'
import { ActionPill, InlineProof } from './ReportSurface'
import type { DispatchState } from '../../lib/dispatchFix'
import { isReportClassified } from '../../lib/reportDiagnosis'
import { humanizeFixError } from '../../lib/humanizeFixError'
import { reportHasCodeLocation } from '../../lib/reportCodeLocation'
import type { ReportDetail, ReportFixAttempt } from './types'
import { isSampleModel, SAMPLE_EXPLANATION_LABEL } from '../../lib/reportInternals'
import { dispatchSetupSentence, type DispatchSetupSteps } from '../../lib/dispatchSetupSteps'
import { DispatchSetupLine } from './DispatchSetupLine'

type StoryState = StageStamp

interface StoryNode {
  id: PdcaStageId
  state: StoryState
  /** One-line headline summarising what happened at this stage. */
  headline: string
  /** Optional iso timestamp for "X ago" relative time. */
  at?: string | null
  /** Up to 3 chips with extra context (model name, branch, score). */
  details?: Array<string | null | undefined>
  /** Optional link out (PR, Langfuse trace, /fixes deep link). */
  link?: { href: string; label: string }
  /** Optional screenshot URL to render as a 56x40 thumbnail. */
  thumbnail?: string | null
  /** A step that waits on the dispatch setup: shown inline, each step a link. */
  setup?: DispatchSetupSteps
  /** The raw error behind a plain headline, shown only under "Technical details". */
  technical?: string | null
  /** The judge's grade of the triage: shown with the diagnosis it grades, never as a fix check. */
  grade?: { agreed: boolean; score: number | null; reason: string | null; at: string | null }
}

/** Raw errors are stack traces; the disclosure shows the start of one, not all of it. */
const TECHNICAL_MAX_CHARS = 1500

/** @internal Exported for unit tests only. */
export function capTechnical(raw: string | null | undefined): string | null {
  const t = raw?.trim()
  if (!t) return null
  return t.length > TECHNICAL_MAX_CHARS ? `${t.slice(0, TECHNICAL_MAX_CHARS)}…` : t
}

interface Props {
  report: ReportDetail
  dispatchState: DispatchState
  /** Operator accounts: show the model and its latency on the first step. */
  showInternals?: boolean
  /** The page's dispatch gate: with `setup`, "Fix written" says what to set up first. */
  dispatchBlock?: { blocked: boolean; setup?: DispatchSetupSteps | null }
}

/**
 * Plain step names (console audit 2026-11-11): "Plan / Do / Check / Act" is
 * Mushi Mushi's inside vocabulary; a builder reads what happened to the bug.
 */
const STEP_NAME: Partial<Record<PdcaStageId, string>> = {
  plan: 'Explained',
  do: 'Fix written',
  check: 'Fix checked',
  act: 'Fix live',
}

export function ReportPdcaStory({ report, dispatchState, showInternals = false, dispatchBlock }: Props) {
  const nodes = buildStoryNodes(report, dispatchState, showInternals, dispatchBlock?.blocked ? dispatchBlock.setup ?? null : null)
  return (
    // The heading sits outside the list: an <ol> may only hold <li>, and a
    // <header> inside it broke the list for screen readers (REPORT A14).
    <Card className="relative mb-3 p-3 motion-safe:animate-mushi-fade-in">
      {/* No "Explained → Fix written → …" chain beside the heading: the four
          rows are that chain (round-3 sweep 2026-11-19). */}
      <h3 className="mb-2 text-2xs font-semibold text-fg-secondary">The story so far</h3>
      <ol aria-label="Progress of this report">
        {PDCA_ORDER.map((id, idx) => {
          const node = nodes[id]
          const isLast = idx === PDCA_ORDER.length - 1
          return <StoryRow key={id} node={node} isLast={isLast} />
        })}
      </ol>
    </Card>
  )
}

function StoryRow({ node, isLast }: { node: StoryNode; isLast: boolean }) {
  const meta = PDCA_STAGES[node.id]
  const v = STAMP_VISUAL[node.state]
  const isDone = node.state === 'done'
  const isIdle = node.state === 'idle'
  const detailsClean = (node.details ?? []).filter((d): d is string => Boolean(d && d.trim()))
  return (
    <li className={`relative pl-7 pb-3 last:pb-0 ${isIdle ? 'opacity-75' : ''}`}>
      {/* Vertical connector line. Coloured green for completed stages so the
          loop visually "fills in" top-down as work lands — gives the whole
          timeline a progress-bar feel. Skipped on last row. */}
      {!isLast && (
        <span
          aria-hidden="true"
          // mushi-mushi-allowlist: intentional arbitrary layout (calc/fr/%/canvas)
          className={`absolute left-[10px] top-3.5 bottom-0 w-px ${
            isDone ? 'bg-ok/40' : 'bg-edge-subtle'
          }`}
        />
      )}
      {/* Stage dot — done gets a filled green disc with ✓, idle is a hollow
          dashed ring, pending pulses, failed is a filled red disc with ✕. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-3xs font-bold ${
          isDone
            ? 'bg-ok text-ok-fg mushi-glow-ok'
            : node.state === 'failed'
              ? 'bg-danger text-danger-fg mushi-glow-danger'
              : node.state === 'pending'
                ? `ring-2 ${v.ring} ${v.dot} mushi-pulse`
                : `ring-2 ring-dashed ${v.ring} bg-transparent`
        }`}
      >
        {isDone ? '✓' : node.state === 'failed' ? '✕' : ''}
      </span>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`inline-flex h-4 w-4 items-center justify-center rounded-sm font-semibold text-3xs ${meta.badgeBg} ${meta.badgeFg}`}
          aria-hidden="true"
        >
          {PDCA_ORDER.indexOf(node.id) + 1}
        </span>
        <span className={`text-xs font-semibold ${isIdle ? 'text-fg-muted' : 'text-fg'}`}>{STEP_NAME[node.id] ?? meta.label}</span>
        {/* The circle shows the state; "✓ Done" / "○ Not yet" beside it said
            it again (round-3 sweep 2026-11-19). Screen readers still hear it. */}
        <span className="sr-only">Status: {v.label}</span>
        {isIdle && !node.setup && <InfoHint content={node.headline} />}
        {node.at && (
          <span className="text-2xs text-fg-faint ml-auto">
            <RelativeTime value={node.at} />
          </span>
        )}
      </div>
      {/* A step that has not started says why behind its ⓘ, not in a grey sentence. */}
      {!isIdle && <InlineProof className="mt-0.5">{node.headline}</InlineProof>}
      {node.grade && <GradeLine grade={node.grade} />}
      {node.technical && (
        <details className="group mt-1" data-testid={`story-technical-${node.id}`}>
          <summary className="cursor-pointer list-none text-2xs text-fg-secondary hover:text-fg">
            <span className="inline-block motion-safe:transition-transform group-open:rotate-90" aria-hidden="true">▸</span> Technical details
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-edge-subtle bg-surface-overlay p-1.5 font-mono text-3xs whitespace-pre-wrap text-fg-secondary wrap-anywhere">
            {node.technical}
          </pre>
        </details>
      )}
      {/* Blocked on setup is not "not started yet": say what to do, in the open (feedback 2026-11-22). */}
      {node.setup && <DispatchSetupLine setup={node.setup} lead="No fix yet. To dispatch one:" className="mt-0.5" data-testid="story-dispatch-setup" />}
      {(detailsClean.length > 0 || node.thumbnail || node.link) && (
        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
          {node.thumbnail && (
            <a
              href={node.thumbnail}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-10 w-14 overflow-hidden rounded-sm border border-edge-subtle hover:border-brand/50 motion-safe:transition-opacity"
              title="Open screenshot in new tab"
            >
              <img
                src={node.thumbnail}
                alt="Screenshot proof"
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </a>
          )}
          {detailsClean.map((d, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-sm bg-surface-overlay/40 px-1.5 py-px text-3xs font-mono text-fg-muted"
            >
              {d}
            </span>
          ))}
          {node.link && (
            node.link.href.startsWith('http') ? (
              <ActionPill href={node.link.href} tone="brand">
                {node.link.label} ↗
              </ActionPill>
            ) : (
              <ActionPill to={node.link.href} tone="brand">
                {node.link.label} →
              </ActionPill>
            )
          )}
        </div>
      )}
    </li>
  )
}

/**
 * The judge grades the triage (category, severity, component, repro), not a
 * fix. It sat on "Fix checked" as "Failed" on report 3a5cb64c, where no fix
 * had a pull request to check (2026-11-22); it belongs with the diagnosis.
 */
function GradeLine({ grade }: { grade: NonNullable<StoryNode['grade']> }) {
  const pct = grade.score != null ? `${Math.round(grade.score * 100)}%` : null
  const verdict = grade.agreed ? 'the judge agreed with the triage' : 'the judge disagreed with the triage'
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-fg-muted" data-testid="story-diagnosis-grade">
      <span className="font-medium text-fg-secondary">Diagnosis grade:</span>
      <span className={grade.agreed ? 'text-fg-secondary' : 'text-warn-foreground'}>{[pct, verdict].filter(Boolean).join(', ')}</span>
      {grade.reason && <InfoHint content={grade.reason} />}
      {grade.at && (
        <span className="text-fg-faint">
          <RelativeTime value={grade.at} />
        </span>
      )}
    </p>
  )
}

/** @internal Exported for unit tests only. */
export function buildStoryNodes(
  report: ReportDetail,
  dispatchState: DispatchState,
  showInternals = false,
  /** The steps left before a fix can be dispatched, when that is what stops it. */
  setup: DispatchSetupSteps | null = null,
): Record<PdcaStageId, StoryNode> {
  const fix: ReportFixAttempt | undefined = report.fix_attempts?.[0]
  const judge = report.judge_eval ?? null
  const status = report.status?.toLowerCase() ?? ''
  const fixStatus = fix?.status?.toLowerCase() ?? ''
  const ciConclusion = fix?.check_run_conclusion?.toLowerCase() ?? null

  // PLAN — classification metadata
  const classified = isReportClassified(report)
  // A processing_error on a classified row is about something later (an
  // auto-fix block stamp, a heuristic fallback), not a failed classification.
  const classifyFailed = Boolean(report.processing_error) && !classified
  const planState: StoryState = classifyFailed
    ? 'failed'
    : classified
      ? 'done'
      : 'pending'
  const planHeadline = classifyFailed
    // The raw error lives once, screened, behind the Pipeline strip's Details (console 2026-11-19).
    ? 'Classification failed. The Pipeline strip below says why and has a Retry button.'
    : classified
      // The summary shows once, higher up (summaryPlace); the step says what was decided.
      ? `Sorted as ${(CATEGORY_LABELS[report.category] ?? report.category ?? 'a report').toLowerCase()}`
      : 'Report received — the LLM is classifying it now'
  const plan: StoryNode = {
    id: 'plan',
    state: planState,
    headline: planHeadline,
    at: report.classified_at ?? report.created_at,
    // Severity, confidence, model and latency live in the classification card
    // and the triage bar; repeating them here made "Medium" ×5 and "97%" ×4
    // (round-3 sweep 2026-11-19). Only the sample report is named here.
    details: [isSampleModel(report.stage1_model) ? SAMPLE_EXPLANATION_LABEL : null],
    ...(judge
      ? {
          grade: {
            agreed: judge.classification_agreed !== false,
            score: judge.judge_score ?? null,
            reason: judge.judge_reasoning?.trim() || null,
            at: judge.created_at ?? null,
          },
        }
      : {}),
  }

  // DO — dispatch metadata
  const liveStatus = dispatchState.status
  const inFlight =
    liveStatus === 'queueing' ||
    liveStatus === 'queued' ||
    liveStatus === 'running' ||
    fixStatus === 'in_progress' ||
    status === 'fixing'
  const dispatched = Boolean(fix) || liveStatus !== 'idle' || status === 'fixed'
  let doState: StoryState = 'idle'
  if (fix?.pr_url || (fix?.files_changed?.length ?? 0) > 0 || liveStatus === 'completed') {
    doState = 'done'
  } else if (fixStatus === 'failed' || liveStatus === 'failed') {
    doState = 'failed'
  } else if (inFlight || dispatched) {
    doState = 'pending'
  }
  const doHeadline = (() => {
    if (fix?.pr_url) {
      const fileCount = fix.files_changed?.length ?? 0
      return fileCount > 0
        ? `Fix dispatched — ${fileCount} file${fileCount === 1 ? '' : 's'} changed, draft PR opened`
        : 'Fix dispatched — draft PR opened'
    }
    if (liveStatus === 'completed' && dispatchState.prUrl) return 'Fix dispatched — PR opened just now'
    if (inFlight) return 'The fix agent is drafting the PR right now'
    if (fixStatus === 'failed') {
      // One plain line; the raw error (often a Node stack) only under "Technical details".
      const human = humanizeFixError(fix?.error, { category: fix?.failure_category ?? null })
      return human && human.known !== false ? human.title : 'The last fix attempt stopped without a pull request.'
    }
    if (dispatched) return 'Fix attempt recorded'
    if (!reportHasCodeLocation(report)) return 'No fix dispatched yet — no stack trace or file for an agent to change'
    return setup
      ? dispatchSetupSentence(setup, 'No fix yet. To dispatch one:')
      : 'No fix dispatched yet — click "Dispatch fix" to start'
  })()
  const doSetup = doState === 'idle' && setup && reportHasCodeLocation(report) ? setup : undefined
  const doLink = fix?.pr_url
    ? { href: fix.pr_url, label: `PR${fix.pr_number ? ` #${fix.pr_number}` : ''}` }
    : dispatchState.prUrl
      ? { href: dispatchState.prUrl, label: 'Review PR' }
      : doState !== 'idle'
        ? { href: '/fixes', label: 'Open fix pipeline' }
        : undefined
  const doNode: StoryNode = {
    id: 'do',
    state: doState,
    headline: doHeadline,
    at: fix?.completed_at ?? fix?.started_at ?? fix?.created_at ?? null,
    details: [
      fix?.agent ? `via ${fix.agent}` : null,
      fix?.branch || null,
      fix?.lines_changed != null ? `${fix.lines_changed} loc` : null,
    ],
    link: doLink,
    ...(doSetup ? { setup: doSetup } : {}),
    technical: doState === 'failed' ? capTechnical(fix?.error) : null,
  }

  // CHECK: CI on the fix's pull request. The judge grades the triage, so its
  // grade is on the plan step, never a fix check (report 3a5cb64c).
  let checkState: StoryState = 'idle'
  if (ciConclusion === 'success') checkState = 'done'
  else if (ciConclusion === 'failure' || ciConclusion === 'timed_out') checkState = 'failed'
  else if (fix?.pr_url) checkState = 'pending'
  const checkHeadline = (() => {
    if (ciConclusion) return `Fix CI: ${ciConclusion.replace(/_/g, ' ')}`
    if (fix?.pr_url) return 'CI is running on the PR'
    if (fixStatus === 'failed') return 'Nothing to check: the last attempt opened no pull request.'
    return showInternals
      ? 'No CI signal yet — runs once a fix opens a pull request'
      : 'Not checked yet. The checks run once a fix is dispatched.'
  })()
  const check: StoryNode = {
    id: 'check',
    state: checkState,
    headline: checkHeadline,
    // Its own time: when CI last reported on the fix, never the judge's.
    at: ciConclusion ? fix?.check_run_updated_at ?? null : null,
    details: [ciConclusion ? `CI ${ciConclusion.replace(/_/g, ' ')}` : null],
    thumbnail: report.screenshot_url ?? null,
  }

  // ACT — merge + close. A closed PR, red CI or an agent review flag blocks
  // the loop instead of "Awaiting merge" (see lib/pdcaAct.ts).
  const blocker = actBlocker(fix)
  // An attempt that stopped before a PR is the "Fix written" step's failure:
  // nothing reached "live" to be blocked (report 3a5cb64c, 2026-11-22).
  let actState: StoryState = 'idle'
  if (status === 'fixed') actState = 'done'
  else if (status === 'dismissed') actState = 'failed'
  else if (blocker) actState = ACT_BLOCKER_STAMP[blocker]
  else if (fix?.pr_url || ciConclusion === 'success') actState = 'pending'
  const actHeadline = (() => {
    if (status === 'fixed') return 'Loop closed — report marked fixed and routed back upstream'
    if (status === 'dismissed') return 'Loop closed — report dismissed (no fix needed)'
    if (blocker) return ACT_BLOCKER_COPY[blocker]
    if (actState === 'pending') return 'Awaiting merge: press Merge at the top of this page'
    if (fixStatus === 'failed' && !fix?.pr_url) return 'Not yet: no pull request was opened, so nothing can go live'
    return 'Not yet: the fix has to be written and checked first'
  })()
  const actLink = fix?.pr_url && actState !== 'done'
    ? { href: fix.pr_url, label: blocker ? ACT_BLOCKER_LINK_LABEL[blocker] : 'View PR on GitHub' }
    : status === 'fixed'
      ? { href: '/integrations/config', label: 'See routing' }
      : undefined
  const act: StoryNode = {
    id: 'act',
    state: actState,
    headline: actHeadline,
    // When it landed, not when the last (perhaps failed) attempt ended.
    at: status === 'fixed' ? fix?.merged_at ?? report.fixed_at ?? null : null,
    link: actLink,
  }

  return { plan, do: doNode, check, act }
}
