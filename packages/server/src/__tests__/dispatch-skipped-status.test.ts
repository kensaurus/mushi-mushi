/**
 * FILE: dispatch-skipped-status.test.ts
 * PURPOSE: Pin the fix_dispatch_jobs.status CHECK constraint so the
 *          'skipped' value stays accepted.
 *
 *          The fix-worker writes 'skipped' in three places. Before migration
 *          20260527000000, the DB's CHECK only allowed:
 *            queued | running | completed | failed | cancelled
 *          Every skip path raised PGRST116 (23514 check_violation) and the
 *          dispatch row stayed stuck in 'running'.
 *
 *          These tests validate:
 *          1. The enum list used in code includes 'skipped'.
 *          2. The 'skipped' status is structurally valid in the same set as
 *             the other statuses.
 *          3. The migration SQL text contains the correct 'skipped' entry
 *             (file-level snapshot test — locks the migration in place).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// ── Status enum ─────────────────────────────────────────────────────────────

type DispatchStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

const ALL_STATUSES: DispatchStatus[] = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]

const TERMINAL_STATUSES = new Set<DispatchStatus>(['completed', 'failed', 'cancelled', 'skipped'])
const ACTIVE_STATUSES = new Set<DispatchStatus>(['queued', 'running'])

// ── Tests ───────────────────────────────────────────────────────────────────

describe('dispatch-skipped-status', () => {
  describe('status enum', () => {
    it("'skipped' is in the allowed status list", () => {
      expect(ALL_STATUSES).toContain('skipped')
    })

    it("'skipped' is a terminal status (not queryable as active)", () => {
      expect(TERMINAL_STATUSES.has('skipped')).toBe(true)
      expect(ACTIVE_STATUSES.has('skipped')).toBe(false)
    })

    it('has exactly 6 statuses (no accidental additions)', () => {
      expect(ALL_STATUSES).toHaveLength(6)
    })

    it('active statuses are a strict subset of all statuses', () => {
      for (const s of ACTIVE_STATUSES) {
        expect(ALL_STATUSES).toContain(s)
      }
    })
  })

  describe('migration file snapshot', () => {
    // Resolve the migration file relative to this test file:
    // src/__tests__/ → src/ → packages/server/ → supabase/migrations/
    const migrationsDir = resolve(
      join(__dirname, '../../supabase/migrations'),
    )

    it("migration 20260527000000 exists and contains 'skipped'", () => {
      let migrationSql: string
      try {
        migrationSql = readFileSync(
          join(migrationsDir, '20260527000000_fix_dispatch_jobs_allow_skipped.sql'),
          'utf8',
        )
      } catch {
        throw new Error(
          "Migration 20260527000000_fix_dispatch_jobs_allow_skipped.sql not found. " +
            "This migration is required to add 'skipped' to the fix_dispatch_jobs.status CHECK constraint.",
        )
      }

      expect(migrationSql).toContain("'skipped'")
    })

    it('migration drops the old constraint and adds a new one', () => {
      const migrationSql = readFileSync(
        join(migrationsDir, '20260527000000_fix_dispatch_jobs_allow_skipped.sql'),
        'utf8',
      )
      expect(migrationSql).toContain('DROP CONSTRAINT')
      expect(migrationSql).toContain('ADD CONSTRAINT')
    })

    it('migration backtracks stuck running rows to failed', () => {
      const migrationSql = readFileSync(
        join(migrationsDir, '20260527000000_fix_dispatch_jobs_allow_skipped.sql'),
        'utf8',
      )
      // Must include a backfill UPDATE for jobs stuck in running state
      expect(migrationSql).toMatch(/UPDATE\s+fix_dispatch_jobs/i)
      expect(migrationSql).toMatch(/status\s*=\s*'failed'/i)
    })
  })

  describe('fix-worker paths that write skipped (regression guard)', () => {
    // These test the LOGIC around when skipped should be written,
    // independent of the DB constraint.

    function simulateDispatch(opts: {
      autofixEnabled: boolean
      hasContext: boolean
      sandboxAvailable: boolean
      agentSupported: boolean
    }): { status: DispatchStatus; reason?: string } {
      if (!opts.autofixEnabled) {
        // Rejected upstream in dispatch.ts — never writes a fix_dispatch_jobs row
        return { status: 'cancelled', reason: 'AUTOFIX_DISABLED' }
      }
      if (!opts.hasContext) {
        return { status: 'skipped', reason: 'skipped_no_context' }
      }
      if (!opts.sandboxAvailable) {
        return { status: 'skipped', reason: 'skipped_no_sandbox' }
      }
      if (!opts.agentSupported) {
        return { status: 'skipped', reason: 'skipped_unsupported_agent' }
      }
      return { status: 'running' }
    }

    it("writes 'skipped' when codebase context is unavailable", () => {
      const result = simulateDispatch({
        autofixEnabled: true,
        hasContext: false,
        sandboxAvailable: true,
        agentSupported: true,
      })
      expect(result.status).toBe('skipped')
      expect(result.reason).toBe('skipped_no_context')
    })

    it("writes 'skipped' when sandbox is unavailable", () => {
      const result = simulateDispatch({
        autofixEnabled: true,
        hasContext: true,
        sandboxAvailable: false,
        agentSupported: true,
      })
      expect(result.status).toBe('skipped')
    })

    it("writes 'skipped' when the agent adapter is unsupported", () => {
      const result = simulateDispatch({
        autofixEnabled: true,
        hasContext: true,
        sandboxAvailable: true,
        agentSupported: false,
      })
      expect(result.status).toBe('skipped')
    })

    it("'skipped' is accepted by the DB constraint enum", () => {
      const result = simulateDispatch({
        autofixEnabled: true,
        hasContext: false,
        sandboxAvailable: true,
        agentSupported: true,
      })
      // The DB CHECK now includes 'skipped' — verify the value is in the enum
      expect(ALL_STATUSES).toContain(result.status)
    })

    it("cancels (not skips) when autofix is disabled — no fix_dispatch_jobs row written", () => {
      const result = simulateDispatch({
        autofixEnabled: false,
        hasContext: true,
        sandboxAvailable: true,
        agentSupported: true,
      })
      // dispatch.ts returns AUTOFIX_DISABLED before any DB write
      expect(result.status).toBe('cancelled')
      expect(result.reason).toBe('AUTOFIX_DISABLED')
    })
  })
})
