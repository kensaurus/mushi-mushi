/**
 * FILE: packages/server/supabase/functions/api/routes/activation-onboarding-builder.ts
 * PURPOSE: Pure builder for onboarding stats payload shared by
 *          `/v1/admin/onboarding/stats` and `/v1/admin/activation`.
 */

import { resolveNextStepTo } from '../../_shared/activation-status.ts';

export interface OnboardingSignals {
  hasKey: boolean;
  hasSdk: boolean;
  sdkEndpointHost: string | null;
  sdkHostMismatch: boolean;
  hasGithub: boolean;
  hasSentry: boolean;
  hasByok: boolean;
  hasQaPassing: boolean;
  reportCount: number;
  fixCount: number;
  mergedFixCount: number;
}

/**
 * Single source of truth for the onboarding checklist. Both the empty-project
 * branch (which reports totals) and the populated branch (which reports
 * per-step completion) derive their counts from this array, so the two can
 * never drift out of sync.
 */
type StepMeta = {
  id: string;
  label: string;
  required: boolean;
  complete: (s: OnboardingSignals) => boolean;
};

const ONBOARDING_STEPS: StepMeta[] = [
  { id: 'project_created', label: 'Create your first project', required: true, complete: () => true },
  { id: 'api_key_generated', label: 'Generate an API key', required: true, complete: (s) => s.hasKey },
  { id: 'sdk_installed', label: 'Install the SDK in your app', required: true, complete: (s) => s.hasSdk },
  {
    id: 'first_report_received',
    label: 'Receive your first bug report',
    required: true,
    complete: (s) => s.reportCount > 0,
  },
  { id: 'github_connected', label: 'Connect GitHub', required: false, complete: (s) => s.hasGithub },
  { id: 'sentry_connected', label: 'Connect Sentry (optional)', required: false, complete: (s) => s.hasSentry },
  { id: 'byok_anthropic', label: 'Add your Anthropic key (optional)', required: false, complete: (s) => s.hasByok },
  {
    id: 'first_fix_dispatched',
    label: 'Dispatch your first auto-fix',
    required: false,
    complete: (s) => s.fixCount > 0,
  },
  {
    id: 'first_qa_story_passing',
    label: 'Set up a QA story (optional)',
    required: false,
    complete: (s) => s.hasQaPassing,
  },
];

const ONBOARDING_REQUIRED_TOTAL = ONBOARDING_STEPS.filter((step) => step.required).length;
const ONBOARDING_OPTIONAL_TOTAL = ONBOARDING_STEPS.length - ONBOARDING_REQUIRED_TOTAL;

export function buildOnboardingStatsPayload(input: {
  hasAnyProject: boolean;
  adminHost: string | null;
  project: { id: string; name: string } | null;
  signals: OnboardingSignals | null;
}) {
  if (!input.hasAnyProject || !input.project || !input.signals) {
    return {
      hasAnyProject: false,
      projectId: null,
      projectName: null,
      requiredComplete: 0,
      requiredTotal: ONBOARDING_REQUIRED_TOTAL,
      stepsComplete: 0,
      stepsTotal: ONBOARDING_STEPS.length,
      optionalComplete: 0,
      optionalTotal: ONBOARDING_OPTIONAL_TOTAL,
      setupDone: false,
      nextStepId: 'project_created' as string | null,
      nextStepLabel: 'Create your first project' as string | null,
      sdkInstalled: false,
      sdkHostMismatch: false,
      adminEndpointHost: input.adminHost,
      sdkEndpointHost: null,
      hasApiKey: false,
      reportCount: 0,
      fixCount: 0,
      mergedFixCount: 0,
      nextStepTo: resolveNextStepTo('project_created'),
    };
  }

  const s = input.signals;
  const steps = ONBOARDING_STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    complete: step.complete(s),
    required: step.required,
  }));

  const requiredSteps = steps.filter((step) => step.required);
  const optionalSteps = steps.filter((step) => !step.required);
  const requiredComplete = requiredSteps.filter((step) => step.complete).length;
  const setupDone = requiredComplete === requiredSteps.length;
  const nextRequired = requiredSteps.find((step) => !step.complete) ?? null;

  return {
    hasAnyProject: true,
    projectId: input.project.id,
    projectName: input.project.name,
    requiredComplete,
    requiredTotal: requiredSteps.length,
    stepsComplete: steps.filter((step) => step.complete).length,
    stepsTotal: steps.length,
    optionalComplete: optionalSteps.filter((step) => step.complete).length,
    optionalTotal: optionalSteps.length,
    setupDone,
    nextStepId: nextRequired?.id ?? null,
    nextStepLabel: nextRequired?.label ?? null,
    sdkInstalled: s.hasSdk,
    sdkHostMismatch: s.sdkHostMismatch,
    adminEndpointHost: input.adminHost,
    sdkEndpointHost: s.sdkEndpointHost,
    hasApiKey: s.hasKey,
    reportCount: s.reportCount,
    fixCount: s.fixCount,
    mergedFixCount: s.mergedFixCount,
    nextStepTo: resolveNextStepTo(nextRequired?.id),
  };
}
