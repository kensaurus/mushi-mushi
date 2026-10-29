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
 *          keys), and a first bug report.
 *
 *          One count everywhere (console sweep 2026-10-28): Set up said "2 of
 *          4 done" while the sidebar said "Set up · 3/4" and Home "3 of 4",
 *          because this rail did not count a test report and the server's
 *          required steps do. The rail now counts exactly the server's four
 *          required steps; a test-only report still says so in its line.
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

type SetupRailStepId = 'project' | 'key' | 'sdk' | 'report'
type SetupRailState = 'done' | 'current' | 'todo'

export interface SetupRailStep {
  id: SetupRailStepId
  label: string
  state: SetupRailState
  /** One short line under the label: when it happened, or what is missing. */
  detail: string
  /** The Set up tab that finishes or shows this step. */
  tab: OnboardingTabId
  /** What to do, for "Next: …": "make a key". */
  action: string
}

interface SdkHeartbeatView {
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

// Plain words: "Report key", "SDK heartbeat" read as jargon to a new user.
const LABELS: Record<SetupRailStepId, string> = {
  project: 'App created',
  key: 'Key made',
  sdk: 'App connected',
  report: 'First bug received',
}

const ACTIONS: Record<SetupRailStepId, string> = {
  project: 'name your app',
  key: 'make a key',
  sdk: 'connect your app',
  report: 'get your first bug',
}

/** The server's required step behind each rail step: one count with the sidebar and Home. */
const SERVER_STEP: Record<SetupRailStepId, string> = {
  project: 'project_created',
  key: 'api_key_generated',
  sdk: 'sdk_installed',
  report: 'first_report_received',
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

  // The server sets sdk_installed only from an SDK key's check-in, and
  // first_report_received from any report, a test one included.
  const done: Record<SetupRailStepId, boolean> = {
    project: project != null && (stepComplete(project, SERVER_STEP.project) || !project.steps.some((s) => s.id === SERVER_STEP.project)),
    key: stepComplete(project, SERVER_STEP.key),
    sdk: stepComplete(project, SERVER_STEP.sdk),
    report: realReportAt != null || stepComplete(project, SERVER_STEP.report),
  }

  const detail: Record<SetupRailStepId, string> = {
    project: done.project ? (when('Created', project?.created_at, now) ?? 'Created') : 'Name your app',
    key: done.key ? (when('Made', ttfd?.keyMintedAt, now) ?? 'Ready') : 'Not made yet',
    sdk: heartbeat ? `Last heard ${heartbeat.ago ?? 'recently'}` : 'Not heard from your app yet',
    report: realReportAt
      ? (when('Diagnosed', realReportAt, now) ?? 'Diagnosed')
      : testDiagnosedAt
        ? 'A test bug so far; none from your app yet'
        : done.report
          ? 'Received; the diagnosis is on its way'
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
    action: ACTIONS[id],
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

/** One plain line about when the app last checked in: when, which key, from where. "Heartbeat" was jargon (2026-10-28). */
export function heartbeatSentence(heartbeat: SdkHeartbeatView | null): string {
  if (!heartbeat) return 'Mushi has not heard from your app yet. It does within a minute of the SDK loading in a browser or on a device.'
  const parts = [`Your app last checked in ${heartbeat.ago ?? 'recently'}`]
  if (heartbeat.keyLabel) parts.push(`key “${heartbeat.keyLabel}”`)
  if (heartbeat.origin) parts.push(`from ${heartbeat.origin}`)
  return `${parts.join(' · ')}.`
}
