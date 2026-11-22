/**
 * FILE: packages/server/supabase/functions/_shared/setup-steps.ts
 * PURPOSE: The one setup step list. Every route that counts setup steps reads
 *          it: `/v1/admin/setup`, `/v1/admin/onboarding/stats`,
 *          `/v1/admin/activation` (its `setup` and `stats` blocks),
 *          `/v1/admin/dashboard/stats`, `/v1/admin/inbox/stats`,
 *          `/v1/sync/ingest-setup` and `/v1/admin/projects/:id/ingest-setup`.
 *
 * Why this exists: those routes carried six copies of the list and disagreed
 * on whether installing the SDK is required. `/v1/admin/setup`, the dashboard
 * and ingest-setup counted 4 required steps; the activation builders counted 3
 * (the SDK step optional, from docs/plan-gtm.md Workstream B §2b, a plan and
 * not an ADR). The console showed "3 of 4" on one card and "ready, 3/3" on the
 * next (mushi-demo, 2026-10-26) and patched the counts client-side
 * (apps/admin/src/lib/setupProgress.ts `withSetupRequiredCounts`).
 *
 * Required: project, API key, SDK installed, first report. The SDK step is
 * required because the console counts it (Home, first-run screens, sidebar
 * "Set up · X of Y done") and a test report alone does not prove the app sends
 * anything. No ADR says otherwise (docs/adr/INDEX.md, 2026-11-22).
 *
 * A required step's `complete` reads only `RequiredSetupSignals`, which the
 * dashboard and ingest-setup routes load themselves. Making a step required
 * that needs another signal is a type error until those loaders read it too.
 */

export type SetupStepId =
  | 'project_created'
  | 'api_key_generated'
  | 'sdk_installed'
  | 'first_report_received'
  | 'github_connected'
  | 'sentry_connected'
  | 'byok_anthropic'
  | 'first_fix_dispatched'
  | 'slack_connected'
  | 'first_qa_story_passing'

/** The signals the required steps read. */
export interface RequiredSetupSignals {
  hasKey: boolean
  /** An SDK key checked in with this backend (setup-signals.ts `isSdkKey`). */
  hasSdk: boolean
  reportCount: number
}

/** Every signal any step reads (a subset of `ProjectSetupSignals`). */
export interface SetupStepSignals extends RequiredSetupSignals {
  hasGithub: boolean
  hasSentry: boolean
  hasByok: boolean
  hasSlack: boolean
  fixCount: number
  hasQaPassing: boolean
}

interface SetupStepCopy {
  id: SetupStepId
  label: string
  description: string
  /** Admin-console link the checklist and nudges jump to. */
  cta_to: string
  cta_label: string
}

export interface RequiredSetupStep extends SetupStepCopy {
  required: true
  complete: (s: RequiredSetupSignals) => boolean
  /** The wording `/v1/sync/ingest-setup` uses (CLI `mushi doctor`, MCP `diagnose_setup`). */
  ingest: { label: string; doneHint: string; todoHint: string }
}

export interface OptionalSetupStep extends SetupStepCopy {
  required: false
  complete: (s: SetupStepSignals) => boolean
}

export type SetupStepDef = RequiredSetupStep | OptionalSetupStep

export const SETUP_STEPS: readonly SetupStepDef[] = [
  {
    id: 'project_created',
    label: 'Create your first project',
    description: 'A project groups all bug reports from one application.',
    required: true,
    complete: () => true,
    cta_to: '/onboarding?tab=steps&setup=cli',
    cta_label: 'Open setup wizard',
    ingest: {
      label: 'Project exists',
      doneHint: 'Project row is provisioned in Mushi.',
      todoHint: 'Create a project in the console.',
    },
  },
  {
    id: 'api_key_generated',
    label: 'Generate an API key',
    description: 'Your SDK uses this key to authenticate report submissions.',
    required: true,
    complete: (s) => s.hasKey,
    cta_to: '/onboarding?tab=verify',
    cta_label: 'Generate API key',
    ingest: {
      label: 'API key active',
      doneHint: 'At least one active API key is configured.',
      todoHint: 'Mint an API key in Projects → Generate key.',
    },
  },
  {
    id: 'sdk_installed',
    label: 'Install the SDK in your app',
    description: 'Drop the Mushi widget into your app so users can submit reports.',
    required: true,
    complete: (s) => s.hasSdk,
    cta_to: '/onboarding?tab=sdk',
    cta_label: 'Install SDK',
    ingest: {
      label: 'SDK heartbeat',
      doneHint: 'An SDK key from the app checked in with this backend.',
      todoHint: 'Install the snippet, set env vars, restart your dev server.',
    },
  },
  {
    id: 'first_report_received',
    label: 'Receive your first bug report',
    description: 'Send a test report or wait for a real user submission.',
    required: true,
    complete: (s) => s.reportCount > 0,
    cta_to: '/onboarding?tab=verify',
    cta_label: 'Send test report',
    ingest: {
      label: 'First report ingested',
      doneHint: 'At least one report row exists for this project.',
      todoHint: 'Send a test report from Projects or open the banner in your app.',
    },
  },
  {
    id: 'github_connected',
    label: 'Connect GitHub',
    description: 'Lets Mushi read your code to explain bugs and open fixes as pull requests.',
    required: false,
    complete: (s) => s.hasGithub,
    cta_to: '/integrations/config#platform-card-github',
    cta_label: 'Connect GitHub',
  },
  {
    id: 'sentry_connected',
    label: 'Connect Sentry (optional)',
    description: 'Pull Sentry issues + Seer root-cause into Mushi reports.',
    required: false,
    complete: (s) => s.hasSentry,
    cta_to: '/integrations/config#platform-card-sentry',
    cta_label: 'Connect Sentry',
  },
  {
    id: 'byok_anthropic',
    label: 'Add your Anthropic key (optional)',
    description: 'BYOK avoids platform quotas and sends usage to your own bill.',
    required: false,
    complete: (s) => s.hasByok,
    cta_to: '/settings?tab=byok',
    cta_label: 'Add API key',
  },
  {
    id: 'first_fix_dispatched',
    label: 'Dispatch your first auto-fix',
    description: 'Open a report, click "Dispatch fix", and watch the LLM agent.',
    required: false,
    complete: (s) => s.fixCount > 0,
    cta_to: '/reports',
    cta_label: 'Open Reports',
  },
  {
    id: 'slack_connected',
    label: 'Connect Slack (optional)',
    description: 'Get instant Slack alerts when a QA story fails or a new report is classified.',
    required: false,
    complete: (s) => s.hasSlack,
    cta_to: '/integrations/config#integrations-slack',
    cta_label: 'Add to Slack',
  },
  {
    id: 'first_qa_story_passing',
    label: 'Set up a QA story (optional)',
    description: 'Write a plain-English test that runs on a schedule — catch regressions before your users do.',
    required: false,
    complete: (s) => s.hasQaPassing,
    cta_to: '/qa-coverage',
    cta_label: 'Create QA story',
  },
]

export const REQUIRED_SETUP_STEPS: readonly RequiredSetupStep[] = SETUP_STEPS.filter(
  (s): s is RequiredSetupStep => s.required,
)
export const SETUP_STEPS_TOTAL = SETUP_STEPS.length
export const SETUP_REQUIRED_TOTAL = REQUIRED_SETUP_STEPS.length
export const SETUP_OPTIONAL_TOTAL = SETUP_STEPS_TOTAL - SETUP_REQUIRED_TOTAL

/** The step a project with nothing yet starts on. */
export const FIRST_SETUP_STEP = REQUIRED_SETUP_STEPS[0]!

export interface EvaluatedSetupStep {
  id: SetupStepId
  label: string
  description: string
  complete: boolean
  required: boolean
  cta_to: string
  cta_label: string
}

/** Required-step progress: what every "X of Y done" and "setup done" reads. */
export interface RequiredSetupProgress {
  requiredComplete: number
  requiredTotal: number
  setupDone: boolean
  /** First required step not done yet, or null when setup is done. */
  next: RequiredSetupStep | null
}

export function requiredSetupProgress(s: RequiredSetupSignals): RequiredSetupProgress {
  let requiredComplete = 0
  let next: RequiredSetupStep | null = null
  for (const step of REQUIRED_SETUP_STEPS) {
    if (step.complete(s)) requiredComplete++
    else next ??= step
  }
  return {
    requiredComplete,
    requiredTotal: SETUP_REQUIRED_TOTAL,
    setupDone: requiredComplete === SETUP_REQUIRED_TOTAL,
    next,
  }
}

/** Every step, in order, with its completion for one project. */
export function evaluateSetupSteps(s: SetupStepSignals): EvaluatedSetupStep[] {
  return SETUP_STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    description: step.description,
    complete: step.complete(s),
    required: step.required,
    cta_to: step.cta_to,
    cta_label: step.cta_label,
  }))
}

/** Counts over every step: required, optional and all. */
export function setupStepCounts(s: SetupStepSignals) {
  const steps = evaluateSetupSteps(s)
  const progress = requiredSetupProgress(s)
  const complete = steps.filter((x) => x.complete).length
  return {
    steps,
    ...progress,
    stepsComplete: complete,
    stepsTotal: SETUP_STEPS_TOTAL,
    optionalComplete: complete - progress.requiredComplete,
    optionalTotal: SETUP_OPTIONAL_TOTAL,
  }
}
