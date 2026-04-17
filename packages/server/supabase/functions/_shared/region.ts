/**
 * Wave C C7: Data residency.
 *
 * The Mushi cloud runs three regional Supabase projects:
 *   - us  → api.us.mushimushi.dev  (legacy / default)
 *   - eu  → api.eu.mushimushi.dev
 *   - jp  → api.jp.mushimushi.dev
 *
 * Each cluster runs the *same* Edge Function code; the difference is which
 * Postgres they talk to and which `MUSHI_CLUSTER_REGION` env var they were
 * deployed with. The gateway middleware below transparently 307-redirects
 * any request whose project is pinned to a different region — without ever
 * touching that project's data on the wrong cluster.
 *
 * The legacy (`dxptn…`) project remains the *catalog of record* for the
 * `region_routing` table so that:
 *   1. New SDKs pointing at the legacy host still get redirected.
 *   2. Existing customers' data never moves silently.
 */

import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'

export type MushiRegion = 'us' | 'eu' | 'jp' | 'self'

const REGION_HOSTS: Record<Exclude<MushiRegion, 'self'>, string> = {
  us: 'https://api.us.mushimushi.dev/functions/v1/api',
  eu: 'https://api.eu.mushimushi.dev/functions/v1/api',
  jp: 'https://api.jp.mushimushi.dev/functions/v1/api',
}

let cachedRegion: MushiRegion | null = null

/** Region this cluster was deployed to serve. Defaults to 'us' (legacy). */
export function currentRegion(): MushiRegion {
  if (cachedRegion) return cachedRegion
  const fromEnv = (Deno.env.get('MUSHI_CLUSTER_REGION') ?? 'us').toLowerCase()
  cachedRegion = (['us', 'eu', 'jp', 'self'].includes(fromEnv) ? fromEnv : 'us') as MushiRegion
  return cachedRegion
}

export function regionEndpoint(region: MushiRegion): string {
  if (region === 'self') return ''
  return REGION_HOSTS[region]
}

/**
 * Look up which region a project belongs to. Reads from the public
 * `region_routing` table; cached in-memory for 5 minutes per project to
 * avoid a DB round-trip on every report ingest.
 */
const routingCache = new Map<string, { region: MushiRegion; expiresAt: number }>()
const ROUTING_TTL_MS = 5 * 60 * 1000

export async function lookupProjectRegion(projectId: string): Promise<MushiRegion | null> {
  const cached = routingCache.get(projectId)
  if (cached && cached.expiresAt > Date.now()) return cached.region

  const db = getServiceClient()
  const { data, error } = await db
    .from('region_routing')
    .select('region')
    .eq('project_id', projectId)
    .maybeSingle()

  if (error || !data) return null
  const region = data.region as MushiRegion
  routingCache.set(projectId, { region, expiresAt: Date.now() + ROUTING_TTL_MS })
  return region
}

/**
 * Hono middleware. Run *before* `apiKeyAuth` so cross-region calls get
 * redirected before we touch the project_api_keys table on the wrong
 * cluster. Falls through (no redirect) if:
 *   - The header is missing (old SDK; will fail auth anyway).
 *   - The project has no pinned region (uses cluster default).
 *   - The pinned region matches this cluster.
 */
export async function regionRouter(c: Context, next: Next) {
  const projectId = c.req.header('X-Mushi-Project')
  if (!projectId) return next()

  const target = await lookupProjectRegion(projectId)
  if (!target || target === 'self') return next()
  if (target === currentRegion()) return next()

  const base = regionEndpoint(target)
  if (!base) return next()
  const url = new URL(c.req.url)
  const redirect = `${base}${url.pathname.replace(/^.*\/api/, '')}${url.search}`
  return new Response(null, {
    status: 307,
    headers: {
      Location: redirect,
      'X-Mushi-Region-From': currentRegion(),
      'X-Mushi-Region-To': target,
    },
  })
}
