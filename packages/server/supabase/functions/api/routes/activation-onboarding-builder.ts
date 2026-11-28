/**
 * FILE: packages/server/supabase/functions/api/routes/activation-onboarding-builder.ts
 * PURPOSE: Pure builder for onboarding stats payload shared by
 *          `/v1/admin/onboarding/stats` and `/v1/admin/activation`. The steps
 *          and every count come from the one list in _shared/setup-steps.ts.
 */

import { resolveNextStepTo } from '../../_shared/activation-status.ts';
import {
  FIRST_SETUP_STEP,
  SETUP_OPTIONAL_TOTAL,
  SETUP_REQUIRED_TOTAL,
  SETUP_STEPS_TOTAL,
  setupStepCounts,
} from '../../_shared/setup-steps.ts';

export interface OnboardingSignals {
  hasKey: boolean;
  hasSdk: boolean;
  sdkEndpointHost: string | null;
  sdkHostMismatch: boolean;
  hasGithub: boolean;
  hasSentry: boolean;
  hasByok: boolean;
  /** Optional for older callers; a missing value counts the Slack step as not done. */
  hasSlack?: boolean;
  hasQaPassing: boolean;
  reportCount: number;
  fixCount: number;
  mergedFixCount: number;
  /** created_at of the project's first real (non-test, non-seed) report. */
  firstReportAt?: string | null;
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
      requiredTotal: SETUP_REQUIRED_TOTAL,
      stepsComplete: 0,
      stepsTotal: SETUP_STEPS_TOTAL,
      optionalComplete: 0,
      optionalTotal: SETUP_OPTIONAL_TOTAL,
      setupDone: false,
      nextStepId: FIRST_SETUP_STEP.id as string | null,
      nextStepLabel: FIRST_SETUP_STEP.label as string | null,
      sdkInstalled: false,
      sdkHostMismatch: false,
      adminEndpointHost: input.adminHost,
      sdkEndpointHost: null,
      hasApiKey: false,
      reportCount: 0,
      fixCount: 0,
      mergedFixCount: 0,
      first_report_at: null as string | null,
      nextStepTo: resolveNextStepTo(FIRST_SETUP_STEP.id),
    };
  }

  const s = input.signals;
  const counts = setupStepCounts({ ...s, hasSlack: s.hasSlack ?? false });
  const nextRequired = counts.next;

  return {
    hasAnyProject: true,
    projectId: input.project.id,
    projectName: input.project.name,
    requiredComplete: counts.requiredComplete,
    requiredTotal: counts.requiredTotal,
    stepsComplete: counts.stepsComplete,
    stepsTotal: counts.stepsTotal,
    optionalComplete: counts.optionalComplete,
    optionalTotal: counts.optionalTotal,
    setupDone: counts.setupDone,
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
    // ISO timestamp of the first real report (CLI `mushi status` reads it).
    first_report_at: s.firstReportAt ?? null,
    nextStepTo: resolveNextStepTo(nextRequired?.id),
  };
}
