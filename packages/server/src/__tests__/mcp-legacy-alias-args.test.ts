/**
 * FILE: mcp-legacy-alias-args.test.ts
 * PURPOSE: The deprecated diagnose_setup aliases keep their old scope. The
 *          shim used to forward args unchanged, so ingest_setup_check ran
 *          diagnose_setup's default 'full' mode, dispatch preflight included.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { legacyAliasArgs } from '../../supabase/functions/mcp/legacy-alias-args.ts'
import { DEPRECATED_TOOL_ALIASES } from '../../supabase/functions/mcp/feature-groups.ts'

describe('legacyAliasArgs', () => {
  it('runs ingest_setup_check as an ingest-only check', () => {
    expect(legacyAliasArgs('ingest_setup_check', {})).toEqual({ mode: 'ingest' })
  })

  it('runs setup_check as the dispatch-readiness check, keeping the project id', () => {
    expect(legacyAliasArgs('setup_check', { projectId: 'p1' })).toEqual({ projectId: 'p1', mode: 'dispatch' })
  })

  it('leaves diagnose_connection on the full check (health + ingest + dispatch)', () => {
    expect(legacyAliasArgs('diagnose_connection', {})).toEqual({})
  })

  it('lets an explicit mode from the caller win', () => {
    expect(legacyAliasArgs('ingest_setup_check', { mode: 'full' })).toEqual({ mode: 'full' })
  })

  it('passes other aliases through untouched', () => {
    const args = { reportId: 'r1' }
    expect(legacyAliasArgs('fix_suggest', args)).toBe(args)
  })

  it('only names real diagnose_setup aliases', () => {
    for (const name of ['setup_check', 'ingest_setup_check']) {
      expect(DEPRECATED_TOOL_ALIASES[name]).toBe('diagnose_setup')
    }
  })
})

describe('hosted alias shim wiring', () => {
  it('hands the successor the alias-adjusted args', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/mcp/index.ts'), 'utf8')
    expect(src).toMatch(/await target\.handler\(legacyAliasArgs\(oldName, args\), ctx\)/)
  })
})
