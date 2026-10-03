/**
 * FILE: packages/server/supabase/functions/_shared/radar/supabase-detectors.ts
 * PURPOSE: Supabase security and storage hole checks (Plan 020 §4.2, Phase 2).
 *          The read-only SQL the Supabase connector runs through the hosted
 *          MCP in read_only mode, and pure evaluators over the rows it returns.
 *
 * No I/O. Mushi never runs DDL: every fix is a migration FILE (a draft PR the
 * owner applies) or a prompt for the editor. A detector whose input is
 * missing returns `unknown` with a reason, never `ok`.
 */

import type { DetectorState, RadarSeverity } from './types.ts'

export type SupabaseRuleId =
  | 'rpc_secret_reachable_by_anon'
  | 'storage_orphaned_bytes'
  | 'edge_fn_unauthenticated_paid'
  | 'pitr_disabled'
  | 'storage_not_backed_up'
  | 'function_grant_divergence'

/** Same shape as RadarFinding, with the Phase 2 rule ids (merged into the catalog by the lead). */
export interface Phase2Finding<R extends string = SupabaseRuleId> {
  ruleId: R
  severity: RadarSeverity
  message: string
  target: string | null
  filePath?: string | null
  line?: number | null
  fix: string
  evidence?: Record<string, unknown>
}

export interface Phase2Result<R extends string = SupabaseRuleId> {
  ruleId: R
  state: DetectorState
  reason: string
  findings: Phase2Finding<R>[]
}

// ── SQL (read-only SELECTs; run through the hosted Supabase MCP, read_only=true) ──

/**
 * SECURITY DEFINER functions outside system schemas that look like they read
 * secrets, with whether `anon` or PUBLIC may execute them. A function counts
 * as secret-reading when its body touches Vault, decrypted secrets, or a
 * table whose name contains "secret" or "key".
 */
export const SQL_SECRET_RPCS = `
select n.nspname as schema,
       p.proname as name,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) as public_execute,
       (p.prosrc ilike '%vault.%'
        or p.prosrc ilike '%decrypted_secret%'
        or p.prosrc ~* '\\m[a-z_]*(secret|key)s?[a-z_]*\\M') as reads_secrets
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname not in ('pg_catalog', 'information_schema', 'vault', 'pgsodium', 'extensions', 'graphql', 'graphql_public', 'realtime', 'supabase_functions', 'storage', 'auth', 'net', 'cron')
   and p.prokind = 'f'
   and p.prosecdef
 order by 1, 2
`.trim()

/** Bytes per bucket as recorded in object metadata. */
export const SQL_STORAGE_SIZES = `
select bucket_id,
       count(*)::bigint as objects,
       coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
  from storage.objects
 group by bucket_id
 order by bucket_id
`.trim()

/** Who may execute each non-system function, for comparing grants across projects. */
export const SQL_FUNCTION_GRANTS = `
select n.nspname as schema,
       p.proname as name,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) as public_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public')
   and p.prokind = 'f'
 order by 1, 2, 3
`.trim()

// ── rpc_secret_reachable_by_anon ─────────────────────────────────────────────

export interface SecretRpcRow {
  schema: string
  name: string
  args: string
  security_definer: boolean
  anon_execute: boolean
  public_execute: boolean
  reads_secrets: boolean
}

function quoteIdent(s: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`
}

export function evaluateSecretRpcs(rows: readonly SecretRpcRow[] | null): Phase2Result<'rpc_secret_reachable_by_anon'> {
  const ruleId = 'rpc_secret_reachable_by_anon' as const
  if (rows === null) return { ruleId, state: 'unknown', reason: 'Could not read the database functions. Link the Supabase project to check.', findings: [] }
  const bad = rows.filter((r) => r.security_definer && r.reads_secrets && (r.anon_execute || r.public_execute))
  if (bad.length === 0) {
    return { ruleId, state: 'ok', reason: `Checked ${rows.length} SECURITY DEFINER function${rows.length === 1 ? '' : 's'}. None that reads secrets can be called without signing in.`, findings: [] }
  }
  const findings = bad.map((r) => {
    const fn = `${quoteIdent(r.schema)}.${quoteIdent(r.name)}(${r.args})`
    return {
      ruleId,
      severity: 'error' as const,
      message: `${fn} reads secrets and anyone can call it without signing in.`,
      target: fn,
      fix: `Add a migration file (do not run it by hand on production) with:\n  revoke execute on function ${fn} from anon, public;\nThen apply it with your normal migration step. Copied functions keep their grants, so check the other projects too.`,
      evidence: { anonExecute: r.anon_execute, publicExecute: r.public_execute },
    }
  })
  return { ruleId, state: 'finding', reason: `${bad.length} function${bad.length === 1 ? '' : 's'} that read secrets can be called by anyone.`, findings }
}

// ── storage_orphaned_bytes ───────────────────────────────────────────────────

export interface BucketSizeRow {
  bucket_id: string
  objects: number
  bytes: number
}

export const STORAGE_USD_PER_GB_MONTH = 0.021
const GB = 1024 ** 3

/**
 * Billed storage (from the platform's usage numbers) against the bytes the
 * object rows account for. A gap above 10% or 10 GB means files whose rows
 * are gone — usually rows deleted with SQL.
 */
export function evaluateOrphanedStorage(input: { billedBytes: number | null; buckets: readonly BucketSizeRow[] | null }): Phase2Result<'storage_orphaned_bytes'> {
  const ruleId = 'storage_orphaned_bytes' as const
  if (input.billedBytes === null || input.buckets === null) {
    return { ruleId, state: 'unknown', reason: 'Billed storage or the object list could not be read, so the two cannot be compared.', findings: [] }
  }
  const counted = input.buckets.reduce((n, b) => n + Number(b.bytes || 0), 0)
  const gap = input.billedBytes - counted
  const gb = (n: number) => (n / GB).toFixed(1)
  if (gap <= 0 || (gap <= 10 * GB && gap <= 0.1 * input.billedBytes)) {
    return { ruleId, state: 'ok', reason: `Billed storage (${gb(input.billedBytes)} GB) matches the files the database knows about (${gb(counted)} GB).`, findings: [] }
  }
  const usd = (gap / GB) * STORAGE_USD_PER_GB_MONTH
  return {
    ruleId,
    state: 'finding',
    reason: `About ${gb(gap)} GB is billed but not listed in storage.objects.`,
    findings: [{
      ruleId,
      severity: 'warn',
      message: `About ${gb(gap)} GB of storage is billed but no row points at it. Estimated cost: about $${usd.toFixed(2)} a month (estimate at $${STORAGE_USD_PER_GB_MONTH}/GB).`,
      target: null,
      fix: 'List the files in each bucket through the Storage API, compare them with storage.objects, and delete the orphans through the Storage API (supabase.storage.from(bucket).remove(paths)). Never delete storage rows with SQL; that is what leaves files behind.',
      evidence: { billedBytes: input.billedBytes, countedBytes: counted, gapBytes: gap, estimatedUsdPerMonth: Math.round(usd * 100) / 100 },
    }],
  }
}

// ── edge_fn_unauthenticated_paid ─────────────────────────────────────────────

export interface EdgeFunctionInput {
  slug: string
  verifyJwt: boolean | null
  /** The function's index source, when readable from the repo. */
  source: string | null
}

const PAID_KEY = /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|FIRECRAWL[A-Z_]*|BROWSERBASE[A-Z_]*|GEMINI_API_KEY|GOOGLE_API_KEY|ELEVENLABS[A-Z_]*|REPLICATE[A-Z_]*|RESEND_API_KEY|STRIPE_SECRET_KEY)\b/
const AUTH_CHECK = /requireServiceRoleAuth|auth\.getUser\(|\.getUser\(|verifySignature|verifyWebhook|timingSafeEqual|jwtVerify|verify\w*Signature|x-hub-signature|stripe-signature|apiKeyAuth|jwtAuth/i

export function evaluateUnauthenticatedPaidFunctions(fns: readonly EdgeFunctionInput[] | null): Phase2Result<'edge_fn_unauthenticated_paid'> {
  const ruleId = 'edge_fn_unauthenticated_paid' as const
  if (fns === null) return { ruleId, state: 'unknown', reason: 'Could not list the edge functions.', findings: [] }
  const open = fns.filter((f) => f.verifyJwt === false)
  const unread = open.filter((f) => f.source === null)
  const findings: Phase2Finding<'edge_fn_unauthenticated_paid'>[] = []
  for (const f of open) {
    if (f.source === null) continue
    const key = PAID_KEY.exec(f.source)
    if (!key || AUTH_CHECK.test(f.source)) continue
    findings.push({
      ruleId,
      severity: 'error',
      message: `The ${f.slug} function needs no sign-in and uses ${key[1]}. Anyone can call it and spend on that key.`,
      target: f.slug,
      fix: `Add an auth check at the top of ${f.slug} (for example requireServiceRoleAuth for a cron, or check the user's session), or undeploy it if the app no longer uses it.`,
      evidence: { verifyJwt: false, key: key[1] },
    })
  }
  if (findings.length > 0) return { ruleId, state: 'finding', reason: `${findings.length} open function${findings.length === 1 ? '' : 's'} can spend on a paid key.`, findings }
  if (unread.length > 0) return { ruleId, state: 'unknown', reason: `${unread.length} function${unread.length === 1 ? ' needs' : 's need'} no sign-in, but the source could not be read to check what ${unread.length === 1 ? 'it uses' : 'they use'}.`, findings: [] }
  return { ruleId, state: 'ok', reason: open.length ? `${open.length} function${open.length === 1 ? '' : 's'} need no sign-in, and none spends on a paid key without a check.` : 'Every function needs a sign-in.', findings: [] }
}

// ── backups ──────────────────────────────────────────────────────────────────

/**
 * `storageObjects` (optional): objects counted across buckets. A bucket can
 * list objects whose size metadata is missing, so 0 bytes with objects is
 * still "files are stored" — never "nothing is stored".
 */
export function evaluateBackups(input: { pitrEnabled: boolean | null; storageBytes: number | null; storageObjects?: number | null }): [Phase2Result<'pitr_disabled'>, Phase2Result<'storage_not_backed_up'>] {
  const pitr: Phase2Result<'pitr_disabled'> = input.pitrEnabled === null
    ? { ruleId: 'pitr_disabled', state: 'unknown', reason: 'Could not read the backup settings.', findings: [] }
    : input.pitrEnabled
      ? { ruleId: 'pitr_disabled', state: 'ok', reason: 'Point-in-time recovery is on.', findings: [] }
      : {
          ruleId: 'pitr_disabled',
          state: 'finding',
          reason: 'Point-in-time recovery is off.',
          findings: [{
            ruleId: 'pitr_disabled',
            severity: 'info',
            message: 'Point-in-time recovery is off. A bad migration or delete can only be undone to the last daily backup.',
            target: null,
            fix: 'Turn on point-in-time recovery in the Supabase dashboard (Database → Backups) if losing a day of data would hurt.',
          }],
        }
  const store: Phase2Result<'storage_not_backed_up'> = input.storageBytes === null
    ? { ruleId: 'storage_not_backed_up', state: 'unknown', reason: 'Could not read how much is in Storage.', findings: [] }
    : input.storageBytes === 0 && !(input.storageObjects && input.storageObjects > 0)
      ? { ruleId: 'storage_not_backed_up', state: 'ok', reason: 'Nothing is stored in Storage.', findings: [] }
      : {
          ruleId: 'storage_not_backed_up',
          state: 'finding',
          reason: 'Supabase backups do not include Storage files.',
          findings: [{
            ruleId: 'storage_not_backed_up',
            severity: 'info',
            message: 'Files in Storage are not part of Supabase database backups. If a bucket is emptied, they are gone.',
            target: null,
            fix: 'Copy important buckets somewhere else on a schedule (for example a nightly sync to another storage provider).',
          }],
        }
  return [pitr, store]
}

// ── function_grant_divergence (cross-project) ────────────────────────────────

export interface FunctionGrantRow {
  schema: string
  name: string
  args: string
  anon_execute: boolean
  authenticated_execute: boolean
  public_execute: boolean
}

/**
 * The same function signature with different anon/PUBLIC grants in two
 * projects of one organization: usually a function copied between projects
 * that brought (or lost) a grant. `null` grants for a project = not read.
 */
export function evaluateGrantDivergence(byProject: ReadonlyMap<string, readonly FunctionGrantRow[] | null>): Phase2Result<'function_grant_divergence'> {
  const ruleId = 'function_grant_divergence' as const
  const read = [...byProject.entries()].filter((e): e is [string, readonly FunctionGrantRow[]] => e[1] !== null)
  if (read.length < 2) return { ruleId, state: 'unknown', reason: 'Fewer than two linked projects could be read, so grants cannot be compared.', findings: [] }
  const sig = new Map<string, Array<{ projectId: string; open: boolean }>>()
  for (const [projectId, rows] of read) {
    for (const r of rows) {
      const key = `${r.schema}.${r.name}(${r.args})`
      const list = sig.get(key) ?? []
      list.push({ projectId, open: r.anon_execute || r.public_execute })
      sig.set(key, list)
    }
  }
  const findings: Phase2Finding<'function_grant_divergence'>[] = []
  for (const [fn, list] of sig) {
    if (list.length < 2) continue
    const open = list.filter((x) => x.open).map((x) => x.projectId)
    const closed = list.filter((x) => !x.open).map((x) => x.projectId)
    if (open.length === 0 || closed.length === 0) continue
    findings.push({
      ruleId,
      severity: 'warn',
      message: `${fn} can be called without signing in in ${open.length} project${open.length === 1 ? '' : 's'} but not in ${closed.length}.`,
      target: fn,
      fix: `Decide which is right. If it should be private, add a migration file in each open project with: revoke execute on function ${fn} from anon, public;`,
      evidence: { openIn: open, closedIn: closed },
    })
  }
  return findings.length
    ? { ruleId, state: 'finding', reason: `${findings.length} function${findings.length === 1 ? ' has' : 's have'} different grants across projects.`, findings }
    : { ruleId, state: 'ok', reason: `Compared function grants across ${read.length} projects; they agree.`, findings: [] }
}
