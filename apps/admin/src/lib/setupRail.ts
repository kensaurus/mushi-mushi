/**
 * FILE: apps/admin/src/lib/setupRail.ts
 * PURPOSE: The four steps a solo builder walks to get Mushi wired into an app,
 *          with live state (console journeys 2026-10-27, Set up page intent):
 *
 *            app created → report key → SDK heartbeat → first report from the app
 *
 *          Set up opened on "READY · 74 test bugs received" over four tiles
 *          and a duplicate checklist, and its Verify card kept "waiting on your
 *          first classified report" after the test report it asked for was
 *          diagnosed (report 9b7624e6). The rail counts what the user cares
 *          about: a heartbeat from an SDK key (the server ignores MCP and CLI
 *          keys), and a report from the app itself. A test report proves the
 *          pipeline works; it does not finish the last step.
 */

import type { SetupProject } from './useSetupStatus'
import type { OnboardingTabId } from '../components/onboarding/types'
import { relativeTime } from './setupGuideSteps'

/** GET /v1/admin/onboarding/time-to-first-diagnosis. The last two fields are newer than the route's first deploy. */
export interface TimeToFirstDiagnosis {
  keyMintedAt: string | null
  firstDiagnosisAt: string | null
  ms: number | null
  firstReportId?: string | null
  testDiagnosisAt?: string | null
}

export type SetupRailStepId = 'project' | 'key' | 'sdk' | 'report'
export type SetupRailState = 'done' | 'current' | 'todo'

export interface SetupRailStep {
  id: SetupRailStepId
  label: string
  state: SetupRailState
  /** One short line under the label: when it happened, or what is missing. */
  detail: string
  /** The Set up tab that finishes or shows this step. */
  tab: OnboardingTabId
}

export interface SdkHeartbeatView {
  seenAt: string
  ago: string | null
  origin: string | null
  keyLabel: string | null
}

export interface SetupRail {
  steps: readonly SetupRailStep[]
  doneCount: number
  /** The first step not done, or null when all four are. */
  next: SetupRailStep | null
  heartbeat: SdkHeartbeatView | null
  firstReportId: string | null
  /** When a test report was diagnosed, if the app has sent none of its own. */
  testDiagnosedAt: string | null
}

const LABELS: Record<SetupRailStepId, string> = {
  project: 'App created',
  key: 'Report key',
  sdk: 'SDK heartbeat',
  report: 'First report from your app',
}

const TABS: Record<SetupRailStepId, OnboardingTabId> = {
  project: 'steps',
  key: 'sdk',
  sdk: 'sdk',
  report: 'verify',
}

function stepComplete(project: SetupProject | null, id: string): boolean {
  return project?.steps.find((s) => s.id === id)?.complete ?? false
}

function when(prefix: string, iso: string | null | undefined, now: number): string | null {
  const ago = relativeTime(iso ?? null, now)
  return ago ? `${prefix} ${ago}` : null
}

export function buildSetupRail(input: {
  project: SetupProject | null
  ttfd: TimeToFirstDiagnosis | null
  now?: number
}): SetupRail {
  const { project, ttfd } = input
  const now = input.now ?? Date.now()
  const sdkStep = project?.steps.find((s) => s.id === 'sdk_installed')
  const diagnostic = sdkStep?.diagnostic
  const seenAt = diagnostic?.last_sdk_seen_at ?? null
  const heartbeat: SdkHeartbeatView | null = seenAt
    ? {
        seenAt,
        ago: relativeTime(seenAt, now),
        origin: diagnostic?.last_sdk_origin ?? null,
        keyLabel: diagnostic?.last_sdk_key_label ?? null,
      }
    : null

  const realReportAt = ttfd?.firstDiagnosisAt ?? null
  const testDiagnosedAt = realReportAt ? null : (ttfd?.testDiagnosisAt ?? null)

  const done: Record<SetupRailStepId, boolean> = {
    project: project != null,
    key: stepComplete(project, 'api_key_generated'),
    // The server sets sdk_installed only from an SDK key's check-in.
    sdk: stepComplete(project, 'sdk_installed') || heartbeat != null,
    report: realReportAt != null,
  }

  const detail: Record<SetupRailStepId, string> = {
    project: done.project ? (when('Created', project?.created_at, now) ?? 'Created') : 'Name your app',
    key: done.key ? (when('Made', ttfd?.keyMintedAt, now) ?? 'Ready') : 'Not made yet',
    sdk: heartbeat ? `Last heard ${heartbeat.ago ?? 'recently'}` : 'Not heard from your app yet',
    report: realReportAt
      ? (when('Diagnosed', realReportAt, now) ?? 'Diagnosed')
      : testDiagnosedAt
        ? 'Test bug diagnosed; waiting on your app'
        : 'Waiting on your app',
  }

  const ids: SetupRailStepId[] = ['project', 'key', 'sdk', 'report']
  const firstOpen = ids.find((id) => !done[id]) ?? null
  const steps = ids.map<SetupRailStep>((id) => ({
    id,
    label: LABELS[id],
    state: done[id] ? 'done' : id === firstOpen ? 'current' : 'todo',
    detail: detail[id],
    tab: TABS[id],
  }))

  return {
    steps,
    doneCount: ids.filter((id) => done[id]).length,
    next: steps.find((s) => s.state === 'current') ?? null,
    heartbeat,
    firstReportId: ttfd?.firstReportId ?? null,
    testDiagnosedAt,
  }
}

/** One plain line about the last SDK heartbeat: when, which key, from where. */
export function heartbeatSentence(heartbeat: SdkHeartbeatView | null): string {
  if (!heartbeat) return 'No heartbeat from your app yet. One shows up within a minute of the SDK loading in a browser or device.'
  const parts = [`Last heartbeat ${heartbeat.ago ?? 'recently'}`]
  if (heartbeat.keyLabel) parts.push(`key “${heartbeat.keyLabel}”`)
  if (heartbeat.origin) parts.push(`from ${heartbeat.origin}`)
  return `${parts.join(' · ')}.`
}
