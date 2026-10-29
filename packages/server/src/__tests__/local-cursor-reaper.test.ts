/**
 * FILE: packages/server/src/__tests__/local-cursor-reaper.test.ts
 * PURPOSE: The stuck-attempt reaper gives mushi work's local-cursor rows the
 *          same 90 minute window as mcp, or a live local run is marked dead.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('fix_attempts_stuck_reaper local-cursor window', () => {
  it('waits 90 minutes for local-cursor as well as mcp', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261030120000_local_cursor_reaper_window.sql'),
      'utf8',
    )
    expect(sql).toContain("fa.agent IN ('mcp', 'local-cursor')")
    expect(sql).toContain("CASE WHEN fa.agent IN ('mcp', 'local-cursor') THEN interval '90 minutes'")
  })
})
