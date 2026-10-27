/**
 * FILE: packages/server/supabase/functions/_shared/github-deploy-observation.ts
 * PURPOSE: Turn a GitHub production deployment into one `deploy_observations`
 *          row (`source = 'github_deployment'`). The pipeline, release batch
 *          and setup gap all decide "deployed" from that table. Until this
 *          writer, a production `deployment_status` only scheduled opt-in
 *          auto-release and the daily collector never read GitHub deployments,
 *          so a merged fix stayed "no deploy seen".
 *
 * OVERVIEW:
 * - Production is `production_environment` or an environment named production.
 * - Only a finished success, failure or error is stored. Preview, staging,
 *   queued and in-progress deploys are not a deploy of the fix.
 * - `observed_at` is GitHub's timestamp, so a collector run days later does
 *   not mark every recent merge deployed.
 *
 * DEPENDENCIES: Supabase client type only. No Deno globals at module scope.
 *
 * USAGE: `routeGithubShipEvent` (webhook) and `collectProjectPhase2` (the
 *        GitHub connector's deployment facts).
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const PRODUCTION_ENV = /^prod(uction)?$/i
const SHA_RE = /^[0-9a-f]{7,64}$/i
/** A version tag. Branch names (`main`) are not a version reporters see. */
const VERSION_REF_RE = /^v?\d+(\.\d+){1,3}([-+][0-9A-Za-z.-]+)?$/

export function isProductionDeploy(environment: string, productionFlag: boolean | null | undefined): boolean {
  return productionFlag === true || PRODUCTION_ENV.test(environment.trim())
}

/** Stable id within `deploy_observations.target_id` (1–80). Not a recipe target id. */
export function githubDeploymentTargetId(environment: string): string {
  const slug = environment.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `gh-${slug || 'production'}`.slice(0, 80)
}

export interface DeployObservationInsert {
  target_id: string
  environment: string | null
  observed_commit: string | null
  observed_version: string | null
  ok: boolean
  error: string | null
  source: 'github_deployment'
  observed_at: string
}

/**
 * A row to insert, or null when this delivery is not a finished production
 * deploy. `now` is only a fallback when GitHub sent no usable timestamp
 * (the webhook). The collector omits it, so an undated fact is skipped.
 */
export function observationFromGithubDeployment(input: {
  state: string | null | undefined
  environment: string | null | undefined
  production?: boolean | null
  sha: string | null | undefined
  ref?: string | null
  updatedAt?: string | null
  now?: Date
}): DeployObservationInsert | null {
  const state = (input.state ?? '').trim().toLowerCase()
  if (state !== 'success' && state !== 'failure' && state !== 'error') return null
  const environment = (input.environment ?? '').trim()
  if (!isProductionDeploy(environment, input.production)) return null
  const sha = (input.sha ?? '').trim().toLowerCase()
  if (!SHA_RE.test(sha)) return null
  const parsed = input.updatedAt ? Date.parse(input.updatedAt) : NaN
  const at = Number.isNaN(parsed) ? (input.now?.toISOString() ?? null) : new Date(parsed).toISOString()
  if (!at) return null
  const ref = (input.ref ?? '').trim()
  return {
    target_id: githubDeploymentTargetId(environment || 'production'),
    environment: environment.slice(0, 60) || null,
    observed_commit: sha,
    observed_version: VERSION_REF_RE.test(ref) ? ref.slice(0, 100) : null,
    ok: state === 'success',
    error: state === 'success' ? null : `GitHub deployment ${state}`,
    source: 'github_deployment',
    observed_at: at,
  }
}

/** Deployments the GitHub connector stored on its snapshot facts. */
export function observationsFromGithubFacts(facts: unknown): DeployObservationInsert[] {
  if (!facts || typeof facts !== 'object') return []
  const list = (facts as { deployments?: unknown }).deployments
  if (!Array.isArray(list)) return []
  const out: DeployObservationInsert[] = []
  for (const item of list.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    const row = observationFromGithubDeployment({
      state: typeof d.state === 'string' ? d.state : null,
      environment: typeof d.environment === 'string' ? d.environment : null,
      production: d.production === true,
      sha: typeof d.sha === 'string' ? d.sha : null,
      ref: typeof d.ref === 'string' ? d.ref : null,
      updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : null,
    })
    if (row) out.push(row)
  }
  return out
}

/**
 * Insert unless this project already has this target, commit, outcome and
 * GitHub timestamp (webhook redelivery and the daily collector).
 */
export async function recordGithubDeployObservation(
  db: SupabaseClient,
  projectId: string,
  row: DeployObservationInsert,
): Promise<'stored' | 'duplicate' | 'error'> {
  const existing = await db
    .from('deploy_observations')
    .select('id')
    .eq('project_id', projectId)
    .eq('target_id', row.target_id)
    .eq('observed_commit', row.observed_commit)
    .eq('ok', row.ok)
    .eq('observed_at', row.observed_at)
    .limit(1)
  if (existing.error) return 'error'
  if (Array.isArray(existing.data) && existing.data.length > 0) return 'duplicate'
  const inserted = await db.from('deploy_observations').insert({
    project_id: projectId,
    target_id: row.target_id,
    kind: 'github',
    environment: row.environment,
    observed_version: row.observed_version,
    observed_commit: row.observed_commit,
    source: row.source,
    ok: row.ok,
    error: row.error,
    observed_at: row.observed_at,
  })
  return inserted.error ? 'error' : 'stored'
}
