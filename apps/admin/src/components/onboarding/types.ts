/**
 * FILE: apps/admin/src/components/onboarding/types.ts
 */

export type OnboardingTabId = 'overview' | 'steps' | 'verify' | 'sdk'

export interface OnboardingStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  requiredComplete: number
  requiredTotal: number
  stepsComplete: number
  stepsTotal: number
  optionalComplete: number
  optionalTotal: number
  setupDone: boolean
  nextStepId: string | null
  nextStepLabel: string | null
  sdkInstalled: boolean
  sdkHostMismatch: boolean
  adminEndpointHost: string | null
  sdkEndpointHost: string | null
  hasApiKey: boolean
  reportCount: number
  fixCount: number
  mergedFixCount: number
  /** Deep link to the tab/action for the next incomplete step. */
  nextStepTo: string | null
}

export const EMPTY_ONBOARDING_STATS: OnboardingStats = {
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
  nextStepId: 'project_created',
  nextStepLabel: 'Create your first project',
  sdkInstalled: false,
  sdkHostMismatch: false,
  adminEndpointHost: null,
  sdkEndpointHost: null,
  hasApiKey: false,
  reportCount: 0,
  fixCount: 0,
  mergedFixCount: 0,
  nextStepTo: '/onboarding?tab=steps',
}

