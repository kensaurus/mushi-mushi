/**
 * FILE: packages/server/supabase/functions/_shared/activation-status.ts
 * PURPOSE: Shared activation cockpit helpers — next-step deep links, phase
 *          derivation, and top-priority CTA selection for the unified
 *          `/v1/admin/activation` endpoint and onboarding stats.
 */

export type ActivationPhase = 'ingest' | 'dispatch' | 'loop'

export interface ActivationTopPriority {
  label: string
  to: string
  tone: 'plan' | 'do' | 'idle'
}

/** Map setup step ids to admin-console deep links. */
const STEP_NEXT_LINKS: Record<string, string> = {
  project_created: '/onboarding?tab=verify',
  api_key_generated: '/onboarding?tab=verify',
  sdk_installed: '/onboarding?tab=sdk',
  first_report_received: '/onboarding?tab=verify',
  // /integrations is the public marketing page; the console route is
  // /integrations/config, and the hash scrolls to the card (Layout's
  // ScrollToHashAnchor). The page never read a `?tab=` param.
  github_connected: '/integrations/config#platform-card-github',
  sentry_connected: '/integrations/config#platform-card-sentry',
  byok_anthropic: '/settings?tab=byok',
  codebase_indexed: '/integrations/config#integrations-codebase',
  autofix_enabled: '/settings?tab=autofix',
  first_fix_dispatched: '/reports',
  slack_connected: '/integrations/config#integrations-slack',
  first_qa_story_passing: '/qa-coverage',
}

export function resolveNextStepTo(stepId: string | null | undefined): string | null {
  if (!stepId) return null
  return STEP_NEXT_LINKS[stepId] ?? '/onboarding?tab=steps'
}

export function deriveActivationPhase(input: {
  setupDone: boolean
  reportCount: number
  fixCount: number
  mergedFixCount: number
}): ActivationPhase {
  if (!input.setupDone || input.reportCount === 0) return 'ingest'
  if (input.fixCount === 0) return 'dispatch'
  return 'loop'
}

export function buildTopPriority(input: {
  setupDone: boolean
  nextStepId: string | null
  nextStepLabel: string | null
  reportCount: number
}): ActivationTopPriority {
  if (!input.setupDone && input.nextStepId) {
    return {
      label: input.nextStepLabel ?? 'Continue setup',
      to: resolveNextStepTo(input.nextStepId) ?? '/onboarding',
      tone: 'plan',
    }
  }
  if (input.reportCount === 0) {
    return {
      label: 'Send a test bug',
      to: '/onboarding?tab=verify',
      tone: 'plan',
    }
  }
  return {
    label: 'Open inbox',
    to: '/reports',
    tone: 'do',
  }
}
