/**
 * FILE: sdk-config-journeys.test.ts
 * PURPOSE: GET /v1/sdk/config carries the Journey optimizer's on-demand
 *          recording window only while it is open (ADR 0058), so SDKs in
 *          `trackSessions: 'on-demand'` mode record nobody outside it.
 */

import { describe, expect, it } from 'vitest'
import { journeyRecording, normalizeSdkConfig } from '../../supabase/functions/_shared/sdk-config.ts'

const NOW = new Date('2026-11-13T12:00:00Z')

describe('journey recording window in the SDK config', () => {
  it('is absent when no window was opened or it has ended', () => {
    expect(normalizeSdkConfig(null, { now: NOW })).not.toHaveProperty('journeys')
    expect(normalizeSdkConfig({ journey_recording_until: '2026-11-13T11:59:59Z', journey_recording_sample: 0.5 }, { now: NOW })).not.toHaveProperty('journeys')
  })

  it('carries the end time and sample rate while open', () => {
    const cfg = normalizeSdkConfig({ journey_recording_until: '2026-11-14T12:00:00Z', journey_recording_sample: 0.25 }, { now: NOW })
    expect(cfg).toMatchObject({ journeys: { recordUntil: '2026-11-14T12:00:00.000Z', sampleRate: 0.25 } })
  })

  it('falls back to 10% for a missing or invalid rate and caps at 100%', () => {
    expect(journeyRecording({ journey_recording_until: '2026-11-14T00:00:00Z', journey_recording_sample: null }, NOW).journeys?.sampleRate).toBe(0.1)
    expect(journeyRecording({ journey_recording_until: '2026-11-14T00:00:00Z', journey_recording_sample: 7 }, NOW).journeys?.sampleRate).toBe(1)
  })
})
