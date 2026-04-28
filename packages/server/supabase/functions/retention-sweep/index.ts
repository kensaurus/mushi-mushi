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

const rlog = log.child('retention-sweep')

const BATCH_SIZE = 1000
const HOBBY_FALLBACK_DAYS = 7

interface ProjectRow {
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
      const { data: deleted, error: delErr } = await db
        .from('reports')
        .delete()
        .eq('project_id', proj.id)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE)
        .select('id')
      if (delErr) {
        rlog.error('delete_batch_failed', {
          project_id: proj.id,
          err: delErr.message,
        })
        break
      }
      const batchSize = deleted?.length ?? 0
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

Deno.serve(withSentry('retention-sweep', handler))

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void
  env: { get(name: string): string | undefined }
}
