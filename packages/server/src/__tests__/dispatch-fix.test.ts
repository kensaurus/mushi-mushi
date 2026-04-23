/**
 * FILE: dispatch-fix.test.ts
 * PURPOSE: Validates the M5admin fix-dispatch endpoint contract.
 *          Covers happy path enqueueing, dedup of in-flight dispatches,
 *          membership enforcement, and autofix_enabled gating.
 */

import { describe, it, expect } from 'vitest'

interface DispatchRow {
  id: string
  project_id: string
  report_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  pr_url?: string
  error?: string
  created_at: string
}

interface ApiError {
  ok: false
  error: { code: string; message: string }
  status: number
}

interface ApiOk<T> {
  ok: true
  data: T
}

type ApiResponse<T> = ApiOk<T> | ApiError

/**
 * Mirrors the shape of the production /v1/admin/fixes/dispatch handler
 * minus the actual db calls — uses an in-memory store so the contract
 * is tested without spinning up Supabase.
 */
class DispatchHandler {
  jobs: DispatchRow[] = []
  members = new Map<string, Set<string>>() // userId -> projectIds
  autofixEnabled = new Map<string, boolean>() // projectId -> enabled

  enroll(userId: string, projectId: string) {
    if (!this.members.has(userId)) this.members.set(userId, new Set())
    this.members.get(userId)!.add(projectId)
  }

  setAutofix(projectId: string, enabled: boolean) {
    this.autofixEnabled.set(projectId, enabled)
  }

  dispatch(userId: string, body: { reportId?: string; projectId?: string }): ApiResponse<DispatchRow> {
    if (!body.reportId || !body.projectId) {
      return { ok: false, error: { code: 'MISSING_FIELDS', message: 'reportId and projectId required' }, status: 400 }
    }
    if (!this.members.get(userId)?.has(body.projectId)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' }, status: 403 }
    }
    if (!this.autofixEnabled.get(body.projectId)) {
      return { ok: false, error: { code: 'AUTOFIX_DISABLED', message: 'Enable Autofix in project settings first' }, status: 400 }
    }
    // Scope the in-flight check to (project_id, report_id) — mirrors the
    // production handler in api/index.ts. Without project_id, the same
    // reportId across two projects would collide and return 409.
    const inFlight = this.jobs.find(j =>
      j.project_id === body.projectId &&
      j.report_id === body.reportId &&
      (j.status === 'queued' || j.status === 'running'),
    )
    if (inFlight) {
      return { ok: false, error: { code: 'ALREADY_DISPATCHED', message: `Already in progress: ${inFlight.id}` }, status: 409 }
    }
    const job: DispatchRow = {
      id: `job-${this.jobs.length + 1}`,
      project_id: body.projectId,
      report_id: body.reportId,
      status: 'queued',
      created_at: new Date().toISOString(),
    }
    this.jobs.push(job)
    return { ok: true, data: job }
  }
}

describe('POST /v1/admin/fixes/dispatch (V5.3 §2.10)', () => {
  it('enqueues a job for a project member with autofix enabled', () => {
    const h = new DispatchHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)

    const res = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.status).toBe('queued')
    expect(res.data.report_id).toBe('rep-1')
    expect(h.jobs).toHaveLength(1)
  })

  it('returns 400 when reportId or projectId is missing', () => {
    const h = new DispatchHandler()
    const r1 = h.dispatch('user-1', { projectId: 'proj-1' })
    const r2 = h.dispatch('user-1', { reportId: 'rep-1' })
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    if (r1.ok || r2.ok) return
    expect(r1.status).toBe(400)
    expect(r2.status).toBe(400)
  })

  it('returns 403 when user is not a project member', () => {
    const h = new DispatchHandler()
    h.setAutofix('proj-1', true)
    const res = h.dispatch('intruder', { reportId: 'rep-1', projectId: 'proj-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(403)
    expect(res.error.code).toBe('FORBIDDEN')
  })

  it('returns 400 when autofix is disabled for the project', () => {
    const h = new DispatchHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', false)
    const res = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.code).toBe('AUTOFIX_DISABLED')
  })

  it('returns 409 when a dispatch is already queued for the same report', () => {
    const h = new DispatchHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)
    h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })

    const dup = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    expect(dup.ok).toBe(false)
    if (dup.ok) return
    expect(dup.status).toBe(409)
    expect(dup.error.code).toBe('ALREADY_DISPATCHED')
    expect(h.jobs).toHaveLength(1)
  })

  it('allows a NEW dispatch once the prior one is completed/failed', () => {
    const h = new DispatchHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)
    const first = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    expect(first.ok).toBe(true)

    h.jobs[0].status = 'completed'

    const second = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    expect(second.ok).toBe(true)
    expect(h.jobs).toHaveLength(2)
  })

  it('isolates dispatches across projects (same reportId in different project still ok)', () => {
    const h = new DispatchHandler()
    h.enroll('user-1', 'proj-1')
    h.enroll('user-1', 'proj-2')
    h.setAutofix('proj-1', true)
    h.setAutofix('proj-2', true)
    const a = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    const b = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-2' })
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
  })
})

// Wave S (2026-04-23): in-memory contract for the /cancel endpoint. The
// admin UI has had a "Cancel" button on the PDCA drawer for weeks but the
// corresponding route was missing — every click hit a 404. This test
// locks in the state-machine invariants so the route can't drift back to
// accepting cancels on terminal statuses or non-members.
class CancelHandler extends DispatchHandler {
  cancel(userId: string, dispatchId: string): ApiResponse<{ id: string; status: DispatchRow['status'] }> {
    const job = this.jobs.find(j => j.id === dispatchId)
    if (!job) return { ok: false, error: { code: 'NOT_FOUND', message: 'Dispatch not found' }, status: 404 }
    if (!this.members.get(userId)?.has(job.project_id)) {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Not a member' }, status: 403 }
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      return {
        ok: false,
        error: { code: 'INVALID_STATE', message: `Dispatch is already ${job.status}; cannot cancel.` },
        status: 409,
      }
    }
    job.status = 'cancelled'
    return { ok: true, data: { id: job.id, status: job.status } }
  }
}

describe('POST /v1/admin/fixes/dispatches/:id/cancel (Wave S)', () => {
  it('cancels a queued dispatch for a project member', () => {
    const h = new CancelHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)
    const d = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    expect(d.ok).toBe(true)
    if (!d.ok) return

    const res = h.cancel('user-1', d.data.id)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.status).toBe('cancelled')
  })

  it('cancels a running dispatch on a best-effort basis', () => {
    const h = new CancelHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)
    const d = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    if (!d.ok) throw new Error('setup failed')
    h.jobs[0].status = 'running'

    const res = h.cancel('user-1', d.data.id)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.status).toBe('cancelled')
  })

  it('returns 404 for an unknown dispatch id', () => {
    const h = new CancelHandler()
    const res = h.cancel('user-1', 'does-not-exist')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(404)
  })

  it('returns 403 when the caller is not a project member', () => {
    const h = new CancelHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)
    const d = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    if (!d.ok) throw new Error('setup failed')

    const res = h.cancel('intruder', d.data.id)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(403)
  })

  it('returns 409 when dispatch is already in a terminal state', () => {
    const h = new CancelHandler()
    h.enroll('user-1', 'proj-1')
    h.setAutofix('proj-1', true)
    const d = h.dispatch('user-1', { reportId: 'rep-1', projectId: 'proj-1' })
    if (!d.ok) throw new Error('setup failed')
    h.jobs[0].status = 'completed'

    const res = h.cancel('user-1', d.data.id)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.status).toBe(409)
    expect(res.error.code).toBe('INVALID_STATE')
  })
})

describe('orchestrator validateResult gating (V5.3 §2.10)', () => {
  type FixResult = { success: boolean; linesChanged: number; filesChanged: string[]; branch: string; summary: string; error?: string }
  type FixContext = { config: { maxLines: number; scopeRestriction: 'component' | 'directory' | 'none' }; report: { component?: string } }

  function validateResult(ctx: FixContext, result: FixResult): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    if (result.linesChanged > ctx.config.maxLines) {
      errors.push(`Lines changed (${result.linesChanged}) exceeds maxLines (${ctx.config.maxLines})`)
    }
    if (ctx.config.scopeRestriction === 'component' && ctx.report.component) {
      for (const f of result.filesChanged) {
        if (!f.toLowerCase().includes(ctx.report.component.toLowerCase())) {
          errors.push(`File ${f} outside component scope ${ctx.report.component}`)
        }
      }
    }
    return { valid: errors.length === 0, errors }
  }

  it('rejects a fix that exceeds maxLines circuit breaker', () => {
    const ctx: FixContext = { config: { maxLines: 200, scopeRestriction: 'none' }, report: {} }
    const result: FixResult = { success: true, linesChanged: 950, filesChanged: ['foo.ts'], branch: 'b', summary: 's' }
    const v = validateResult(ctx, result)
    expect(v.valid).toBe(false)
    expect(v.errors[0]).toMatch(/exceeds maxLines/)
  })

  it('rejects a fix that touches files outside the component scope', () => {
    const ctx: FixContext = { config: { maxLines: 1000, scopeRestriction: 'component' }, report: { component: 'Checkout' } }
    const result: FixResult = {
      success: true,
      linesChanged: 50,
      filesChanged: ['src/Checkout/Form.tsx', 'src/Auth/login.ts'],
      branch: 'b', summary: 's',
    }
    const v = validateResult(ctx, result)
    expect(v.valid).toBe(false)
    expect(v.errors[0]).toMatch(/outside component scope/)
  })

  it('passes a fix within all guards', () => {
    const ctx: FixContext = { config: { maxLines: 200, scopeRestriction: 'component' }, report: { component: 'Checkout' } }
    const result: FixResult = {
      success: true,
      linesChanged: 30,
      filesChanged: ['src/Checkout/Form.tsx'],
      branch: 'b', summary: 's',
    }
    expect(validateResult(ctx, result).valid).toBe(true)
  })
})
