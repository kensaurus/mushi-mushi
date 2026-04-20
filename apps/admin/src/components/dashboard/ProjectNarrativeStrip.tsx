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

import { Link } from 'react-router-dom'
import { PDCA_ORDER, PDCA_STAGES, type PdcaStageId } from '../../lib/pdca'

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
      aria-label="Project PDCA narrative"
      className="relative overflow-hidden rounded-lg border border-edge-subtle bg-surface-raised/40 p-4"
    >
      <span aria-hidden="true" className="absolute -top-10 -left-10 h-32 w-32 rounded-full bg-brand/20 blur-3xl opacity-40" />
      <div className="relative">
        <p className="text-2xs font-medium uppercase tracking-wider text-fg-muted">
          Your loop on <span className="font-mono text-fg-secondary normal-case tracking-normal">{projectName}</span>
        </p>
        <h2 className="mt-1 text-base font-semibold text-fg leading-tight">
          {allDone
            ? `${projectName} has shipped its first auto-fix end to end. New reports flow through Plan → Do → Check → Act automatically.`
            : 'Watch a real user-felt bug travel from your app to a merged pull request, in four stages.'}
        </h2>

        <ol className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {stages.map((stage, i) => (
            <NarrativeStage
              key={stage.id}
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
  stage: StageNarrative
  isCurrent: boolean
  connector: boolean
}

function NarrativeStage({ stage, isCurrent, connector }: NarrativeStageProps) {
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
          {stage.state === 'done' ? '✓' : meta.letter}
        </span>
        <div className="min-w-0">
          <span className="block text-3xs uppercase tracking-wider text-fg-muted">{meta.label}</span>
          <span className="block text-xs font-semibold text-fg leading-tight truncate">{stage.headline}</span>
        </div>
      </header>
      <p className="mt-2 text-2xs text-fg-secondary leading-snug min-h-[3rem]">{stage.body}</p>
      {stage.cta && (
        <Link
          to={stage.cta.to}
          className="mt-2 inline-flex items-center gap-1 text-2xs text-brand hover:underline"
        >
          {stage.cta.label}
          <span aria-hidden="true">→</span>
        </Link>
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
          ? 'SDK is wired in. The widget catches console + network + a screenshot the moment a user files a report.'
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
        headline: 'Dispatch a fix',
        body: hasReports
          ? 'Mushi triages with Stage 1 (Haiku) → Stage 2 (Sonnet + vision). One click dispatches the auto-fix agent to open a draft PR on a feature branch.'
          : 'After your first report lands, you can dispatch the agent to draft a PR on a feature branch.',
        state: hasFix ? 'done' : hasReports ? 'active' : 'next',
        cta: hasFix ? { to: '/fixes', label: 'Open Fixes' } : undefined,
      }
    }
    if (id === 'check') {
      return {
        id,
        headline: 'Verify quality',
        body: hasFix
          ? 'A judge model independently grades every classification + fix. Langfuse traces every LLM call so you can audit cost, latency, and prompts.'
          : 'Once a fix exists, an independent judge LLM grades it. You can see the trace + verdict before merging.',
        state: hasMerged ? 'done' : hasFix ? 'active' : 'next',
        cta: hasMerged ? { to: '/judge', label: 'Open Judge' } : undefined,
      }
    }
    return {
      id,
      headline: hasMerged ? 'Loop closed' : 'Standardise the win',
      body: hasMerged
        ? 'Your fix is merged upstream. New reports for the same component now resolve automatically. Connect Slack to get a heads-up on every loop.'
        : 'After a verified fix is merged, Mushi closes the loop \u2014 the same class of bug stops surfacing. Connect Slack/GitHub to push wins back into your team.',
      state: hasMerged ? 'done' : hasFix ? 'active' : 'next',
      cta: hasMerged ? { to: '/integrations', label: 'Add notifications' } : undefined,
    }
  })
}
