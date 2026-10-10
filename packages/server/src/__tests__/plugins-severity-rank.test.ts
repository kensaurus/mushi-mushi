/**
 * The Cursor plugin severity gate checked `cfg.severity_threshold in
 * CURSOR_SEVERITY_RANK`, and the notification mute gate indexed the same plain
 * object. "toString" or "constructor" passed both and ranked as a function, so
 * `rank < minRank` was always false: every classified report dispatched a
 * Cursor agent and nothing was muted. Lookups now go through
 * cursorSeverityRank, which only accepts own keys.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})

const { cursorSeverityRank } = await import('../../supabase/functions/_shared/plugins.ts')

describe('cursorSeverityRank', () => {
  it('ranks the four severities', () => {
    expect(['low', 'medium', 'high', 'critical'].map(cursorSeverityRank)).toEqual([1, 2, 3, 4])
  })

  it('rejects prototype names and non-strings', () => {
    for (const v of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'urgent', '', null, undefined, 4]) {
      expect(cursorSeverityRank(v)).toBeUndefined()
    }
  })

  it('is the only way plugins.ts reads the rank table', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/plugins.ts'), 'utf8')
    expect(src).not.toMatch(/\bin CURSOR_SEVERITY_RANK\b/)
    expect(src.match(/CURSOR_SEVERITY_RANK\[/g) ?? []).toHaveLength(1) // inside the helper
  })
})
