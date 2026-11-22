/**
 * Set up's four-step rail (console journeys 2026-10-27). Since the console
 * sweep (2026-10-28) it counts exactly the server's four required steps, so
 * "N of 4" matches the sidebar and Home; a step done only by a test report
 * says so in its line.
 */

import { describe, expect, it } from 'vitest'
import { buildSetupRail, formatDiagnosisDuration, heartbeatSentence } from './setupRail'
import { ONBOARDING_TAB_IDS } from '../components/onboarding/types'
import type { SetupProject } from './useSetupStatus'

const NOW = Date.parse('2026-10-27T12:00:00Z')

function project(over: { key?: boolean; sdk?: boolean; report?: boolean; seenAt?: string | null; origin?: string | null; keyLabel?: string | null } = {}): SetupProject {
  const step = (id: string, complete: boolean) => ({ id, label: id, description: '', complete, required: true, cta_to: '/', cta_label: 'Go' })
  return {
    project_id: 'p1',
    project_name: 'Demo',
    project_slug: 'demo',
    created_at: '2026-10-27T11:00:00Z',
    steps: [
      step('project_created', true),
      step('api_key_generated', over.key ?? false),
      {
        ...step('sdk_installed', over.sdk ?? false),
        diagnostic: {
          last_sdk_seen_at: over.seenAt ?? null,
          last_sdk_origin: over.origin ?? null,
          last_sdk_user_agent: null,
          last_sdk_endpoint_host: null,
          last_sdk_key_label: over.keyLabel ?? null,
        },
      },
      step('first_report_received', over.report ?? false),
    ],
    required_total: 4,
    required_complete: 1 + Number(over.key ?? false) + Number(over.sdk ?? false) + Number(over.report ?? false),
    total: 8,
    complete: 1,
    done: false,
    report_count: 0,
    fix_count: 0,
    merged_fix_count: 0,
  } as SetupProject
}

describe('buildSetupRail', () => {
  it('a new app: app done, key is the current step, the rest to do', () => {
    const rail = buildSetupRail({ project: project(), ttfd: null, now: NOW })
    expect(rail.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo'])
    expect(rail.steps[0].detail).toBe('1h ago')
    expect(rail.next?.id).toBe('key')
    expect(rail.next?.action).toBe('make a key')
    expect(rail.doneCount).toBe(1)
  })

  // Set up said "2 of 4 done" beside the sidebar's "Set up · 3/4" (2026-10-28).
  it('counts what the server counts, and says when the report was only a test', () => {
    const p = project({ key: true, report: true })
    const rail = buildSetupRail({
      project: p,
      ttfd: { keyMintedAt: '2026-10-27T11:30:00Z', firstDiagnosisAt: null, ms: null, testDiagnosisAt: '2026-10-27T11:31:00Z' },
      now: NOW,
    })
    expect(rail.doneCount).toBe(p.required_complete)
    expect(rail.steps[3]).toMatchObject({ state: 'done', detail: 'A test bug so far; none from your app yet' })
    expect(rail.testDiagnosedAt).toBe('2026-10-27T11:31:00Z')
    expect(rail.next?.id).toBe('sdk')
  })

  it('never counts a heartbeat the server has not counted', () => {
    const p = project({ key: true, sdk: false, seenAt: '2026-10-27T11:58:00Z' })
    const rail = buildSetupRail({ project: p, ttfd: null, now: NOW })
    expect(rail.doneCount).toBe(p.required_complete)
    expect(rail.next?.id).toBe('sdk')
  })

  it('only an SDK heartbeat finishes the SDK step, and the heartbeat names its key and origin', () => {
    const rail = buildSetupRail({
      project: project({ key: true, sdk: true, seenAt: '2026-10-27T11:58:00Z', origin: 'https://app.example.com', keyLabel: 'web-prod' }),
      ttfd: { keyMintedAt: '2026-10-27T11:30:00Z', firstDiagnosisAt: null, ms: null },
      now: NOW,
    })
    expect(rail.steps[2]).toMatchObject({ state: 'done', detail: 'Last heard 2m ago' })
    // The step says when; the sentence says how, without repeating "2m ago" (round-3 review).
    expect(heartbeatSentence(rail.heartbeat)).toBe('Checks in with key “web-prod” from https://app.example.com.')
    expect(rail.next?.id).toBe('report')
  })

  it('all four done once a report from the app is diagnosed, with its id to open', () => {
    const rail = buildSetupRail({
      project: project({ key: true, sdk: true, report: true, seenAt: '2026-10-27T11:58:00Z' }),
      ttfd: { keyMintedAt: '2026-10-27T11:30:00Z', firstDiagnosisAt: '2026-10-27T11:40:00Z', ms: 600_000, firstReportId: 'r1', testDiagnosisAt: '2026-10-27T11:31:00Z' },
      now: NOW,
    })
    expect(rail.next).toBeNull()
    expect(rail.doneCount).toBe(4)
    expect(rail.firstReportId).toBe('r1')
    // A real report makes the test-only note irrelevant.
    expect(rail.testDiagnosedAt).toBeNull()
  })

  it('every step opens a real Set up tab', () => {
    const rail = buildSetupRail({ project: project(), ttfd: null, now: NOW })
    for (const step of rail.steps) expect(ONBOARDING_TAB_IDS as readonly string[]).toContain(step.tab)
  })

  it('with no heartbeat says so plainly, without blaming a deploy', () => {
    expect(heartbeatSentence(null)).toMatch(/^Mushi Mushi has not heard from your app yet\./)
    expect(heartbeatSentence(null)).not.toMatch(/heartbeat/i)
    expect(heartbeatSentence(null)).not.toMatch(/deploy|removed|cold/i)
  })
})

// Test it showed "346h 8m" beside "Target: under 2 minutes" (round-2 review).
describe('formatDiagnosisDuration', () => {
  it('reads seconds and minutes under an hour, hours under a day, days after', () => {
    expect(formatDiagnosisDuration(42_000)).toBe('42s')
    expect(formatDiagnosisDuration(108_000)).toBe('1m 48s')
    expect(formatDiagnosisDuration((3 * 60 + 5) * 60_000)).toBe('3h 5m')
    expect(formatDiagnosisDuration((346 * 60 + 8) * 60_000)).toBe('14 d')
  })
})

// "Created 19d ago" under "App created", "Made 19d ago" under "Key made".
describe('rail step lines', () => {
  it('give only when for the app and key, not the verb again', () => {
    const rail = buildSetupRail({ project: project({ key: true }), ttfd: { keyMintedAt: '2026-10-27T10:00:00Z' } as never, now: NOW })
    expect(rail.steps[0].detail).toBe('1h ago')
    expect(rail.steps[1].detail).toBe('2h ago')
  })
})
