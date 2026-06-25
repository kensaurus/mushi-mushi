/**
 * C7: Data residency.
 *
 * The Mushi cloud currently runs on a single Supabase project (`dxptnwrhwsqckaftyymj`).
 * Regional hostnames (us/eu/jp) are reserved for future multi-cluster routing;
 * until then all regions resolve to the same API origin.
 */

import type { Context, Next } from 'npm:hono@4'
import { getServiceClient } from './db.ts'

export type MushiRegion = 'us' | 'eu' | 'jp' | 'self'

const REGION_HOSTS: Record<Exclude<MushiRegion, 'self'>, string> = {
  us: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
  eu: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
  jp: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
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
