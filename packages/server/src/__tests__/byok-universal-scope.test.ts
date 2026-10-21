/**
 * FILE: byok-universal-scope.test.ts
 * PURPOSE: Universal AI keys (ADR 0031): a key owned by a user serves every
 *          app in every organization where that user is an owner. One
 *          Anthropic key could not serve the dogfood organization and the
 *          mushi-mushi project's organization, so the agent PR review skipped
 *          mushi's own PRs with `no_anthropic_key` (2026-10-21).
 *
 *          Pins the resolver order (own → legacy → organization → universal →
 *          platform), the cross-tenant guard, and spend-down's first pick.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const scope = await import('../../supabase/functions/_shared/byok-scope.ts')
const byok = await import('../../supabase/functions/_shared/byok.ts')
const spendDown = await import('../../supabase/functions/_shared/spend-down.ts')
const spendDownDb = await import('../../supabase/functions/_shared/spend-down-db.ts')

// The owner has two organizations (dogfood and mushi); another owner has a third.
const ORG_DOGFOOD = '5de684b4-0000-4000-8000-000000000001'
const ORG_MUSHI = '7a7b7991-0000-4000-8000-000000000002'
const ORG_OTHER = '0c0c0c0c-0000-4000-8000-000000000003'
const OWNER = 'aaaaaaaa-0000-4000-8000-00000000000a'
const OTHER_OWNER = 'bbbbbbbb-0000-4000-8000-00000000000b'
const P_DOGFOOD = '10000000-0000-4000-8000-000000000001'
const P_MUSHI = '10000000-0000-4000-8000-000000000002'
const P_OTHER = '10000000-0000-4000-8000-000000000003'

const members = [
  { organization_id: ORG_DOGFOOD, user_id: OWNER, role: 'owner' },
  { organization_id: ORG_MUSHI, user_id: OWNER, role: 'owner' },
  { organization_id: ORG_OTHER, user_id: OTHER_OWNER, role: 'owner' },
  // The owner is only an admin of the other organization.
  { organization_id: ORG_OTHER, user_id: OWNER, role: 'admin' },
]
const projects = [
  { id: P_DOGFOOD, organization_id: ORG_DOGFOOD },
  { id: P_MUSHI, organization_id: ORG_MUSHI },
  { id: P_OTHER, organization_id: ORG_OTHER },
]

type Owner = { project_id?: string; organization_id?: string; owner_user_id?: string }
const key = (id: string, owner: Owner, priority = 100, provider = 'anthropic') => ({
  id,
  provider_slug: provider,
  project_id: owner.project_id ?? null,
  organization_id: owner.organization_id ?? null,
  owner_user_id: owner.owner_user_id ?? null,
  vault_secret_id: id,
  label: null,
  priority,
  status: 'active',
  cooldown_until: null,
  test_status: 'ok',
  base_url: null,
})

function db(keys: Array<ReturnType<typeof key>>, settings: Array<Record<string, unknown>> = []) {
  return makeFakeDb(
    { projects, organization_members: members, byok_keys: keys, project_settings: settings, byok_audit_log: [] },
    { rpc: (fn, args) => (fn === 'vault_get_secret' ? `secret-${String(args.secret_id)}` : null) },
  ) as never
}

describe('keyOwnerFilter with universal keys', () => {
  it("adds the organization owners' universal keys", () => {
    expect(scope.keyOwnerFilter({ projectId: P_MUSHI, organizationId: ORG_MUSHI, universalUserIds: [OWNER] })).toBe(
      `project_id.eq.${P_MUSHI},organization_id.eq.${ORG_MUSHI},owner_user_id.eq.${OWNER}`,
    )
    expect(
      scope.keyOwnerFilter({ projectId: P_MUSHI, organizationId: ORG_MUSHI, universalUserIds: [OWNER, OTHER_OWNER] }),
    ).toBe(`project_id.eq.${P_MUSHI},organization_id.eq.${ORG_MUSHI},owner_user_id.in.(${OWNER},${OTHER_OWNER})`)
    expect(scope.keyOwnerFilter({ projectId: P_MUSHI, organizationId: ORG_MUSHI, universalUserIds: [] })).toBe(
      `project_id.eq.${P_MUSHI},organization_id.eq.${ORG_MUSHI}`,
    )
  })

  it('refuses a user id that could change the filter', () => {
    expect(() =>
      scope.keyOwnerFilter({ projectId: P_MUSHI, organizationId: ORG_MUSHI, universalUserIds: [`${OWNER}),status.eq.x`] }),
    ).toThrow()
  })

  it('projectKeyOwner lists the owners, never admins or members', async () => {
    const owner = await scope.projectKeyOwner(db([]), P_OTHER)
    expect(owner).toEqual({ projectId: P_OTHER, organizationId: ORG_OTHER, universalUserIds: [OTHER_OWNER] })
  })
})

describe('who a universal key serves', () => {
  it("only organizations where its owner has role owner (not admin, member or viewer)", () => {
    expect(scope.universalKeyApplies('owner')).toBe(true)
    for (const role of ['admin', 'member', 'viewer', null, undefined]) expect(scope.universalKeyApplies(role)).toBe(false)
  })

  it('keyScopeFor drops any row the project may not use', () => {
    const owner = { projectId: P_MUSHI, organizationId: ORG_MUSHI, universalUserIds: [OWNER] }
    expect(scope.keyScopeFor({ project_id: P_MUSHI }, owner)).toBe('project')
    expect(scope.keyScopeFor({ organization_id: ORG_MUSHI }, owner)).toBe('organization')
    expect(scope.keyScopeFor({ owner_user_id: OWNER }, owner)).toBe('universal')
    expect(scope.keyScopeFor({ project_id: P_DOGFOOD }, owner)).toBeNull()
    expect(scope.keyScopeFor({ organization_id: ORG_DOGFOOD }, owner)).toBeNull()
    expect(scope.keyScopeFor({ owner_user_id: OTHER_OWNER }, owner)).toBeNull()
    expect(scope.keyScopeFor({}, owner)).toBeNull()
  })

  it('ownKeysFirst ranks app, then organization, then universal keys', () => {
    const rows = [
      { id: 'u', project_id: null, organization_id: null, priority: 0 },
      { id: 'o', project_id: null, organization_id: ORG_MUSHI, priority: 0 },
      { id: 'p', project_id: P_MUSHI, organization_id: null, priority: 50 },
    ]
    expect(scope.ownKeysFirst(rows).map((r) => r.id)).toEqual(['p', 'o', 'u'])
  })
})

describe('resolveLlmKeys: the five steps in order', () => {
  const ids = (keys: Array<{ keyId?: string; source: string }>) => keys.map((k) => k.keyId ?? k.source)

  it('1. own key, then 3. organization key, then 4. universal key (legacy is skipped when an own key exists)', async () => {
    const keys = await byok.resolveLlmKeys(
      db(
        [key('universal', { owner_user_id: OWNER }, 0), key('org', { organization_id: ORG_MUSHI }, 0), key('own', { project_id: P_MUSHI }, 100)],
        [{ project_id: P_MUSHI, byok_anthropic_key_ref: 'vault://legacy', byok_anthropic_test_status: 'ok' }],
      ),
      P_MUSHI,
      'anthropic',
    )
    expect(ids(keys)).toEqual(['own', 'org', 'universal'])
    expect(keys.map((k) => k.scope)).toEqual(['project', 'organization', 'universal'])
    expect(keys.map((k) => Boolean(k.shared))).toEqual([false, true, true])
  })

  it('2. the legacy credential comes before the organization and universal keys', async () => {
    const keys = await byok.resolveLlmKeys(
      db(
        [key('universal', { owner_user_id: OWNER }), key('org', { organization_id: ORG_MUSHI })],
        [{ project_id: P_MUSHI, byok_anthropic_key_ref: 'vault://legacy', byok_anthropic_test_status: 'ok' }],
      ),
      P_MUSHI,
      'anthropic',
    )
    expect(ids(keys)).toEqual(['byok', 'org', 'universal'])
    expect(keys[0].key).toBe('secret-legacy')
  })

  it("4. a universal key alone serves the owner's app in another organization (the mushi-mushi case)", async () => {
    const keys = await byok.resolveLlmKeys(db([key('universal', { owner_user_id: OWNER })]), P_MUSHI, 'anthropic')
    expect(ids(keys)).toEqual(['universal'])
    expect(keys[0]).toMatchObject({ source: 'byok', scope: 'universal', shared: true, key: 'secret-universal' })
    // The same key serves the dogfood organization's app.
    expect(ids(await byok.resolveLlmKeys(db([key('universal', { owner_user_id: OWNER })]), P_DOGFOOD, 'anthropic'))).toEqual([
      'universal',
    ])
  })

  it('5. the platform key only when the app has no key at all', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-platform-0000'
    try {
      expect(ids(await byok.resolveLlmKeys(db([]), P_MUSHI, 'anthropic'))).toEqual(['env'])
      expect(ids(await byok.resolveLlmKeys(db([key('universal', { owner_user_id: OWNER })]), P_MUSHI, 'anthropic'))).toEqual([
        'universal',
      ])
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it("several owners: all their universal keys, by priority", async () => {
    const multiOwner = makeFakeDb(
      {
        projects,
        organization_members: [...members, { organization_id: ORG_MUSHI, user_id: OTHER_OWNER, role: 'owner' }],
        byok_keys: [key('mine', { owner_user_id: OWNER }, 50), key('theirs', { owner_user_id: OTHER_OWNER }, 10)],
        project_settings: [],
      },
      { rpc: (_fn, args) => `secret-${String(args.secret_id)}` },
    ) as never
    expect(ids(await byok.resolveLlmKeys(multiOwner, P_MUSHI, 'anthropic'))).toEqual(['theirs', 'mine'])
  })

  it('orderCandidates: own replaces legacy; shared and universal follow; env only when empty', () => {
    const k = (keyId: string) => ({ keyId, key: keyId, source: 'byok' as const, hint: '…' })
    const env = () => [{ key: 'env', source: 'env' as const, hint: '…' }]
    expect(byok.orderCandidates({ own: [k('o')], legacy: [k('l')], shared: [k('s')], universal: [k('u')], env }).map((c) => c.keyId)).toEqual(['o', 's', 'u'])
    expect(byok.orderCandidates({ own: [], legacy: [k('l')], shared: [], universal: [k('u')], env }).map((c) => c.keyId)).toEqual(['l', 'u'])
    expect(byok.orderCandidates({ own: [], legacy: [], shared: [], universal: [], env }).map((c) => c.source)).toEqual(['env'])
  })
})

describe('cross-tenant guard: a universal key never serves another owner\'s organization', () => {
  it("the owner's key does not reach an organization they only administer", async () => {
    process.env.ANTHROPIC_API_KEY = ''
    const keys = await byok.resolveLlmKeys(db([key('mine', { owner_user_id: OWNER })]), P_OTHER, 'anthropic')
    expect(keys.some((k) => k.keyId === 'mine')).toBe(false)
    expect(keys).toEqual([])
  })

  it("another owner's key does not reach the owner's apps", async () => {
    const keys = await byok.resolveLlmKeys(db([key('theirs', { owner_user_id: OTHER_OWNER })]), P_MUSHI, 'anthropic')
    expect(keys.some((k) => k.keyId === 'theirs')).toBe(false)
  })

  it('holds even if the database returned the row anyway (filter ignored)', async () => {
    const real = db([key('theirs', { owner_user_id: OTHER_OWNER }), key('own', { project_id: P_MUSHI })]) as unknown as {
      from: (t: string) => Record<string, unknown>
    }
    // A database that ignores the `or` owner filter on byok_keys.
    const leaky = {
      ...real,
      rpc: (real as unknown as { rpc: unknown }).rpc,
      from(table: string) {
        const b = real.from(table)
        if (table !== 'byok_keys') return b
        const passThrough: Record<string, unknown> = new Proxy(b, {
          get(target, prop) {
            if (prop === 'or') return () => passThrough
            const v = (target as Record<string | symbol, unknown>)[prop]
            if (typeof v !== 'function') return v
            return (...args: unknown[]) => {
              const out = (v as (...a: unknown[]) => unknown).apply(target, args)
              return out === target ? passThrough : out
            }
          },
        })
        return passThrough
      },
    } as never
    const keys = await byok.resolveLlmKeys(leaky, P_MUSHI, 'anthropic')
    expect(keys.map((k) => k.keyId)).toEqual(['own'])
  })
})

describe('spend-down first pick with a universal Cursor key (ADR 0028, ADR 0031)', () => {
  const cursor = (id: string, owner: Owner, priority = 100) => ({
    id,
    project_id: owner.project_id ?? null,
    organization_id: owner.organization_id ?? null,
    owner_user_id: owner.owner_user_id ?? null,
    priority,
    status: 'active',
    test_status: 'ok',
  })
  const app = (id: string, org: string, extra: Partial<{ has_legacy_key: boolean; org_owner_ids: string[] }> = {}) => ({
    id,
    organization_id: org,
    has_legacy_key: false,
    org_owner_ids: [OWNER],
    ...extra,
  })

  it('serves an app with no own, legacy or organization key', () => {
    expect(spendDown.firstCursorKeyFor(app(P_MUSHI, ORG_MUSHI), [cursor('u', { owner_user_id: OWNER })])).toBe('u')
  })

  it('comes after the app key, the legacy key and the organization key', () => {
    const keys = [cursor('u', { owner_user_id: OWNER }, 0), cursor('o', { organization_id: ORG_MUSHI }), cursor('p', { project_id: P_MUSHI })]
    expect(spendDown.firstCursorKeyFor(app(P_MUSHI, ORG_MUSHI), keys)).toBe('p')
    expect(spendDown.firstCursorKeyFor(app(P_MUSHI, ORG_MUSHI), keys.slice(0, 2))).toBe('o')
    expect(spendDown.firstCursorKeyFor(app(P_MUSHI, ORG_MUSHI, { has_legacy_key: true }), keys.slice(0, 1))).toBe('legacy')
  })

  it("never picks a key whose owner does not own the app's organization", () => {
    expect(spendDown.firstCursorKeyFor(app(P_OTHER, ORG_OTHER, { org_owner_ids: [OTHER_OWNER] }), [cursor('u', { owner_user_id: OWNER })])).toBeNull()
  })

  it('keeps the tie rule among universal keys of several owners', () => {
    const keys = [cursor('a', { owner_user_id: OWNER }, 10), cursor('b', { owner_user_id: OTHER_OWNER }, 10)]
    expect(spendDown.firstCursorKeyFor(app(P_MUSHI, ORG_MUSHI, { org_owner_ids: [OWNER, OTHER_OWNER] }), keys)).toBe('tie')
  })

  it("keyProjects: a universal key pays for its owner's apps across organizations, where it is the first pick", async () => {
    const UNIVERSAL = 'cccccccc-0000-4000-8000-00000000000c'
    const fake = makeFakeDb({
      projects,
      organization_members: members,
      project_settings: projects.map((p) => ({ project_id: p.id, autofix_enabled: true, cursor_api_key_ref: null })),
      project_repos: projects.map((p) => ({ project_id: p.id })),
      byok_keys: [
        { ...cursor(UNIVERSAL, { owner_user_id: OWNER }), provider_slug: 'cursor' },
        // The dogfood app has its own Cursor key, which wins there.
        { ...cursor('dogfood-own', { project_id: P_DOGFOOD }), provider_slug: 'cursor' },
      ],
    }) as never
    const served = await spendDownDb.keyProjects(fake, {
      id: UNIVERSAL,
      provider_slug: 'cursor',
      project_id: null,
      organization_id: null,
      owner_user_id: OWNER,
      status: 'active',
      credits_expire_at: null,
      spend_down_enabled: true,
      spend_down_model: null,
      spend_down_daily_limit: 10,
      spend_down_window_days: 14,
    })
    // Not the dogfood app (own key wins), not the other owner's app.
    expect(served.ids).toEqual([P_MUSHI])
  })
})

/**
 * A database that has not had migration 20261021090000 yet: any byok_keys
 * read that names owner_user_id answers 42703, as PostgREST does.
 */
function withoutOwnerColumn(fake: unknown): never {
  const real = fake as { from: (t: string) => Record<string, unknown>; rpc: unknown }
  const missing = { data: null, error: { code: '42703', message: 'column byok_keys.owner_user_id does not exist' } }
  return {
    rpc: (real.rpc as (...a: unknown[]) => unknown).bind(real),
    from(table: string) {
      const b = real.from(table)
      if (table !== 'byok_keys') return b
      let broken = false
      const wrapped: Record<string, unknown> = new Proxy(b, {
        get(target, prop) {
          if (prop === 'then') {
            if (broken) return (resolveFn: (v: unknown) => void) => resolveFn(missing)
            return (target as Record<string | symbol, unknown>).then
              ? ((target as unknown as { then: (...a: unknown[]) => unknown }).then.bind(target))
              : undefined
          }
          const v = (target as Record<string | symbol, unknown>)[prop]
          if (typeof v !== 'function') return v
          return (...args: unknown[]) => {
            if (args.some((a) => typeof a === 'string' && a.includes('owner_user_id'))) broken = true
            if (broken && (prop === 'maybeSingle' || prop === 'single')) return Promise.resolve(missing)
            const out = (v as (...a: unknown[]) => unknown).apply(target, args)
            return out === target ? wrapped : out
          }
        },
      })
      return wrapped
    },
  } as never
}

describe('a database without owner_user_id yet (deploy before db push)', () => {
  it('ownerUserColumnReady says no, and the owner filter leaves universal keys out', async () => {
    const legacy = withoutOwnerColumn(db([key('own', { project_id: P_MUSHI })]))
    expect(await scope.ownerUserColumnReady(legacy)).toBe(false)
    expect((await scope.projectKeyOwner(legacy, P_MUSHI)).universalUserIds).toEqual([])
    expect(scope.withOwnerUserColumn('id', false)).toBe('id')
    expect(scope.withOwnerUserColumn('id', true)).toBe('id, owner_user_id')
  })

  it('the resolver still serves app and organization keys', async () => {
    const legacy = withoutOwnerColumn(db([key('own', { project_id: P_MUSHI }), key('org', { organization_id: ORG_MUSHI })]))
    expect((await byok.resolveLlmKeys(legacy, P_MUSHI, 'anthropic')).map((k) => k.keyId)).toEqual(['own', 'org'])
  })

  it('spend-down keyProjects still finds the apps an organization key pays for', async () => {
    const ORG_KEY = 'dddddddd-0000-4000-8000-00000000000d'
    const legacy = withoutOwnerColumn(
      makeFakeDb({
        projects,
        organization_members: members,
        project_settings: projects.map((p) => ({ project_id: p.id, autofix_enabled: true, cursor_api_key_ref: null })),
        project_repos: projects.map((p) => ({ project_id: p.id })),
        byok_keys: [{ id: ORG_KEY, provider_slug: 'cursor', project_id: null, organization_id: ORG_MUSHI, priority: 100, status: 'active', test_status: 'ok' }],
      }),
    )
    const served = await spendDownDb.keyProjects(legacy, {
      id: ORG_KEY,
      provider_slug: 'cursor',
      project_id: null,
      organization_id: ORG_MUSHI,
      status: 'active',
      credits_expire_at: null,
      spend_down_enabled: true,
      spend_down_model: null,
      spend_down_daily_limit: 10,
      spend_down_window_days: 14,
    })
    expect(served.ids).toEqual([P_MUSHI])
  })
})

describe('batch readers count the owners\' universal keys', () => {
  it("setup signals: an app whose only Anthropic key is its owner's universal key has a key", async () => {
    const { loadIntegrationSignals } = await import('../../supabase/functions/_shared/setup-signals.ts')
    const fake = makeFakeDb({
      projects: projects.map((p) => ({ ...p, owner_id: OWNER })),
      project_settings: [],
      project_repos: [],
      organization_integration_settings: [],
      organization_members: members,
      byok_keys: [{ ...key('u', { owner_user_id: OWNER }), provider_slug: 'anthropic' }],
    }) as never
    const signals = await loadIntegrationSignals(fake, [P_MUSHI, P_OTHER])
    expect(signals.get(P_MUSHI)?.hasByok).toBe(true)
    // The owner only administers the other organization: no key there.
    expect(signals.get(P_OTHER)?.hasByok).toBe(false)
  })
})

describe('spend-down status view of a universal key (ADR 0031)', () => {
  const apps = [{ id: P_DOGFOOD, name: 'dogfood' }, { id: P_MUSHI, name: 'mushi' }]
  const summary = {
    keyId: 'k',
    dispatched: 3,
    projects: [
      { projectId: P_DOGFOOD, dispatched: 2 },
      { projectId: P_MUSHI, dispatched: 1 },
    ],
  }

  it("anyone but the key's owner sees only the requesting app's organization", () => {
    const view = spendDown.scopeSpendDownView({
      keyIsUniversal: true,
      callerOwnsKey: false,
      visibleProjectIds: new Set([P_MUSHI]),
      projects: apps,
      lastSummary: summary,
    })
    expect(view.projects.map((p) => p.id)).toEqual([P_MUSHI])
    expect(view.lastSummary).toMatchObject({ dispatched: 1, projects: [{ projectId: P_MUSHI, dispatched: 1 }] })
    expect(JSON.stringify(view)).not.toContain(P_DOGFOOD)
  })

  it('the owner sees every app; app and organization keys pass through', () => {
    for (const args of [
      { keyIsUniversal: true, callerOwnsKey: true },
      { keyIsUniversal: false, callerOwnsKey: false },
    ]) {
      const view = spendDown.scopeSpendDownView({ ...args, visibleProjectIds: new Set([P_MUSHI]), projects: apps, lastSummary: summary })
      expect(view.projects).toHaveLength(2)
      expect(view.lastSummary).toEqual(summary)
    }
  })
})

describe('the migration', () => {
  it('adds the column, the three-way owner check, owner-only RLS, the rescoped action and Vault cleanup on delete', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../supabase/migrations/20261021090000_byok_keys_universal_scope.sql'),
      'utf-8',
    )
    expect(sql).toContain('add column if not exists owner_user_id uuid references auth.users(id) on delete cascade')
    expect(sql).toContain('check (num_nonnulls(project_id, organization_id, owner_user_id) = 1)')
    expect(sql).toContain('using (owner_user_id is not null and owner_user_id = (select auth.uid()))')
    expect(sql).toContain("'rescoped'")
    expect(sql).toContain('after delete on public.byok_keys')
    expect(sql).toMatch(/delete from vault\.secrets where id = old\.vault_secret_id/)
    expect(sql).toMatch(/revoke all on function private\.byok_keys_delete_vault_secret\(\) from public, anon, authenticated/)
  })
})
