/**
 * sanitizeSql stripped `--.*$` and block comments without regard to string
 * literals, so `LIKE '%--%'` was cut mid-string and a `;` inside a literal was
 * read as a second statement. Comments are now removed by a literal-aware
 * scan that still fails closed, and the tenant ($1) and multi-statement
 * checks only look at code outside comments and literals.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => { throw new Error('no real db') } }))

const { sanitizeSql } = await import('../../supabase/functions/_shared/nl-query.ts')

describe('sanitizeSql literals and comments', () => {
  it('keeps -- and ; inside string literals', () => {
    const out = sanitizeSql("SELECT id FROM reports WHERE summary LIKE '%--%' AND title <> 'a;b' AND project_id = $1 LIMIT 5")
    expect(out).toBe("SELECT id FROM reports WHERE summary LIKE '%--%' AND title <> 'a;b' AND project_id = $1 LIMIT 5")
  })

  it('handles doubled quotes inside a literal', () => {
    const out = sanitizeSql("SELECT id FROM reports WHERE title = 'it''s -- fine' AND project_id = $1 LIMIT 1")
    expect(out).toContain("'it''s -- fine'")
  })

  it('still strips real comments and appends LIMIT', () => {
    const out = sanitizeSql('SELECT id FROM reports -- note\nWHERE project_id = $1 /* x */;')
    expect(out).toBe('SELECT id FROM reports \nWHERE project_id = $1\nLIMIT 100')
  })

  it('does not accept $1 or LIMIT hidden in a comment or a literal', () => {
    expect(() => sanitizeSql("SELECT id FROM reports /* $1 */ WHERE severity = 'critical'")).toThrow(/\$1/)
    expect(() => sanitizeSql("SELECT id FROM reports WHERE summary = '$1'")).toThrow(/\$1/)
    expect(sanitizeSql("SELECT id FROM reports WHERE project_id = $1 AND title = 'limit'")).toMatch(/\nLIMIT 100$/)
  })

  it('rejects a real second statement and anything it cannot scan exactly', () => {
    expect(() => sanitizeSql('SELECT id FROM reports WHERE project_id = $1; SELECT 1')).toThrow(/Multi-statement/)
    expect(() => sanitizeSql("SELECT id FROM reports WHERE project_id = $1 AND title = 'open")).toThrow(/Unterminated string/)
    expect(() => sanitizeSql('SELECT id FROM reports WHERE project_id = $1 /* open')).toThrow(/Unterminated block comment/)
    expect(() => sanitizeSql('SELECT $$;$$ FROM reports WHERE project_id = $1')).toThrow(/Dollar-quoted/)
    expect(() => sanitizeSql("SELECT id FROM reports WHERE project_id = $1 AND title = E'\\';' ")).toThrow(/Escape strings/)
  })
})
