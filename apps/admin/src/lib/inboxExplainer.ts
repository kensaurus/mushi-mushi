/**
 * Plain-language PDCA stage guide for the Action Inbox.
 */

export type InboxStageId = 'plan' | 'do' | 'check' | 'act' | 'ops'

export interface InboxStageDefinition {
  id: InboxStageId
  label: string
  shortLabel: string
  plain: string
  examples: string[]
  clearsWhen: string
}

export const INBOX_PDCA_STAGES: InboxStageDefinition[] = [
  {
    id: 'plan',
    label: 'Plan — classify and triage',
    shortLabel: 'Plan',
    plain: 'New bugs waiting for a human to confirm severity and decide what happens next.',
    examples: ['Critical reports in the queue', 'Reports waiting >1h to triage'],
    clearsWhen: 'Queue is triaged — no critical or stale untriaged reports.',
  },
  {
    id: 'do',
    label: 'Do — dispatch and land fixes',
    shortLabel: 'Do',
    plain: 'Fix attempts that failed or need a retry before the PR can merge.',
    examples: ['Failed fix-worker runs', 'Draft PRs stuck in CI'],
    clearsWhen: 'No failed fix attempts in the last 14 days.',
  },
  {
    id: 'check',
    label: 'Check — verify quality',
    shortLabel: 'Check',
    plain: 'Independent judge scores that tell you if triage quality is drifting.',
    examples: ['No judge evaluations yet', 'Judge scores older than 48h'],
    clearsWhen: 'Judge ran recently and disagreement rate is acceptable.',
  },
  {
    id: 'act',
    label: 'Act — ship and notify',
    shortLabel: 'Act',
    plain: 'Integrations that block fixes from reaching GitHub or your team chat.',
    examples: ['GitHub disconnected', 'Slack routing not configured'],
    clearsWhen: 'All required integrations pass health probes.',
  },
  {
    id: 'ops',
    label: 'Ops — health and compliance',
    shortLabel: 'Ops',
    plain: 'Background probes and platform health — degraded but not yet blocking.',
    examples: ['Degraded Sentry probe', 'Stale codebase index'],
    clearsWhen: 'No red or amber integration probes.',
  },
]

export const INBOX_EXPLAINER_SUMMARY =
  'The Inbox is your cross-loop to-do list — it tells you what to do next across all five PDCA stages. It is distinct from the Reports page (which lists end-user bugs); the Inbox aggregates actions across triage, fixes, integrations, and ops. Each open card maps to one stage — work top to bottom, or jump straight to the highest-severity item.'

export function inboxStageDefinition(stage: string): InboxStageDefinition | undefined {
  return INBOX_PDCA_STAGES.find((s) => s.id === stage)
}
