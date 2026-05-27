/**
 * FILE: autofix-toggle-contract.test.ts
 * PURPOSE: Tests for the POST /v1/admin/projects/:id/autofix/toggle contract.
 *          Covers GET + POST variants, owner/admin-only authz, bad-body
 *          validation, upsert semantics (works for legacy projects without a
 *          project_settings row), and audit log write.
 */

import { describe, it, expect } from 'vitest'

// ── In-memory representations ───────────────────────────────────────────────

type UserRole = 'owner' | 'admin' | 'member' | 'viewer'

interface ProjectSettings {
  project_id: string
  autofix_enabled: boolean
}

interface AuditEntry {
  project_id: string
  user_id: string
  action: string
  payload: Record<string, unknown>
}

class AutofixToggleHandler {
  settings = new Map<string, ProjectSettings>()
  members = new Map<string, Map<string, UserRole>>() // projectId -> userId -> role
  auditLog: AuditEntry[] = []

  addMember(projectId: string, userId: string, role: UserRole) {
    if (!this.members.has(projectId)) this.members.set(projectId, new Map())
    this.members.get(projectId)!.set(userId, role)
  }

  setSettings(projectId: string, enabled: boolean) {
    this.settings.set(projectId, { project_id: projectId, autofix_enabled: enabled })
  }

  getRole(projectId: string, userId: string): UserRole | null {
    return this.members.get(projectId)?.get(userId) ?? null
  }

  canWrite(role: UserRole | null): boolean {
    return role === 'owner' || role === 'admin'
  }

  get(projectId: string, userId: string): { ok: boolean; data?: { autofix_enabled: boolean }; error?: string; status: number } {
    const role = this.getRole(projectId, userId)
    if (!role) return { ok: false, error: 'FORBIDDEN', status: 403 }

    const s = this.settings.get(projectId)
    return {
      ok: true,
      data: { autofix_enabled: s?.autofix_enabled ?? false },
      status: 200,
    }
  }

  toggle(
    projectId: string,
    userId: string,
    body: unknown,
  ): { ok: boolean; data?: { autofix_enabled: boolean }; error?: string; status: number } {
    const role = this.getRole(projectId, userId)
    if (!role) return { ok: false, error: 'FORBIDDEN', status: 403 }
    if (!this.canWrite(role)) return { ok: false, error: 'FORBIDDEN — members cannot toggle autofix', status: 403 }

    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as Record<string, unknown>).enabled !== 'boolean'
    ) {
      return { ok: false, error: 'BAD_BODY — enabled (boolean) is required', status: 400 }
    }

    const { enabled } = body as { enabled: boolean }

    // Upsert semantics: works even when no project_settings row exists yet
    this.settings.set(projectId, { project_id: projectId, autofix_enabled: enabled })

    this.auditLog.push({
      project_id: projectId,
      user_id: userId,
      action: 'autofix.toggle',
      payload: { enabled },
    })

    return {
      ok: true,
      data: { autofix_enabled: enabled },
      status: 200,
    }
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('autofix-toggle-contract', () => {
  const PROJECT = 'proj-1'
  const OWNER = 'user-owner'
  const ADMIN = 'user-admin'
  const MEMBER = 'user-member'
  const STRANGER = 'user-stranger'

  function makeHandler() {
    const h = new AutofixToggleHandler()
    h.addMember(PROJECT, OWNER, 'owner')
    h.addMember(PROJECT, ADMIN, 'admin')
    h.addMember(PROJECT, MEMBER, 'member')
    return h
  }

  // ── GET ───────────────────────────────────────────────────────────────────

  describe('GET (read current value)', () => {
    it('returns 200 with autofix_enabled for a member', () => {
      const h = makeHandler()
      h.setSettings(PROJECT, true)
      const res = h.get(PROJECT, MEMBER)
      expect(res.ok).toBe(true)
      expect(res.status).toBe(200)
      expect(res.data?.autofix_enabled).toBe(true)
    })

    it('defaults to false when no project_settings row exists', () => {
      const h = makeHandler()
      const res = h.get(PROJECT, MEMBER)
      expect(res.ok).toBe(true)
      expect(res.data?.autofix_enabled).toBe(false)
    })

    it('returns 403 for a non-member', () => {
      const h = makeHandler()
      const res = h.get(PROJECT, STRANGER)
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403)
    })
  })

  // ── POST ─────────────────────────────────────────────────────────────────

  describe('POST (toggle)', () => {
    it('owner can enable autofix', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, OWNER, { enabled: true })
      expect(res.ok).toBe(true)
      expect(res.data?.autofix_enabled).toBe(true)
    })

    it('admin can toggle autofix', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, ADMIN, { enabled: true })
      expect(res.ok).toBe(true)
      expect(res.data?.autofix_enabled).toBe(true)
    })

    it('member is forbidden from toggling', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, MEMBER, { enabled: true })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403)
    })

    it('stranger is forbidden', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, STRANGER, { enabled: false })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403)
    })

    it('returns 400 when enabled field is missing', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, OWNER, {})
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
      expect(res.error).toContain('BAD_BODY')
    })

    it('returns 400 when enabled is not boolean', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, OWNER, { enabled: 'yes' })
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
    })

    it('returns 400 for null body', () => {
      const h = makeHandler()
      const res = h.toggle(PROJECT, OWNER, null)
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
    })

    it('upserts: works even when no project_settings row exists (legacy projects)', () => {
      const h = makeHandler()
      // No prior setSettings call — simulates a legacy project with no row
      const res = h.toggle(PROJECT, OWNER, { enabled: true })
      expect(res.ok).toBe(true)
      expect(res.data?.autofix_enabled).toBe(true)
      // Verify the in-memory store was updated
      expect(h.settings.get(PROJECT)?.autofix_enabled).toBe(true)
    })

    it('writes an audit log entry on toggle', () => {
      const h = makeHandler()
      h.toggle(PROJECT, OWNER, { enabled: true })
      expect(h.auditLog).toHaveLength(1)
      const entry = h.auditLog[0]
      expect(entry.action).toBe('autofix.toggle')
      expect(entry.payload.enabled).toBe(true)
      expect(entry.project_id).toBe(PROJECT)
      expect(entry.user_id).toBe(OWNER)
    })

    it('does not write audit log on forbidden requests', () => {
      const h = makeHandler()
      h.toggle(PROJECT, MEMBER, { enabled: true })
      expect(h.auditLog).toHaveLength(0)
    })

    it('can toggle off again', () => {
      const h = makeHandler()
      h.toggle(PROJECT, OWNER, { enabled: true })
      const res = h.toggle(PROJECT, ADMIN, { enabled: false })
      expect(res.ok).toBe(true)
      expect(res.data?.autofix_enabled).toBe(false)
      expect(h.settings.get(PROJECT)?.autofix_enabled).toBe(false)
    })
  })
})
