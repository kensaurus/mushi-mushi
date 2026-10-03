/**
 * `_shared/radar/supabase-detectors.ts` — Supabase security and storage hole
 * checks (Plan 020 Phase 2). Every rule: a hole, no hole, and unknown when
 * the input could not be read. The SQL constants are read-only SELECTs.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateBackups,
  evaluateGrantDivergence,
  evaluateOrphanedStorage,
  evaluateSecretRpcs,
  evaluateUnauthenticatedPaidFunctions,
  SQL_FUNCTION_GRANTS,
  SQL_SECRET_RPCS,
  SQL_STORAGE_SIZES,
  type FunctionGrantRow,
  type SecretRpcRow,
} from '../../supabase/functions/_shared/radar/supabase-detectors.ts'

const GB = 1024 ** 3

describe('SQL constants', () => {
  it('are single read-only SELECT statements', () => {
    for (const sql of [SQL_SECRET_RPCS, SQL_STORAGE_SIZES, SQL_FUNCTION_GRANTS]) {
      expect(sql.trimStart().toLowerCase().startsWith('select')).toBe(true)
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|grant|revoke|truncate|create)\b/i)
      expect(sql).not.toContain(';')
    }
  })
})

describe('rpc_secret_reachable_by_anon', () => {
  const row = (over: Partial<SecretRpcRow>): SecretRpcRow => ({ schema: 'public', name: 'get_byok_key', args: 'p_project uuid', security_definer: true, anon_execute: false, public_execute: false, reads_secrets: true, ...over })

  it('flags a secret-reading definer function anyone can call, with a migration-file fix', () => {
    const r = evaluateSecretRpcs([row({ public_execute: true }), row({ name: 'safe_one' })])
    expect(r.state).toBe('finding')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].severity).toBe('error')
    expect(r.findings[0].fix).toContain('revoke execute on function public.get_byok_key(p_project uuid) from anon, public;')
    expect(r.findings[0].fix).toMatch(/migration file/i)
  })

  it('is ok when none is reachable, and unknown when not read', () => {
    expect(evaluateSecretRpcs([row({}), row({ anon_execute: true, reads_secrets: false })]).state).toBe('ok')
    expect(evaluateSecretRpcs(null).state).toBe('unknown')
  })
})

describe('storage_orphaned_bytes', () => {
  it('flags a large billed gap with an estimated cost', () => {
    const r = evaluateOrphanedStorage({ billedBytes: 2700 * GB, buckets: [{ bucket_id: 'photos', objects: 10, bytes: 40 * GB }] })
    expect(r.state).toBe('finding')
    expect(r.findings[0].message).toMatch(/estimate/i)
    expect(r.findings[0].fix).toMatch(/Storage API/)
    expect(r.findings[0].fix).toMatch(/Never delete storage rows with SQL/)
    expect((r.findings[0].evidence as { estimatedUsdPerMonth: number }).estimatedUsdPerMonth).toBeCloseTo(55.86, 1)
  })

  it('is ok under both thresholds, and unknown when either side is missing', () => {
    expect(evaluateOrphanedStorage({ billedBytes: 10.5 * GB, buckets: [{ bucket_id: 'a', objects: 1, bytes: 10 * GB }] }).state).toBe('ok')
    // 5 GB gap but over 10% of 6 GB billed → finding
    expect(evaluateOrphanedStorage({ billedBytes: 6 * GB, buckets: [{ bucket_id: 'a', objects: 1, bytes: 1 * GB }] }).state).toBe('finding')
    expect(evaluateOrphanedStorage({ billedBytes: null, buckets: [] }).state).toBe('unknown')
    expect(evaluateOrphanedStorage({ billedBytes: GB, buckets: null }).state).toBe('unknown')
  })
})

describe('edge_fn_unauthenticated_paid', () => {
  const paid = `Deno.serve(async (req) => {\n  const key = Deno.env.get('OPENAI_API_KEY')\n  return fetch('https://api.openai.com', { headers: { Authorization: key } })\n})`
  it('flags an open function that spends on a paid key with no auth check', () => {
    const r = evaluateUnauthenticatedPaidFunctions([{ slug: 'old-tts', verifyJwt: false, source: paid }])
    expect(r.state).toBe('finding')
    expect(r.findings[0]).toMatchObject({ severity: 'error', target: 'old-tts' })
  })

  it('accepts an auth check, a JWT-verified function, and reads unknown when the source is missing', () => {
    expect(evaluateUnauthenticatedPaidFunctions([{ slug: 'cron', verifyJwt: false, source: `requireServiceRoleAuth(req)\n${paid}` }]).state).toBe('ok')
    expect(evaluateUnauthenticatedPaidFunctions([{ slug: 'api', verifyJwt: true, source: paid }]).state).toBe('ok')
    expect(evaluateUnauthenticatedPaidFunctions([{ slug: 'x', verifyJwt: false, source: null }]).state).toBe('unknown')
    expect(evaluateUnauthenticatedPaidFunctions(null).state).toBe('unknown')
  })
})

describe('backups', () => {
  it('reports PITR off and Storage not backed up as info; null reads unknown', () => {
    const [pitr, store] = evaluateBackups({ pitrEnabled: false, storageBytes: 5 })
    expect(pitr.findings[0].severity).toBe('info')
    expect(store.state).toBe('finding')
    const [p2, s2] = evaluateBackups({ pitrEnabled: null, storageBytes: null })
    expect([p2.state, s2.state]).toEqual(['unknown', 'unknown'])
    const [p3, s3] = evaluateBackups({ pitrEnabled: true, storageBytes: 0 })
    expect([p3.state, s3.state]).toEqual(['ok', 'ok'])
  })
})

describe('function_grant_divergence', () => {
  const g = (over: Partial<FunctionGrantRow>): FunctionGrantRow => ({ schema: 'public', name: 'read_secret', args: 'k text', anon_execute: false, authenticated_execute: true, public_execute: false, ...over })

  it('flags the same signature open in one project and closed in another', () => {
    const r = evaluateGrantDivergence(new Map([
      ['p1', [g({ anon_execute: true })]],
      ['p2', [g({})]],
      ['p3', [g({ name: 'only_here', anon_execute: true })]],
    ]))
    expect(r.state).toBe('finding')
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].evidence).toEqual({ openIn: ['p1'], closedIn: ['p2'] })
  })

  it('is ok when grants agree and unknown with fewer than two readable projects', () => {
    expect(evaluateGrantDivergence(new Map([['p1', [g({})]], ['p2', [g({})]]])).state).toBe('ok')
    expect(evaluateGrantDivergence(new Map([['p1', [g({})]], ['p2', null]])).state).toBe('unknown')
  })
})
