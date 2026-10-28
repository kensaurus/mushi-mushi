/**
 * FILE: apps/admin/src/components/dashboard/ProjectNarrativeStrip.tsx
 * PURPOSE: Onboarding hero strip that explains \u2014 in the user's own project
 *          name \u2014 how Mushi Mushi will plug into their PDCA loop. Solves the
 *          audit finding that `/onboarding` opened with five identical wizard
 *          cards and zero connection to the actual app being instrumented.
 *
 *          Live status feeds (sdkInstalled, hasReports, hasFix, hasMerged)
 *          drive a "you are here" indicator across the four PDCA stages so
 *          first-run users see the loop AND their progress through it on the
 *          same screen.
 */

import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'
import { ActionPill, ContainedBlock, InlineProof } from '../report-detail/ReportSurface'

interface Props {
  projectName: string
  /** Live evidence for each stage \u2014 derived from setup status + DB counts. */
  sdkInstalled: boolean
  hasReports: boolean
  hasFix: boolean
  hasMerged: boolean
}

interface StageNarrative {
  id: PdcaStageId
  headline: string
  body: string
  /** State drives the visual treatment + which stage is "you are here". */
  state: 'done' | 'active' | 'next'
  cta?: { to: string; label: string }
}

export function ProjectNarrativeStrip({ projectName, sdkInstalled, hasReports, hasFix, hasMerged }: Props) {
  const stages = buildNarrative({ sdkInstalled, hasReports, hasFix, hasMerged })
  const activeIndex = stages.findIndex(s => s.state === 'active')
  const allDone = stages.every(s => s.state === 'done')
  return (
    <section
      aria-label="How a bug gets fixed"
      // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
      className="relative overflow-hidden rounded-lg border border-edge-subtle bg-surface-raised/40 p-4"
    >
      <span aria-hidden="true" className="absolute -top-10 -left-10 h-32 w-32 rounded-full bg-brand/20 blur-3xl opacity-40" />
      <div className="relative">
        <InlineProof className="font-medium uppercase tracking-wider text-fg-muted border-0 bg-transparent px-0 py-0">
          How a bug gets fixed on <span className="font-mono text-fg-secondary normal-case tracking-normal">{projectName}</span>
        </InlineProof>
        <h2 className="mt-1 text-base font-semibold text-fg leading-tight">
          {allDone
            ? `${projectName} has fixed a bug end to end: a user reported it, Mushi explained it, an agent wrote the fix and it merged.`
            : 'Watch a real user-felt bug travel from your app to a merged pull request, in four stages.'}
        </h2>

        <ol className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {stages.map((stage, i) => (
            <NarrativeStage
              key={stage.id}
              step={i + 1}
              stage={stage}
              isCurrent={i === activeIndex}
              connector={i < stages.length - 1}
            />
          ))}
        </ol>
      </div>
    </section>
  )
}

interface NarrativeStageProps {
  step: number
  stage: StageNarrative
  isCurrent: boolean
  connector: boolean
}

function NarrativeStage({ step, stage, isCurrent, connector }: NarrativeStageProps) {
  const meta = PDCA_STAGES[stage.id]
  const tone = stage.state === 'done'
    ? `border-ok/40 bg-ok-muted/15`
    : isCurrent
      ? `${meta.tintBorder} ${meta.tintBg} ring-2 ring-offset-1 ring-offset-surface ${meta.ring}`
      : 'border-edge-subtle bg-surface-raised/30 opacity-75'
  const badge = stage.state === 'done'
    ? 'bg-ok text-ok-fg'
    : isCurrent
      ? `${meta.badgeBg} ${meta.badgeFg}`
      : 'bg-surface-overlay text-fg-muted'
  return (
    <li className={`relative rounded-md border p-3 ${tone}`}>
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold leading-none ${badge}`}
        >
          {stage.state === 'done' ? '✓' : step}
        </span>
        <div className="min-w-0">
          <span className="block text-3xs uppercase tracking-wider text-fg-muted">Step {step}</span>
          <span className="block text-xs font-semibold text-fg leading-tight truncate">{stage.headline}</span>
        </div>
      </header>
      <ContainedBlock tone="muted" className="mt-2 min-h-12">
        <p className="text-2xs text-fg-secondary leading-snug">{stage.body}</p>
      </ContainedBlock>
      {stage.cta && (
        <ActionPill to={stage.cta.to} tone="brand" className="mt-2">
          {stage.cta.label} →
        </ActionPill>
      )}
      {isCurrent && stage.state !== 'done' && (
        <span className={`absolute -top-2 right-2 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wider ${meta.text} ${meta.tintBg} border ${meta.tintBorder}`}>
          You are here
        </span>
      )}
      {connector && (
        <span aria-hidden="true" className="hidden lg:flex absolute top-1/2 -right-1.5 -translate-y-1/2 h-4 w-4 items-center justify-center text-fg-faint">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h7m0 0L7 4m3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </li>
  )
}

interface BuildArgs {
  sdkInstalled: boolean
  hasReports: boolean
  hasFix: boolean
  hasMerged: boolean
}

function buildNarrative({ sdkInstalled, hasReports, hasFix, hasMerged }: BuildArgs): StageNarrative[] {
  return PDCA_ORDER.map<StageNarrative>(id => {
    if (id === 'plan') {
      return {
        id,
        headline: 'Capture user-felt bugs',
        body: sdkInstalled
          ? 'The SDK is in your app. When a user reports a bug, it sends a screenshot, the console and the network calls with it.'
          : 'Drop the Mushi Mushi widget into your app so end-users can flag bugs without leaving the page.',
        state: hasReports ? 'done' : 'active',
        cta: hasReports
          ? { to: '/reports', label: 'See your reports' }
          : sdkInstalled ? undefined : { to: '/onboarding#sdk', label: 'Install the SDK' },
      }
    }
    if (id === 'do') {
      return {
        id,
        headline: 'Get a fix',
        body: hasReports
          ? 'Mushi explains each report in plain English. One click starts a coding agent that opens a draft pull request with the fix.'
          : 'After your first report lands, one click starts a coding agent that opens a draft pull request with the fix.',
        state: hasFix ? 'done' : hasReports ? 'active' : 'next',
        cta: hasFix ? { to: '/fixes', label: 'Open Fixes' } : undefined,
      }
    }
    if (id === 'check') {
      return {
        id,
        headline: 'Check the fix',
        body: hasFix
          ? 'A second AI grades every diagnosis and fix, so you know whether to trust it before you merge.'
          : 'Once a fix exists, a second AI grades it, and you see its verdict before you merge.',
        state: hasMerged ? 'done' : hasFix ? 'active' : 'next',
        cta: hasMerged ? { to: '/judge', label: 'Open Triage grading' } : undefined,
      }
    }
    return {
      id,
      headline: hasMerged ? 'Fix merged' : 'Ship it',
      body: hasMerged
        ? 'The fix is merged and the report is closed. Connect Slack to hear about every fix that lands.'
        : 'When a checked fix merges, Mushi closes the report and tells the person who filed it. Connect Slack or GitHub to share it with your team.',
      state: hasMerged ? 'done' : hasFix ? 'active' : 'next',
      cta: hasMerged ? { to: '/integrations/config', label: 'Add notifications' } : undefined,
    }
  })
}
