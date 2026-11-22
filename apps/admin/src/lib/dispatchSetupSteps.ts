/**
 * FILE: apps/admin/src/lib/dispatchSetupSteps.ts
 * PURPOSE: What is left to set up before "Dispatch fix" works, in plain words,
 *          with a link for each step and an "X of Y done" count.
 *
 *          A new user's first report said "click Dispatch fix to start" over
 *          two disabled Dispatch fix buttons, and only one had a hover
 *          tooltip saying why (feedback 2026-11-22). Every place that shows a
 *          disabled Dispatch fix now shows this line instead. The steps are
 *          the preflight's own checks (GET /v1/admin/projects/:id/preflight),
 *          so the count follows the server's list, never a number written here.
 */

import type { PreflightCheck } from './useDispatchPreflight'

interface DispatchSetupStep {
  key: string
  /** What to do, as a short verb phrase: "Connect GitHub". */
  label: string
  /** Where to do it (the check's fixHref). */
  href: string
}

export interface DispatchSetupSteps {
  /** The steps still to do, in the server's order. */
  steps: DispatchSetupStep[]
  done: number
  total: number
}

const STEP_LABELS: Record<string, string> = {
  github: 'Connect GitHub',
  codebase: 'Index your code',
  anthropic: 'Add an AI key',
  autofix: 'Turn on Autofix',
}

/** The agent check is named after the agent that writes the fix (server `_shared/agent-credits.ts`). */
function agentStepLabel(check: Pick<PreflightCheck, 'label'>): string {
  const label = check.label.toLowerCase()
  if (label.includes('cursor') && label.includes('out of credits')) return 'Top up Cursor credits'
  if (label.includes('cursor')) return 'Add a Cursor key'
  if (label.includes('ai key')) return 'Add an AI key'
  return check.label
}

function dispatchSetupStepLabel(check: Pick<PreflightCheck, 'key' | 'label'>): string {
  if (check.key === 'agent') return agentStepLabel(check)
  return STEP_LABELS[check.key] ?? check.label
}

/** The steps left, or null when nothing is left (or the checks are unknown). */
export function dispatchSetupSteps(
  checks: ReadonlyArray<Pick<PreflightCheck, 'key' | 'label' | 'ready' | 'fixHref'>> | null | undefined,
): DispatchSetupSteps | null {
  if (!checks || checks.length === 0) return null
  const failing = checks.filter((c) => !c.ready)
  if (failing.length === 0) return null
  return {
    steps: failing.map((c) => ({ key: c.key, label: dispatchSetupStepLabel(c), href: c.fixHref })),
    done: checks.length - failing.length,
    total: checks.length,
  }
}

/** "Connect GitHub · Index your code · Turn on Autofix (1 of 4 done)", for titles and plain text. */
export function dispatchSetupSentence(setup: DispatchSetupSteps, lead = 'To dispatch a fix:'): string {
  return `${lead} ${setup.steps.map((s) => s.label).join(' · ')} (${setup.done} of ${setup.total} done)`
}
