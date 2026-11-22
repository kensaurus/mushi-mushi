import { describe, expect, it } from 'vitest'
import { consoleBuild, formatStamp, modeLabel, parseHealth } from './buildInfo'

describe('formatStamp', () => {
  it('shows the build to the minute in the given zone', () => {
    expect(formatStamp('2026-11-19T05:32:10.000Z', 'Asia/Tokyo')).toBe('2026-11-19 14:32 GMT+9')
    expect(formatStamp('2026-11-19T05:32:10.000Z', 'UTC')).toBe('2026-11-19 05:32 UTC')
  })

  it('returns null for a missing or broken instant', () => {
    expect(formatStamp(null)).toBeNull()
    expect(formatStamp('not a date')).toBeNull()
  })
})

describe('parseHealth', () => {
  it('reads the server mode, version and deploy time', () => {
    expect(parseHealth({ status: 'ok', version: 'abc1234', deployed_at: '2026-11-19T01:00:00Z', mode: 'self-hosted' })).toEqual({
      mode: 'self-hosted',
      version: 'abc1234',
      deployedAt: '2026-11-19T01:00:00Z',
    })
  })

  it('returns null when an older server sends no mode', () => {
    expect(parseHealth({ status: 'ok', version: 'dev' })).toBeNull()
    expect(parseHealth(null)).toBeNull()
  })
})

describe('consoleBuild', () => {
  it('falls back when the Vite defines are absent (tests)', () => {
    const b = consoleBuild()
    expect(typeof b.version).toBe('string')
    expect(typeof b.sha).toBe('string')
  })
})

it('labels modes in plain words', () => {
  expect(modeLabel('hosted')).toBe('Hosted')
  expect(modeLabel('self-hosted')).toBe('Self-hosted')
})
