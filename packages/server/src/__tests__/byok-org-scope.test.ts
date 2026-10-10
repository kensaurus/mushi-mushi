/**
 * FILE: byok-org-scope.test.ts
 * PURPOSE: AI keys shared by every app in an organization (ADR 0023). One
 *          Firecrawl key had to be pasted into each app (2026-10-10); a key
 *          can now belong to the organization, and an app uses its own keys
 *          first, then the shared ones.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

;(globalThis as typeof globalThis & { Deno?: { env: { get: (k: string) => string | undefined } } }).Deno ??= {
  env: { get: (key: string) => process.env[key] },
}

const scope = await import('../../supabase/functions/_shared/byok-scope.ts')
const byok = await import('../../supabase/functions/_shared/byok.ts')

const P = '542b34e0-019e-41fe-b900-7b637717bb86'
const ORG = '0f0e0d0c-0b0a-4908-8706-050403020100'

describe('keyOwnerFilter', () => {
  it("matches the project's keys, and its organization's when it has one", () => {
    expect(scope.keyOwnerFilter({ projectId: P, organizationId: null })).toBe(`project_id.eq.${P}`)
    expect(scope.keyOwnerFilter({ projectId: P, organizationId: ORG })).toBe(`project_id.eq.${P},organization_id.eq.${ORG}`)
  })

  it('refuses an id that could change the filter', () => {
    expect(() => scope.keyOwnerFilter({ projectId: `${P},status.eq.disabled`, organizationId: null })).toThrow()
    expect(() => scope.keyOwnerFilter({ projectId: P, organizationId: 'x.eq.1' })).toThrow()
  })
})

describe('who may change a shared key', () => {
  it('owners and admins only', () => {
    expect(scope.canManageSharedKeys('owner')).toBe(true)
    expect(scope.canManageSharedKeys('admin')).toBe(true)
    expect(scope.canManageSharedKeys('member')).toBe(false)
    expect(scope.canManageSharedKeys(null)).toBe(false)
  })
})

describe('ownKeysFirst', () => {
  it("puts the project's own keys before shared ones, by priority within each", () => {
    const rows = [
      { id: 'shared-1', project_id: null, priority: 1 },
      { id: 'own-50', project_id: P, priority: 50 },
      { id: 'own-10', project_id: P, priority: 10 },
      { id: 'shared-2', project_id: null, priority: 2 },
    ]
    expect(scope.ownKeysFirst(rows).map((r) => r.id)).toEqual(['own-10', 'own-50', 'shared-1', 'shared-2'])
  })
})

/** byok_keys answers by the `or` filter it was given; projects knows the org. */
function fakeDb(keys: Array<Record<string, unknown>>, orgId: string | null) {
  const seen: { or?: string } = {}
  return {
    seen,
    db: {
      from(table: string) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          select: () => b,
          eq: () => b,
          in: () => b,
          order: () => b,
          or: (f: string) => ((seen.or = f), b),
          update: () => b,
          // The legacy-column / env fallback after an empty pool.
          single: () => Promise.resolve({ data: null, error: null }),
          maybeSingle: () => Promise.resolve({ data: table === 'projects' ? { organization_id: orgId } : null, error: null }),
          then(resolveFn: (v: unknown) => void) {
            if (table !== 'byok_keys') return resolveFn({ data: [], error: null })
            const allowed = (seen.or ?? '').split(',')
            const visible = keys.filter(
              (k) =>
                (k.project_id && allowed.includes(`project_id.eq.${k.project_id}`)) ||
                (k.organization_id && allowed.includes(`organization_id.eq.${k.organization_id}`)),
            )
            resolveFn({ data: visible, error: null })
          },
        }
        return b
      },
      rpc: (_fn: string, args: { secret_id: string }) => Promise.resolve({ data: `fc-secret-${args.secret_id}`, error: null }),
    } as never,
  }
}

const key = (id: string, owner: { project_id?: string; organization_id?: string }, priority = 100) => ({
  id,
  project_id: owner.project_id ?? null,
  organization_id: owner.organization_id ?? null,
  vault_secret_id: id,
  label: null,
  priority,
  status: 'active',
  cooldown_until: null,
  test_status: 'ok',
  base_url: null,
})

describe('resolveLlmKeys with a shared key', () => {
  it('an app with no key of its own uses its organization key', async () => {
    const { db } = fakeDb([key('org-fc', { organization_id: ORG })], ORG)
    const keys = await byok.resolveLlmKeys(db, P, 'firecrawl')
    expect(keys.map((k) => k.keyId)).toEqual(['org-fc'])
    expect(keys[0].source).toBe('byok')
  })

  it("the app's own key comes first, the shared one is the fallback", async () => {
    const { db } = fakeDb([key('org-fc', { organization_id: ORG }, 1), key('own-fc', { project_id: P }, 100)], ORG)
    const keys = await byok.resolveLlmKeys(db, P, 'firecrawl')
    expect(keys.map((k) => k.keyId)).toEqual(['own-fc', 'org-fc'])
  })

  it("an app's own legacy credential still comes before the shared key", async () => {
    // Review 2026-10-10: the shared pool key used to win over the app's own
    // project_settings key, silently moving its billing to the org key.
    const { db } = fakeDb([key('org-fc', { organization_id: ORG })], ORG)
    const withLegacy = {
      ...db,
      from(table: string) {
        const b = (db as unknown as { from: (t: string) => Record<string, unknown> }).from(table)
        if (table !== 'project_settings') return b
        return {
          ...b,
          select: () => withLegacy.from(table),
          eq: () => withLegacy.from(table),
          single: () =>
            Promise.resolve({ data: { byok_firecrawl_key_ref: 'vault://own-legacy', byok_firecrawl_test_status: 'ok' }, error: null }),
        }
      },
    } as never
    const keys = await byok.resolveLlmKeys(withLegacy, P, 'firecrawl')
    expect(keys.map((k) => k.keyId ?? 'legacy')).toEqual(['legacy', 'org-fc'])
  })

  it("never uses another organization's key", async () => {
    const { db } = fakeDb([key('other-org', { organization_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })], ORG)
    // Only the platform env fallback may remain; never the other org's row.
    const keys = await byok.resolveLlmKeys(db, P, 'firecrawl')
    expect(keys.some((k) => k.keyId === 'other-org')).toBe(false)
    expect(keys.every((k) => k.source !== 'byok')).toBe(true)
  })
})

describe('key routes', () => {
  const src = readFileSync(resolve(__dirname, '../../supabase/functions/api/routes/settings-research.ts'), 'utf-8')

  it('adding a key for every app needs an organization and an owner or admin', () => {
    const add = src.slice(src.indexOf("'/v1/admin/byok/keys',\n"), src.indexOf("'/v1/admin/byok/keys/:keyId/expiry'"))
    expect(add).toContain("rawScope === 'organization'")
    expect(add).toContain("code: 'NO_ORGANIZATION'")
    expect(add).toContain('canManageOrgKeys(c, db, sharedOrgId)')
    expect(add).toContain('organization_id: sharedOrgId')
    expect(add).toContain("denyViewerWrite(c, project.organization_role, 'add AI keys')")
    expect(add).toContain('isShareableProvider(rawProvider)')
  })

  it('every per-key write checks the viewer and shared-key rules first', () => {
    expect(src.match(/await sharedKeyWriteGuard\(c, db, project, keyId\)/g)?.length).toBe(4)
    const guard = src.slice(src.indexOf('async function sharedKeyWriteGuard('), src.indexOf("import {\n  countByokKeyHealth"))
    expect(guard).toContain("denyViewerWrite(c, project.organization_role, 'change AI keys')")
    expect(guard).toContain('canManageOrgKeys(c, db, data.organization_id')
  })

  it("shared-key rights come from a fresh membership read, never organization_role; API keys never manage them", () => {
    // Review 2026-10-10: organization_role is 'owner' for any project-bound
    // API key and for a project's creator via the legacy owner_id fallback.
    expect(src).not.toMatch(/canManageSharedKeys\(project\.organization_role\)/)
    const fn = src.slice(src.indexOf('async function canManageOrgKeys('), src.indexOf('function isShareableProvider('))
    expect(fn).toContain("c.get('authMethod') !== 'jwt'")
    expect(fn).toContain(".from('organization_members')")
    expect(fn).toContain('canManageSharedKeys(')
  })

  it('a Supabase token cannot be shared, by adding or by moving', () => {
    const scopeRoute = src.slice(src.indexOf("'/v1/admin/byok/keys/:keyId/scope'"))
    expect(scopeRoute.slice(0, scopeRoute.indexOf('.update('))).toContain('isShareableProvider(own.provider_slug)')
  })

  it('no byok_keys query is limited to the project alone any more', () => {
    for (const rest of src.split(".from('byok_keys')").slice(1)) {
      // The chain ends at the statement end or where the next table starts.
      const ends = [rest.indexOf(';'), rest.indexOf('.from(')].filter((i) => i >= 0)
      expect(rest.slice(0, Math.min(...ends))).not.toContain(".eq('project_id', project.id)")
    }
  })

  it('the owner filter is used on byok_keys only (other tables have no organization_id)', () => {
    // The nearest .from() before each use must be byok_keys.
    const uses = [...src.matchAll(/keyOwnerFilter\(keyOwnerOf\(/g)].map((m) => m.index ?? 0)
    expect(uses.length).toBeGreaterThan(10)
    for (const at of uses) {
      const table = [...src.slice(0, at).matchAll(/\.from\('([a-z_]+)'\)/g)].pop()?.[1]
      expect(table, `owner filter at offset ${at}`).toBe('byok_keys')
    }
  })

  it('no byok_keys read anywhere in the functions filters on project_id alone', () => {
    // The research stats and the duplicate check were missed on the first pass
    // (they used `pid` / `projectId`, not `project.id`) and showed Research as
    // "not set up" for apps using a shared key (2026-10-10).
    const root = resolve(__dirname, '../../supabase/functions')
    // Reviewed: these pair the project query with a separate organization query.
    const pairedWithOrgQuery = new Set(['_shared/fix-report-truth-load.ts', '_shared/setup-signals.ts'])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
          if (name !== 'node_modules') walk(p)
          continue
        }
        if (!name.endsWith('.ts') || name.includes('.test.')) continue
        const rel = relative(root, p).replace(/\\/g, '/')
        const text = readFileSync(p, 'utf-8')
        for (const rest of text.split(".from('byok_keys')").slice(1)) {
          const ends = [rest.indexOf(';'), rest.indexOf('.from(')].filter((i) => i >= 0)
          const chain = rest.slice(0, Math.min(...ends))
          if (!/\.(eq|in)\('project_id'/.test(chain) || chain.includes('keyOwnerFilter')) continue
          if (!pairedWithOrgQuery.has(rel)) offenders.push(rel)
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  it("the radar's dead-app rule counts only the app's own keys", () => {
    // Its fix is "revoke the key": a shared key serves every other app.
    const radar = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/radar/operator.ts'), 'utf-8')
    expect(radar).toMatch(/liveProviderKeys: byok\.filter\(\(k\) => \(k as \{ project_id\?: string \| null \}\)\.project_id && isUsableByokKey\(k\)\)/)
  })

  it('a key can be shared with every app, or brought back to one', () => {
    expect(src).toContain("'/v1/admin/byok/keys/:keyId/scope'")
  })
})
