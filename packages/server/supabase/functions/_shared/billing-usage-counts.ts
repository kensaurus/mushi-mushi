/**
 * This billing period's usage and LLM cost for one project, for
 * /v1/admin/billing/stats. Count-only / SQL aggregate reads: the route used
 * to pull every usage_events row for every project unbounded (PostgREST
 * caps a read at 1000 rows, so a busy month under-reported).
 */

import { log } from './logger.ts'
import type { getServiceClient } from './db.ts'

type ServiceDb = ReturnType<typeof getServiceClient>;

/**
 * This period's usage for one project as exact head counts (no rows read).
 * Diagnoses exclude Phase-1 shadow rows: shadow = all − shadow:true, which
 * keeps rows that have no `shadow` key (a `not.eq.true` filter drops them,
 * because NULL <> 'true' is NULL).
 */
export async function countPeriodUsage(
  db: ServiceDb,
  projectId: string,
  sinceIso: string,
): Promise<{ reports: number; fixes: number; fixesSucceeded: number; diagnoses: number } | Error> {
  const count = (event: string) =>
    db
      .from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('event_name', event)
      .gte('occurred_at', sinceIso);
  const [reports, fixes, fixesSucceeded, diagnosesAll, diagnosesShadow] = await Promise.all([
    count('reports_ingested'),
    count('fixes_attempted'),
    count('fixes_succeeded'),
    count('diagnoses'),
    count('diagnoses').eq('metadata->>shadow', 'true'),
  ]);
  for (const r of [reports, fixes, fixesSucceeded, diagnosesAll, diagnosesShadow]) {
    if (r.error) return new Error(r.error.message);
  }
  return {
    reports: reports.count ?? 0,
    fixes: fixes.count ?? 0,
    fixesSucceeded: fixesSucceeded.count ?? 0,
    diagnoses: Math.max(0, (diagnosesAll.count ?? 0) - (diagnosesShadow.count ?? 0)),
  };
}

/**
 * Recorded LLM cost since `sinceIso` via llm_cost_usd_since (migration
 * 20261004120000). Until that is applied, sum the newest rows (PostgREST
 * returns at most 1000) and log it, as the route did before.
 */
export async function llmCostSince(db: ServiceDb, projectId: string, sinceIso: string): Promise<number> {
  const { data, error } = await db.rpc('llm_cost_usd_since', { p_project_id: projectId, p_since: sinceIso });
  if (!error && data != null) return Number(data) || 0;
  log.warn('llm_cost_usd_since unavailable; summing rows', { err: error?.message ?? 'no data' });
  const { data: rows } = await db
    .from('llm_invocations')
    .select('cost_usd')
    .eq('project_id', projectId)
    .gte('created_at', sinceIso)
    .not('cost_usd', 'is', null);
  return ((rows ?? []) as Array<{ cost_usd: number | string | null }>).reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
}

