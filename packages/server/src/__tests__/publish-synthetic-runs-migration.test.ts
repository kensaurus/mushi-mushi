/**
 * ALTER PUBLICATION ... ADD TABLE raises when the publication is missing
 * (self-host without Realtime) or already carries the table (42710), so
 * 20260520930000 guards on both, like 20260912009000 does for
 * voice_intake_sessions.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20260520930000_publish_synthetic_runs_realtime.sql'),
  'utf8',
).replace(/--[^\n]*/g, '')

describe('20260520930000_publish_synthetic_runs_realtime', () => {
  it('adds synthetic_runs only when the publication exists and lacks it', () => {
    const add = sql.indexOf('ALTER PUBLICATION supabase_realtime ADD TABLE public.synthetic_runs')
    expect(add).toBeGreaterThan(0)
    const guard = sql.slice(0, add)
    expect(guard).toMatch(/EXISTS \(\s*SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'\s*\)/)
    expect(guard).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM pg_publication_tables[\s\S]*tablename = 'synthetic_runs'\s*\)/)
  })
})
