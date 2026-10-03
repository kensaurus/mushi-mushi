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
  AUTO_DRAFT_STALE_MS,
  findOpenAutoDraft,
  routeGithubShipEvent,
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

  it('a concurrent automatic draft (409 from release-builder) is reported with the draft that won, not retried or published', async () => {
    const db = seed()
    const d = deps({
      draft: vi.fn(async () => {
        // The other trigger's insert lands between our check and our insert.
        db.table('releases').push({ id: 'rel-race', project_id: P, version: '1.4.1', status: 'draft', auto_source: 'github_deployment', created_at: NOW.toISOString() })
        return { ok: false as const, busy: true, error: 'open' }
      }),
    })
    expect(await runAutoRelease(db as never, P, trigger, d)).toEqual({
      status: 'draft_in_progress',
      blocking: { id: 'rel-race', version: '1.4.1', createdAt: NOW.toISOString(), autoSource: 'github_deployment', stale: false },
    })
    expect(d.publish).not.toHaveBeenCalled()
  })

  it('an open automatic draft blocks the trigger BEFORE release-builder is called (no LLM spend, no 409 round trip)', async () => {
    const created = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString()
    const db = seed({
      releases: [{ id: 'rel-stuck', project_id: P, version: '1.3.9', status: 'draft', auto_source: 'recipe_event', created_at: created }],
    })
    const d = deps()
    expect(await runAutoRelease(db as never, P, trigger, d)).toEqual({
      status: 'draft_in_progress',
      blocking: { id: 'rel-stuck', version: '1.3.9', createdAt: created, autoSource: 'recipe_event', stale: true },
    })
    expect(d.draft).not.toHaveBeenCalled()
    expect(d.publish).not.toHaveBeenCalled()
  })

  it('an unreadable draft check fails the run instead of drafting a second release', async () => {
    const { db } = createFakeDb((q) => {
      if (q.table === 'project_settings') return { data: { auto_release_enabled: true } }
      if (q.table === 'reports') return { data: [{ id: 'r1' }] }
      if (q.table === 'releases' && q.filters.some((f) => f.method === 'not')) return { error: { message: 'timeout' } }
      return { data: null }
    })
    const d = deps()
    expect(await runAutoRelease(db, P, trigger, d)).toEqual({ status: 'failed', error: 'reading automatic drafts failed: timeout' })
    expect(d.draft).not.toHaveBeenCalled()
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

  it('a publish that fails before the status flips leaves the draft for a person (published: false)', async () => {
    const d = deps({
      publish: vi.fn(async () => ({ ok: false as const, status: 500 as const, error: 'connection reset', published: false })),
    })
    expect(await runAutoRelease(seed() as never, P, trigger, d)).toEqual({
      status: 'failed',
      error: 'connection reset',
      releaseId: 'rel-new',
      published: false,
    })
  })

  it('a publish that fails after the release went live says it is live with partial reporter delivery (published: true)', async () => {
    const d = deps({
      publish: vi.fn(async () => ({
        ok: false as const,
        status: 500 as const,
        error: 'release published, but stamping credits failed',
        published: true,
      })),
    })
    expect(await runAutoRelease(seed() as never, P, trigger, d)).toEqual({
      status: 'failed',
      error: 'release published, but stamping credits failed',
      releaseId: 'rel-new',
      published: true,
    })
  })
})

describe('findOpenAutoDraft', () => {
  it('finds only an automatic DRAFT of this project, and marks it stale after AUTO_DRAFT_STALE_MS', async () => {
    const fresh = new Date(NOW.getTime() - 60_000).toISOString()
    const old = new Date(NOW.getTime() - AUTO_DRAFT_STALE_MS - 1).toISOString()
    const db = makeFakeDb({
      releases: [
        { id: 'manual', project_id: P, version: '1', status: 'draft', auto_source: null, created_at: old },
        { id: 'shipped', project_id: P, version: '2', status: 'published', auto_source: 'github_release', created_at: old },
        { id: 'other-project', project_id: 'p2', version: '3', status: 'draft', auto_source: 'github_release', created_at: old },
      ],
    })
    expect(await findOpenAutoDraft(db as never, P, NOW)).toEqual({ ok: true, draft: null })
    db.table('releases').push({ id: 'auto', project_id: P, version: '4', status: 'draft', auto_source: 'recipe_event', created_at: fresh })
    expect(await findOpenAutoDraft(db as never, P, NOW)).toEqual({
      ok: true,
      draft: { id: 'auto', version: '4', createdAt: fresh, autoSource: 'recipe_event', stale: false },
    })
    expect(await findOpenAutoDraft(db as never, P, new Date(NOW.getTime() + AUTO_DRAFT_STALE_MS))).toMatchObject({
      draft: { id: 'auto', stale: true },
    })
  })
})

describe('routeGithubShipEvent (GitHub App release / deployment_status)', () => {
  const release = (overrides: Record<string, unknown> = {}) => ({
    action: 'published',
    release: { tag_name: 'v1.4.0', name: 'Autumn' },
    repository: { full_name: 'acme/web' },
    installation: { id: 42 },
    ...overrides,
  })

  it('schedules auto-release for each project bound to the repo under THIS installation, without needing indexing', async () => {
    const db = makeFakeDb({
      project_repos: [
        { project_id: 'p-a', repo_url: 'https://github.com/acme/web', github_app_installation_id: 42, indexing_enabled: false },
        { project_id: 'p-a', repo_url: 'https://github.com/acme/web', github_app_installation_id: 42 },
        { project_id: 'p-b', repo_url: 'https://github.com/acme/web', github_app_installation_id: 42 },
        { project_id: 'p-other-install', repo_url: 'https://github.com/acme/web', github_app_installation_id: 7 },
      ],
    })
    const schedule = vi.fn()
    const out = await routeGithubShipEvent(db as never, 'release', release(), schedule)
    expect(out).toEqual({ status: 202, body: { ok: true, autoRelease: { queued: 2, version: 'v1.4.0' } }, projectIds: ['p-a', 'p-b'] })
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(schedule).toHaveBeenCalledWith(db, 'p-a', { source: 'github_release', version: 'v1.4.0', title: 'Autumn', commit: null })
  })

  it('ignores non-production deploys, drafts, missing routing data and unbound repos with a 202', async () => {
    const db = makeFakeDb({ project_repos: [] })
    const schedule = vi.fn()
    expect(await routeGithubShipEvent(db as never, 'release', release({ release: { tag_name: 'v1', draft: true } }), schedule)).toEqual({
      status: 202, body: { ok: true, ignored: 'release_not_a_production_ship' }, projectIds: [],
    })
    expect(
      await routeGithubShipEvent(
        db as never,
        'deployment_status',
        { deployment_status: { state: 'success', environment: 'Preview' }, deployment: { sha: 'a1b2c3d4e5f6a7b8' }, repository: { full_name: 'acme/web' }, installation: { id: 42 } },
        schedule,
      ),
    ).toMatchObject({ status: 202, body: { ignored: 'deployment_status_not_a_production_ship' } })
    expect(await routeGithubShipEvent(db as never, 'release', release({ installation: undefined }), schedule)).toMatchObject({
      status: 202, body: { ignored: 'missing_repo_or_installation' },
    })
    expect(await routeGithubShipEvent(db as never, 'release', release(), schedule)).toEqual({
      status: 202, body: { ok: true, ignored: 'no_project_for_repo', repoFullName: 'acme/web' }, projectIds: [],
    })
    expect(schedule).not.toHaveBeenCalled()
  })

  it('a failed project_repos lookup is a 500 so GitHub redelivers, never "no project"', async () => {
    const { db } = createFakeDb((q) => (q.table === 'project_repos' ? { error: { message: 'connection refused' } } : { data: null }))
    const schedule = vi.fn()
    const out = await routeGithubShipEvent(db, 'release', release(), schedule)
    expect(out.status).toBe(500)
    expect(out.body).toMatchObject({ ok: false })
    expect(schedule).not.toHaveBeenCalled()
  })
})

describe('wiring', () => {
  it('the GitHub App webhook hands release + deployment_status to routeGithubShipEvent and answers with its status', () => {
    const src = readFileSync(resolve(FUNCTIONS, 'webhooks-github-indexer/index.ts'), 'utf-8')
    const block = src.slice(src.indexOf("if (event === 'release' || event === 'deployment_status')"), src.indexOf("if (event !== 'push'"))
    expect(block).toContain('routeGithubShipEvent(getDb(), event,')
    expect(block).toContain('return c.json(routed.body, routed.status)')
  })

  it('manual publish and auto-release share one publish path', () => {
    expect(readFileSync(resolve(FUNCTIONS, 'api/routes/releases.ts'), 'utf-8')).toContain(
      "publishRelease(db, idParsed.value, { kind: 'admin', id: userId })",
    )
  })

  it('the console route for the blocking draft is registered before /:id', () => {
    const src = readFileSync(resolve(FUNCTIONS, 'api/routes/releases.ts'), 'utf-8')
    const autoAt = src.indexOf("app.get('/v1/admin/releases/auto-release'")
    expect(autoAt).toBeGreaterThan(0)
    expect(autoAt).toBeLessThan(src.indexOf("app.get('/v1/admin/releases/:id'"))
    expect(src.slice(autoAt, src.indexOf('// ─── Draft a new release'))).toContain('findOpenAutoDraft(db,')
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
