/**
 * Five-lane activation cockpit — SDK, Repo/CI, Observability, Agent access, Community.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card, Badge } from '../ui'
import { CHIP_TONE } from '../../lib/chipTone'
import { IconBolt, IconGithub, IconHealth, IconMcp, IconChat } from '../icons'
import { ContainedBlock } from '../report-detail/ReportSurface'
import type { SetupProject } from '../../lib/useSetupStatus'
import type { OnboardingStats } from './types'
import type { ActivationPreflight, ActivationTopPriority } from '../../lib/useActivationStatus'

export type LaneStatus = 'done' | 'blocked' | 'next' | 'optional'

export interface ActivationLane {
  id: string
  label: string
  description: string
  to: string
  status: LaneStatus
  receipt?: string
}

function laneTone(status: LaneStatus): string {
  if (status === 'done') return CHIP_TONE.okSubtle
  if (status === 'next') return CHIP_TONE.brandSubtle
  if (status === 'blocked') return CHIP_TONE.warnSubtle
  return CHIP_TONE.neutral
}

/** Same glyph set as nav / setup steps so lanes scan consistently. */
const LANE_ICON: Record<string, ReactNode> = {
  sdk: <IconBolt />,
  repo: <IconGithub />,
  observability: <IconHealth />,
  agent: <IconMcp />,
  community: <IconChat />,
}

function deriveLanes(
  project: SetupProject | null,
  stats: OnboardingStats | null,
  preflight: ActivationPreflight | null,
): ActivationLane[] {
  const step = (id: string) => project?.steps.find((s) => s.id === id)
  const sdk = step('sdk_installed')
  const report = step('first_report_received')
  const github = step('github_connected')
  const sentry = step('sentry_connected')
  const qa = step('first_qa_story_passing')
  const fix = step('first_fix_dispatched')
  const key = step('api_key_generated')

  const sdkDone = Boolean(sdk?.complete)
  const reportDone = Boolean(report?.complete)
  const repoDone = Boolean(github?.complete)
  const obsDone = Boolean(sentry?.complete) || Boolean(qa?.complete)
  const agentReady = Boolean(preflight?.ready) || (stats?.hasApiKey && sdkDone)
  const communityDone = (stats?.reportCount ?? 0) > 0

  const nextId = stats?.nextStepId ?? null

  const laneStatus = (done: boolean, stepIds: string[]): LaneStatus => {
    if (done) return 'done'
    if (stepIds.some((id) => id === nextId)) return 'next'
    if (!stats?.hasAnyProject) return 'blocked'
    return 'optional'
  }

  return [
    {
      id: 'sdk',
      label: 'SDK ingest',
      description: 'Install the widget, mint an ingest key, and prove the first heartbeat.',
      to: '/onboarding?tab=sdk',
      status: laneStatus(sdkDone && reportDone, ['api_key_generated', 'sdk_installed', 'first_report_received']),
      receipt: sdkDone
        ? reportDone
          ? `${stats?.reportCount ?? 0} report${(stats?.reportCount ?? 0) === 1 ? '' : 's'}`
          : 'SDK live — send a test report'
        : key?.complete
          ? 'Key minted — install SDK'
          : 'Mint API key first',
    },
    {
      id: 'repo',
      label: 'Repo & CI',
      description: 'Connect GitHub so auto-fix PRs and code grounding work.',
      to: '/integrations',
      status: laneStatus(repoDone, ['github_connected']),
      receipt: repoDone ? 'GitHub connected' : fix?.complete ? 'Fix dispatched — link repo for merges' : undefined,
    },
    {
      id: 'observability',
      label: 'Observability',
      description: 'Wire Sentry or QA stories so regressions surface before users do.',
      to: sentry?.complete ? '/qa-coverage' : '/integrations',
      status: laneStatus(obsDone, ['sentry_connected', 'first_qa_story_passing']),
      receipt: obsDone ? 'Signal wired' : 'Optional — add when ready',
    },
    {
      id: 'agent',
      label: 'Agent access',
      description: 'Mint an MCP key and paste the IDE snippet so agents can triage and fix.',
      to: '/mcp',
      status: agentReady ? 'done' : laneStatus(false, []),
      receipt: agentReady ? 'MCP preflight ready' : 'Open MCP setup',
    },
    {
      id: 'community',
      label: 'Community feedback',
      description: 'End users report bugs, vote on ideas, and see shipped updates.',
      to: '/feedback',
      status: laneStatus(communityDone, ['first_report_received']),
      receipt: communityDone ? 'Reporter loop active' : 'Needs first report',
    },
  ]
}

export function OnboardingActivationLanes({
  project,
  stats,
  preflight,
  topPriority,
  className = '',
}: {
  project: SetupProject | null
  stats: OnboardingStats | null
  preflight: ActivationPreflight | null
  topPriority: ActivationTopPriority | null
  className?: string
}) {
  const lanes = deriveLanes(project, stats, preflight)

  return (
    <Card className={`p-4 space-y-3 ${className}`} data-testid="activation-lanes">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">Activation lanes</h3>
          <ContainedBlock tone="muted" className="mt-1">
            <p className="text-2xs text-fg-muted leading-relaxed">
              Five checkpoints from first SDK heartbeat to community-driven feedback. Each lane shows done, next, or blocked with a receipt you can prove.
            </p>
          </ContainedBlock>
        </div>
        {topPriority ? (
          <Link to={topPriority.to} className="shrink-0 text-2xs font-medium text-accent-foreground hover:text-accent underline underline-offset-2 motion-safe:transition-colors">
            {topPriority.label} →
          </Link>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lanes.map((lane) => (
          <Link
            key={lane.id}
            to={lane.to}
            className="block rounded-lg border border-edge-subtle bg-surface-raised/40 p-3 transition-colors hover:border-brand/30 hover:bg-surface-hover/30 focus-visible:outline focus-visible:ring-2 focus-visible:ring-focus"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg">
                <span className="shrink-0 text-fg-muted [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
                  {LANE_ICON[lane.id]}
                </span>
                <span className="truncate">{lane.label}</span>
              </span>
              <Badge className={laneTone(lane.status)}>
                {lane.status === 'done' ? 'Done' : lane.status === 'next' ? 'Next' : lane.status === 'blocked' ? 'Blocked' : 'Optional'}
              </Badge>
            </div>
            <p className="mt-1 text-2xs text-fg-muted leading-relaxed">{lane.description}</p>
            {lane.receipt ? (
              <p className="mt-2 text-2xs font-mono text-fg-secondary">{lane.receipt}</p>
            ) : null}
          </Link>
        ))}
      </div>
    </Card>
  )
}
