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
      requiredTotal: 4,
      stepsComplete: 0,
      stepsTotal: 8,
      optionalComplete: 0,
      optionalTotal: 4,
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
  type StepDef = { id: string; label: string; complete: boolean; required: boolean };
  const steps: StepDef[] = [
    { id: 'project_created', label: 'Create your first project', complete: true, required: true },
    { id: 'api_key_generated', label: 'Generate an API key', complete: s.hasKey, required: true },
    { id: 'sdk_installed', label: 'Install the SDK in your app', complete: s.hasSdk, required: true },
    {
      id: 'first_report_received',
      label: 'Receive your first bug report',
      complete: s.reportCount > 0,
      required: true,
    },
    { id: 'github_connected', label: 'Connect GitHub', complete: s.hasGithub, required: false },
    { id: 'sentry_connected', label: 'Connect Sentry (optional)', complete: s.hasSentry, required: false },
    { id: 'byok_anthropic', label: 'Add your Anthropic key (optional)', complete: s.hasByok, required: false },
    {
      id: 'first_fix_dispatched',
      label: 'Dispatch your first auto-fix',
      complete: s.fixCount > 0,
      required: false,
    },
    {
      id: 'first_qa_story_passing',
      label: 'Set up a QA story (optional)',
      complete: s.hasQaPassing,
      required: false,
    },
  ];

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
