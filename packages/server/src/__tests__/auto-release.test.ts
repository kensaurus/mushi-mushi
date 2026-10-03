/**
 * FILE: auto-release.test.ts
 * PURPOSE: Opt-in "release without manual steps" (gap #15). A GitHub release
 *          published, a successful production deployment_status, or a
 *          release.published recipe event drafts and publishes a Mushi
 *          release, which messages each reporter. Default OFF; never an empty
 *          release; never twice for one version; one automatic draft at a time.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import { createFakeDb } from './__stubs__/fake-query-recorder.ts'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})
vi.mock('../../supabase/functions/_shared/release-publish.ts', () => ({
  publishRelease: vi.fn(async () => ({ ok: false, status: 500, error: 'real publish must not run here' })),
}))

import {
  runAutoRelease,
  triggerFromGithubDeploymentStatus,
  triggerFromGithubRelease,
  type AutoReleaseDeps,
} from '../../supabase/functions/_shared/auto-release.ts'

const FUNCTIONS = resolve(__dirname, '../../supabase/functions')
const P = 'p1'
const NOW = new Date('2026-10-03T12:00:00Z')

const DELIVERY = {
  reports_listed: 1, reports_resolved: 1, reports_not_found: 0, reports_skipped_dismissed: 0,
  reporters_notified: 1, reporters_held: 0, reporters_failed: 0, reports_without_reporter: 0,
  credits_stamped: 1, credits_pending: 0,
}

function deps(overrides: Partial<AutoReleaseDeps> = {}) {
  const draft = vi.fn(async () => ({ ok: true as const, releaseId: 'rel-new', reportCount: 1 }))
  const publish = vi.fn(async () => ({
    ok: true as const,
    release: { id: 'rel-new', project_id: P, version: '1.4.0', published_at: NOW.toISOString() },
    notified: 1,
    ticketsFulfilled: 0,
    delivery: DELIVERY,
  }))
  return { draft, publish, now: () => NOW, ...overrides }
}

function seed(opts: { enabled?: boolean; releases?: Array<Record<string, unknown>>; reports?: Array<Record<string, unknown>> } = {}) {
  return makeFakeDb({
    project_settings: [{ project_id: P, auto_release_enabled: opts.enabled ?? true }],
    releases: opts.releases ?? [],
    reports: opts.reports ?? [
      { id: 'r1', project_id: P, status: 'fixed', fixed_release_id: null, updated_at: '2026-10-02T09:00:00Z' },
    ],
  })
}

describe('trigger parsing', () => {
  it('a published, final GitHub release is a ship; drafts, prereleases and other actions are not', () => {
    expect(triggerFromGithubRelease({ action: 'published', release: { tag_name: 'v1.4.0', name: 'Autumn fixes' } })).toEqual({
      source: 'github_release',
      version: 'v1.4.0',
      title: 'Autumn fixes',
      commit: null,
    })
    expect(triggerFromGithubRelease({ action: 'published', release: { tag_name: 'v1.5.0-rc.1', prerelease: true } })).toBeNull()
    expect(triggerFromGithubRelease({ action: 'published', release: { tag_name: 'v1', draft: true } })).toBeNull()
    expect(triggerFromGithubRelease({ action: 'created', release: { tag_name: 'v1.4.0' } })).toBeNull()
    expect(triggerFromGithubRelease({ action: 'published', release: { tag_name: '  ' } })).toBeNull()
  })

  it('only a successful production deployment is a ship; the version is the tag or the short sha', () => {
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'
    expect(
      triggerFromGithubDeploymentStatus({
        deployment_status: { state: 'success', environment: 'Production' },
        deployment: { sha, ref: 'main' },
      }),
    ).toEqual({ source: 'github_deployment', version: 'a1b2c3d', title: 'Deployed a1b2c3d', commit: sha })
    expect(
      triggerFromGithubDeploymentStatus({
        deployment_status: { state: 'success' },
        deployment: { sha, ref: 'v2.0.1', environment: 'web', production_environment: true },
      }),
    ).toMatchObject({ version: 'v2.0.1', commit: sha })
    expect(
      triggerFromGithubDeploymentStatus({ deployment_status: { state: 'success', environment: 'Preview' }, deployment: { sha } }),
    ).toBeNull()
    expect(
      triggerFromGithubDeploymentStatus({ deployment_status: { state: 'failure', environment: 'production' }, deployment: { sha } }),
    ).toBeNull()
  })
})

describe('runAutoRelease', () => {
  const trigger = { source: 'github_release' as const, version: '1.4.0' }

  it('does nothing unless the project opted in (default OFF)', async () => {
    const d = deps()
    expect(await runAutoRelease(seed({ enabled: false }) as never, P, trigger, d)).toEqual({ status: 'disabled' })
    const noRow = makeFakeDb({ project_settings: [] })
    expect(await runAutoRelease(noRow as never, P, trigger, d)).toEqual({ status: 'disabled' })
    expect(d.draft).not.toHaveBeenCalled()
  })

  it('treats an unreadable setting (column not migrated yet) as off', async () => {
    const { db } = createFakeDb((q) =>
      q.table === 'project_settings' ? { error: { code: '42703', message: 'column auto_release_enabled does not exist' } } : { data: null },
    )
    const d = deps()
    expect(await runAutoRelease(db, P, trigger, d)).toEqual({ status: 'disabled' })
    expect(d.draft).not.toHaveBeenCalled()
  })

  it('never releases the same version twice', async () => {
    const d = deps()
    const db = seed({ releases: [{ id: 'rel-old', project_id: P, version: '1.4.0', status: 'published', published_at: '2026-10-01T00:00:00Z' }] })
    expect(await runAutoRelease(db as never, P, trigger, d)).toEqual({ status: 'duplicate', releaseId: 'rel-old' })
    expect(d.draft).not.toHaveBeenCalled()
  })

  it('skips the release when nothing was fixed since the last published one', async () => {
    const d = deps()
    const db = seed({
      releases: [{ id: 'rel-old', project_id: P, version: '1.3.0', status: 'published', published_at: '2026-10-02T12:00:00Z' }],
      reports: [
        { id: 'r1', project_id: P, status: 'fixed', fixed_release_id: null, updated_at: '2026-10-02T09:00:00Z' },
        { id: 'r2', project_id: P, status: 'fixed', fixed_release_id: 'rel-old', updated_at: '2026-10-03T09:00:00Z' },
        { id: 'r3', project_id: P, status: 'new', fixed_release_id: null, updated_at: '2026-10-03T09:00:00Z' },
      ],
    })
    expect(await runAutoRelease(db as never, P, trigger, d)).toEqual({ status: 'nothing_to_release' })
    expect(d.draft).not.toHaveBeenCalled()
  })

  it('drafts from the last published release and publishes as the system actor', async () => {
    const d = deps()
    const db = seed({
      releases: [{ id: 'rel-old', project_id: P, version: '1.3.0', status: 'published', published_at: '2026-10-01T00:00:00Z' }],
    })
    const out = await runAutoRelease(db as never, P, trigger, d)
    expect(out).toEqual({ status: 'published', releaseId: 'rel-new', delivery: DELIVERY })
    expect(d.draft).toHaveBeenCalledWith({
      project_id: P,
      version: '1.4.0',
      title: 'v1.4.0',
      window_start: '2026-10-01T00:00:00Z',
      auto_source: 'github_release',
    })
    expect(d.publish).toHaveBeenCalledWith(db, 'rel-new', { kind: 'system', id: 'auto-release:github_release' })
  })

  it('with no earlier release, looks back 30 days like release-builder', async () => {
    const d = deps()
    await runAutoRelease(seed() as never, P, { source: 'recipe_event', version: 'v9.0.0', title: 'Big one' }, d)
    expect(d.draft).toHaveBeenCalledWith(
      expect.objectContaining({ window_start: '2026-09-03T12:00:00.000Z', title: 'Big one', auto_source: 'recipe_event' }),
    )
  })

  it('a concurrent automatic draft (409 from release-builder) is reported, not retried or published', async () => {
    const d = deps({ draft: vi.fn(async () => ({ ok: false as const, busy: true, error: 'open' })) })
    expect(await runAutoRelease(seed() as never, P, trigger, d)).toEqual({ status: 'draft_in_progress' })
    expect(d.publish).not.toHaveBeenCalled()
  })

  it('drops an empty draft when another release took the reports first', async () => {
    const db = seed()
    db.table('releases').push({ id: 'rel-empty', project_id: P, version: '1.4.0-x', status: 'draft' })
    const d = deps({ draft: vi.fn(async () => ({ ok: true as const, releaseId: 'rel-empty', reportCount: 0 })) })
    expect(await runAutoRelease(db as never, P, trigger, d)).toEqual({ status: 'nothing_to_release' })
    expect(db.table('releases').find((r) => r.id === 'rel-empty')).toBeUndefined()
    expect(d.publish).not.toHaveBeenCalled()
  })

  it('refuses a version that is not a plain tag / semver / sha (it reaches every reporter)', async () => {
    const d = deps()
    for (const version of ['', '   ', 'v1 <script>', 'see https://evil.example', 'x'.repeat(65), '-1.0']) {
      const out = await runAutoRelease(seed() as never, P, { source: 'recipe_event', version }, d)
      expect(out.status).toBe('failed')
    }
    expect(d.draft).not.toHaveBeenCalled()
    expect((await runAutoRelease(seed() as never, P, { source: 'recipe_event', version: '2026.10.03+build.7' }, d)).status).toBe('published')
  })

  it('a failed publish keeps the draft for a person and says so', async () => {
    const d = deps({ publish: vi.fn(async () => ({ ok: false as const, status: 500 as const, error: 'release published, but x' })) })
    expect(await runAutoRelease(seed() as never, P, trigger, d)).toEqual({
      status: 'failed',
      error: 'release published, but x',
      releaseId: 'rel-new',
    })
  })
})

describe('wiring', () => {
  it('the GitHub App webhook routes release + deployment_status to auto-release without requiring indexing', () => {
    const src = readFileSync(resolve(FUNCTIONS, 'webhooks-github-indexer/index.ts'), 'utf-8')
    const block = src.slice(src.indexOf("if (event === 'release' || event === 'deployment_status')"), src.indexOf("if (event !== 'push'"))
    expect(block).toContain('triggerFromGithubRelease(shipPayload)')
    expect(block).toContain('triggerFromGithubDeploymentStatus(shipPayload)')
    expect(block).toContain(".eq('github_app_installation_id', shipInstallationId)")
    expect(block).toContain('scheduleAutoRelease(shipDb, pid, trigger)')
    expect(block).not.toContain('indexing_enabled')
  })

  it('manual publish and auto-release share one publish path; release-builder accepts auto_source', () => {
    expect(readFileSync(resolve(FUNCTIONS, 'api/routes/releases.ts'), 'utf-8')).toContain(
      "publishRelease(db, idParsed.value, { kind: 'admin', id: userId })",
    )
    const builder = readFileSync(resolve(FUNCTIONS, 'release-builder/index.ts'), 'utf-8')
    expect(builder).toContain("auto_source: z.enum(['github_release', 'github_deployment', 'recipe_event']).optional()")
    expect(builder).toContain("code: 'AUTO_DRAFT_EXISTS'")
  })

  it('the setting is an admin-only boolean on PATCH /v1/admin/settings', () => {
    const src = readFileSync(resolve(FUNCTIONS, 'api/routes/settings-research.ts'), 'utf-8')
    const block = src.slice(src.indexOf("if (key === 'auto_release_enabled')"), src.indexOf("if (key === 'voice_intake_enabled')"))
    expect(block).toContain('requireProjectAdmin(c, project)')
    expect(block).toContain("typeof value !== 'boolean'")
  })

  it('the migration is additive and defaults the opt-in to OFF', () => {
    const sql = readFileSync(resolve(FUNCTIONS, '../migrations/20261003130000_auto_release.sql'), 'utf-8')
    expect(sql).toContain('APPLY ORDER: ADDITIVE')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS auto_release_enabled boolean NOT NULL DEFAULT false')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_releases_one_auto_draft')
    expect(sql).not.toMatch(/\bDROP\b/i)
  })
})
