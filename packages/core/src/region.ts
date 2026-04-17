/**
 * Wave C C7: Data residency region resolution.
 *
 * The SDK supports four regional clouds:
 *   - 'us'   → United States (default; legacy `dxptnwrhwsqckaftyymj`)
 *   - 'eu'   → European Union (Frankfurt)
 *   - 'jp'   → Japan (Tokyo)
 *   - 'self' → self-hosted / BYO Supabase
 *
 * Customers choose a region at project creation time, and the gateway will
 * 307-redirect any cross-region calls to the correct host. The SDK caches
 * the resolved hostname in `localStorage` (browser) so that subsequent
 * sessions skip the redirect.
 */

export type MushiRegion = 'us' | 'eu' | 'jp' | 'self';

export const REGION_ENDPOINTS: Record<Exclude<MushiRegion, 'self'>, string> = {
  us: 'https://api.us.mushimushi.dev/functions/v1/api',
  eu: 'https://api.eu.mushimushi.dev/functions/v1/api',
  jp: 'https://api.jp.mushimushi.dev/functions/v1/api',
};

const ROUTING_CACHE_KEY = 'mushi_region_v1';
const ROUTING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface RegionCacheEntry {
  region: MushiRegion;
  endpoint: string;
  ts: number;
}

/**
 * Resolve the regional endpoint for a project. Looks up the public
 * `region_routing` table on the legacy US gateway (the catalog of record),
 * then caches the result.
 *
 * Falls back to the explicit `apiEndpoint` if anything goes wrong — failure
 * here must never block report submission.
 */
export async function resolveRegionEndpoint(opts: {
  projectId: string;
  apiEndpoint: string;
  region?: MushiRegion;
  storage?: Storage;
  fetcher?: typeof fetch;
}): Promise<string> {
  const explicit = opts.region;
  if (explicit && explicit !== 'self' && REGION_ENDPOINTS[explicit]) {
    return REGION_ENDPOINTS[explicit];
  }

  const storage = opts.storage ?? safeLocalStorage();
  const cached = readCache(storage, opts.projectId);
  if (cached) return cached;

  try {
    const fetcher = opts.fetcher ?? fetch;
    const url = `${opts.apiEndpoint.replace(/\/$/, '')}/v1/region/resolve?project_id=${encodeURIComponent(opts.projectId)}`;
    const res = await fetcher(url, { method: 'GET' });
    if (!res.ok) return opts.apiEndpoint;
    const body = (await res.json()) as { region?: MushiRegion; endpoint?: string };
    if (!body.region || !body.endpoint) return opts.apiEndpoint;
    writeCache(storage, opts.projectId, { region: body.region, endpoint: body.endpoint, ts: Date.now() });
    return body.endpoint;
  } catch {
    return opts.apiEndpoint;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? (globalThis as { localStorage: Storage }).localStorage
      : undefined;
  } catch {
    return undefined;
  }
}

function readCache(storage: Storage | undefined, projectId: string): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(`${ROUTING_CACHE_KEY}:${projectId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RegionCacheEntry;
    if (Date.now() - parsed.ts > ROUTING_CACHE_TTL_MS) return null;
    return parsed.endpoint;
  } catch {
    return null;
  }
}

function writeCache(storage: Storage | undefined, projectId: string, entry: RegionCacheEntry): void {
  if (!storage) return;
  try {
    storage.setItem(`${ROUTING_CACHE_KEY}:${projectId}`, JSON.stringify(entry));
  } catch {
    /* no-op: quota exceeded etc. */
  }
}
