// ============================================================
// Retention sweep (cron, daily 03:00 UTC).
//
// Why this exists: M2 from the QA report. `pricing_plans.retention_days`
// has shipped for months but nothing actually deletes old rows. A
// Hobby plan promises a 7-day window; a Pro plan promises 90; we
// honor neither. The SOC 2 migration (20260418001300) shipped
// `mushi_apply_retention_policies()` which ONLY consults
// `project_retention_policies` — projects without an explicit policy
// row are never swept, which is most of them.
//
// This sweep:
//   1. For every project, resolves the effective retention window.
//      Precedence:
//        a. project_retention_policies.reports_retention_days (explicit
//           per-tenant override; SOC 2 customers set this).
//        b. pricing_plans.retention_days for the active subscription
//           (the implicit plan-level promise).
//        c. Falls back to the Hobby default (7 days) when the project
//           has no active subscription at all.
//      Legal-hold rows in project_retention_policies are skipped — the
//      legal_hold flag means "do not delete, regardless of plan".
//   2. Deletes `reports` rows older than the cutoff in batches of 1000.
//      The CASCADE on reports deletes report-attached rows
//      automatically (report_events, dispatch_jobs); no need to walk
//      them manually.
//   3. Writes ONE audit_logs row per project per sweep with
//      { deleted_count, retention_days, plan_id, source }, so the
//      operator UI can render "last sweep on X projects, deleted N rows".
//
// Why batches of 1000: Supabase's PostgREST blocks DELETE with no
// limit on tables larger than ~10MB. We bracket each project's delete
// loop and exit early once a batch returns < 1000 rows (the natural
// signal we're caught up).
//
// Cron auth: shared MUSHI_INTERNAL_CALLER_SECRET via
// `requireServiceRoleAuth`. Same gate every cron-triggered function
// uses. The cron itself is wired by the `20260427_retention_sweep_cron.sql`
// migration via mushi_internal_auth_header().
// ============================================================
import { getServiceClient } from '../_shared/db.ts'
import { log } from '../_shared/logger.ts'
import { startCronRun } from '../_shared/telemetry.ts'
import { withSentry } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'
import { listPlans, resolvePlanFromSubscription, type PricingPlan } from '../_shared/plans.ts'

// Ambient `Deno` so the file type-checks under both Deno (real Edge Function
// runtime) and Node/Vitest (the unit tests for `deleteOldReportsBatch`).
// Declared at the top of the module so the `typeof Deno !== 'undefined'`
// guard at the bottom doesn't read like it's referencing an unresolved
// symbol.
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}

const rlog = log.child('retention-sweep')

const BATCH_SIZE = 1000
const HOBBY_FALLBACK_DAYS = 7

interface ProjectRow {
  id: string
}

interface ReportIdRow {
  id: string
}

interface SubscriptionRow {
  project_id: string
  status: string
  plan_id: string | null
}

interface RetentionPolicyRow {
  project_id: string
  reports_retention_days: number
  legal_hold: boolean
}

interface SweepStat {
  project_id: string
  retention_days: number
  plan_id: string
  source: 'override' | 'plan' | 'fallback'
  deleted_count: number
  legal_hold: boolean
}

const handler = async (req: Request): Promise<Response> => {
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getServiceClient()
  const cron = await startCronRun(db, 'retention-sweep', 'cron')

  try {
    const stats = await runSweep(db)
    const totalDeleted = stats.reduce((sum, s) => sum + s.deleted_count, 0)
    const skippedLegalHold = stats.filter((s) => s.legal_hold).length

    await cron.finish({
      rowsAffected: totalDeleted,
      metadata: {
        projects_swept: stats.length,
        total_deleted: totalDeleted,
        skipped_legal_hold: skippedLegalHold,
      },
    })

    return Response.json({
      ok: true,
      data: {
        projects_swept: stats.length,
        total_deleted: totalDeleted,
        skipped_legal_hold: skippedLegalHold,
        per_project: stats,
      },
    })
  } catch (err) {
    rlog.error('retention_sweep_failed', {
      err: err instanceof Error ? err.message : String(err),
    })
    await cron.fail(err)
    throw err
  }
}

// Exported so the GET /v1/admin/retention-status endpoint can reuse the
// same plan-resolution logic when computing "what would the next sweep
// delete?" without duplicating the precedence rules.
export async function resolveProjectRetention(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<{ retention_days: number; plan_id: string; source: SweepStat['source']; legal_hold: boolean }> {
  const { data: policy } = await db
    .from('project_retention_policies')
    .select('project_id, reports_retention_days, legal_hold')
    .eq('project_id', projectId)
    .maybeSingle<RetentionPolicyRow>()

  if (policy?.legal_hold) {
    return {
      retention_days: policy.reports_retention_days ?? HOBBY_FALLBACK_DAYS,
      plan_id: 'legal_hold',
      source: 'override',
      legal_hold: true,
    }
  }

  if (policy && policy.reports_retention_days) {
    return {
      retention_days: policy.reports_retention_days,
      plan_id: 'override',
      source: 'override',
      legal_hold: false,
    }
  }

  const { data: sub } = await db
    .from('billing_subscriptions')
    .select('project_id, status, plan_id')
    .eq('project_id', projectId)
    .in('status', ['active', 'trialing', 'past_due'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle<SubscriptionRow>()

  const plan = await resolvePlanFromSubscription(sub)

  return {
    retention_days: plan.retention_days ?? HOBBY_FALLBACK_DAYS,
    plan_id: plan.id,
    source: sub ? 'plan' : 'fallback',
    legal_hold: false,
  }
}

async function runSweep(db: ReturnType<typeof getServiceClient>): Promise<SweepStat[]> {
  // Hot-load the plans cache once so per-project resolution is in-memory
  // after the first call. listPlans() is the canonical warmer.
  const plans: PricingPlan[] = await listPlans()
  rlog.info('retention_sweep_started', { plan_count: plans.length })

  const { data: projects, error } = await db
    .from('projects')
    .select('id')
    .returns<ProjectRow[]>()

  if (error) {
    rlog.error('list_projects_failed', { err: error.message })
    return []
  }

  const stats: SweepStat[] = []

  for (const proj of projects ?? []) {
    const { retention_days, plan_id, source, legal_hold } = await resolveProjectRetention(
      db,
      proj.id,
    )

    if (legal_hold) {
      stats.push({
        project_id: proj.id,
        retention_days,
        plan_id,
        source,
        deleted_count: 0,
        legal_hold: true,
      })
      continue
    }

    const cutoff = new Date(Date.now() - retention_days * 24 * 60 * 60 * 1000).toISOString()

    let totalDeleted = 0
    // Iterate batches until we drain the over-cutoff backlog. Bound the
    // outer loop at 50 batches (50,000 rows / project / day) so a
    // pathological backlog can't burn a function execution budget.
    for (let i = 0; i < 50; i++) {
      const { deleted, error: delErr } = await deleteOldReportsBatch(db, proj.id, cutoff)
      if (delErr) {
        rlog.error('delete_batch_failed', {
          project_id: proj.id,
          err: delErr,
        })
        break
      }
      const batchSize = deleted
      totalDeleted += batchSize
      if (batchSize < BATCH_SIZE) break
    }

    if (totalDeleted > 0) {
      const { error: auditErr } = await db.from('audit_logs').insert({
        project_id: proj.id,
        actor_id: '00000000-0000-0000-0000-000000000000',
        actor_email: 'retention-sweep@mushi-mushi',
        actor_type: 'system',
        action: 'retention.sweep',
        resource_type: 'reports',
        resource_id: null,
        metadata: {
          deleted_count: totalDeleted,
          retention_days,
          plan_id,
          source,
          cutoff,
        },
      })
      if (auditErr) {
        rlog.warn('audit_insert_failed', {
          project_id: proj.id,
          err: auditErr.message,
        })
      }
    }

    stats.push({
      project_id: proj.id,
      retention_days,
      plan_id,
      source,
      deleted_count: totalDeleted,
      legal_hold: false,
    })
  }

  return stats
}

/**
 * PostgREST surfaces transient schema-cache misses as
 * `column "<table>.<col>" does not exist` immediately after an `ALTER
 * TABLE` migration runs (the schema cache is populated lazily over the
 * first 1-30s after a structural change). Detecting them by message
 * substring is brittle but cheap; falling back to a permanent error
 * after one short retry is the right shape — if the column actually
 * doesn't exist, the second call fails with the same string and we
 * surface it for real.
 *
 * Sentry MUSHI-MUSHI-SERVER-N (2026-04-29 03:00 UTC): the daily
 * retention sweep cron fired ~3 minutes after migration
 * `20260429000000_sdk_versions.sql` added two columns to `reports`,
 * caught a stale cache, and reported `column reports.created_at does
 * not exist` even though the column has existed since day-one. One
 * 500-ms retry would have fixed it transparently.
 */
function isSchemaCacheMiss(message: string | null | undefined): boolean {
  if (!message) return false
  return /column .* does not exist|relation .* does not exist|schema cache/i.test(message)
}

const SCHEMA_CACHE_RETRY_DELAY_MS = 500

/**
 * Delete one retention batch using the Postgres-recommended shape:
 *
 *   DELETE FROM reports WHERE id IN (
 *     SELECT id FROM reports WHERE ... ORDER BY created_at LIMIT n
 *   )
 *
 * PostgREST/supabase-js exposes that most safely as two requests:
 * select candidate IDs, then delete by primary key. The previous one-shot
 * chain (`delete().eq().lt().order().limit().select()`) looks natural but
 * PostgREST does not model ordered/limited DELETE the same way it models
 * ordered/limited SELECT, which surfaced as Sentry `delete_batch_failed`.
 */
export async function deleteOldReportsBatch(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  cutoff: string,
  batchSize = BATCH_SIZE,
): Promise<{ deleted: number; error: string | null }> {
  const runSelect = () =>
    db
      .from('reports')
      .select('id')
      .eq('project_id', projectId)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(batchSize)
      .returns<ReportIdRow[]>()

  let { data: candidates, error: selectErr } = await runSelect()

  if (selectErr && isSchemaCacheMiss(selectErr.message)) {
    rlog.warn('reports_select_schema_cache_miss', {
      project_id: projectId,
      err: selectErr.message,
      retrying_in_ms: SCHEMA_CACHE_RETRY_DELAY_MS,
    })
    await new Promise((resolve) => setTimeout(resolve, SCHEMA_CACHE_RETRY_DELAY_MS))
    ;({ data: candidates, error: selectErr } = await runSelect())
  }

  if (selectErr) return { deleted: 0, error: selectErr.message }

  const ids = (candidates ?? []).map((row) => row.id).filter(Boolean)
  if (ids.length === 0) return { deleted: 0, error: null }

  const { data: deletedRows, error: deleteErr } = await db
    .from('reports')
    .delete()
    .in('id', ids)
    .select('id')
    .returns<ReportIdRow[]>()

  if (deleteErr) return { deleted: 0, error: deleteErr.message }

  return { deleted: deletedRows?.length ?? ids.length, error: null }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('retention-sweep', handler))
}
