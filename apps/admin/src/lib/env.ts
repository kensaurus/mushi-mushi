/**
 * FILE: apps/admin/src/lib/env.ts
 * PURPOSE: Centralized env-var check with dual-mode support (cloud vs self-hosted).
 *          Cloud mode: falls back to Mushi Mushi Cloud Supabase when no .env is set.
 *          Self-hosted mode: requires user-provided Supabase credentials.
 *
 * DETECTION PRIORITY:
 *   1. VITE_INSTANCE_TYPE=self-hosted explicitly set → self-hosted
 *   2. VITE_SUPABASE_URL set and differs from CLOUD_SUPABASE_URL → self-hosted
 *   3. Otherwise → cloud (uses hardcoded cloud defaults)
 */

const STORAGE_KEY_MODE = 'mushi_admin_instance_mode'
const STORAGE_KEY_URL  = 'mushi_admin_supabase_url'
const STORAGE_KEY_KEY  = 'mushi_admin_supabase_anon_key'

/** Read a previously saved instance config from localStorage. Returns null in SSR. */
export function getStoredInstanceConfig(): {
  mode: InstanceMode
  supabaseUrl: string
  supabaseAnonKey: string
} | null {
  if (typeof window === 'undefined') return null
  try {
    const mode = localStorage.getItem(STORAGE_KEY_MODE) as InstanceMode | null
    if (!mode) return null
    return {
      mode,
      supabaseUrl: localStorage.getItem(STORAGE_KEY_URL) ?? '',
      supabaseAnonKey: localStorage.getItem(STORAGE_KEY_KEY) ?? '',
    }
  } catch {
    return null
  }
}

/** Persist an instance config to localStorage and reload so RESOLVED_* take effect. */
export function saveAndApplyInstanceConfig(config: {
  mode: InstanceMode
  supabaseUrl?: string
  supabaseAnonKey?: string
}): void {
  try {
    localStorage.setItem(STORAGE_KEY_MODE, config.mode)
    if (config.mode === 'self-hosted' && config.supabaseUrl) {
      localStorage.setItem(STORAGE_KEY_URL, config.supabaseUrl)
    }
    if (config.mode === 'self-hosted' && config.supabaseAnonKey) {
      localStorage.setItem(STORAGE_KEY_KEY, config.supabaseAnonKey)
    }
    if (config.mode === 'cloud') {
      localStorage.removeItem(STORAGE_KEY_URL)
      localStorage.removeItem(STORAGE_KEY_KEY)
    }
  } catch { /* localStorage blocked (private browsing) — fall through */ }
  window.location.reload()
}

/** Clear any stored config override and reload. */
export function clearStoredInstanceConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_MODE)
    localStorage.removeItem(STORAGE_KEY_URL)
    localStorage.removeItem(STORAGE_KEY_KEY)
  } catch {}
  window.location.reload()
}

// Cloud URL is overridable at build time via VITE_CLOUD_SUPABASE_URL so forks,
// staging clusters, and region replicas can reuse the same dogfood fallback
// path without patching source. Defaults to the primary production project.
export const CLOUD_SUPABASE_URL =
  (import.meta.env.VITE_CLOUD_SUPABASE_URL ?? '').trim() ||
  'https://dxptnwrhwsqckaftyymj.supabase.co'

// The Supabase anon key is public by design — a signed JWT that grants the
// browser the `anon` role under RLS. It is shipped to every client on every
// request. Historically we hardcoded the cloud value here so `npm install &&
// npm start` "just worked" without a .env file.
//
// SEC (Wave S1 / D-13): the hardcoded value is now a build-time fallback of
// last resort. In CI we set VITE_CLOUD_SUPABASE_ANON_KEY so rotating the cloud
// JWT no longer requires a source patch; the fallback literal stays so forks
// that build without any env still reach a usable cluster. Not a secret, but
// treating it like one lets us rotate on a predictable SLA.
// check-no-secrets: ignore-next-line
const HARDCODED_CLOUD_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4cHRud3Jod3NxY2thZnR5eW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDk4OTQsImV4cCI6MjA5MTgyNTg5NH0.Vs09uA6QY9CPi6PLZe2lO9kS27JgSWpbzFepMRzoaaM'
export const CLOUD_SUPABASE_ANON_KEY =
  (import.meta.env.VITE_CLOUD_SUPABASE_ANON_KEY ?? '').trim() ||
  HARDCODED_CLOUD_ANON_KEY_FALLBACK
export const CLOUD_API_URL = `${CLOUD_SUPABASE_URL}/functions/v1/api`

// Resolved env values with cloud fallback baked in. Use these everywhere
// instead of reading `import.meta.env.VITE_SUPABASE_URL` directly — when no
// .env is set (cloud mode default) the raw env var is `undefined`, which
// silently produces broken strings like `"undefined/functions/v1/api"`.
// Trailing slashes are normalized so `${url}/functions/v1/api` never produces `//`.
const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '')

// Stored config (runtime override) takes precedence over build-time env vars.
const _storedAtLoad = getStoredInstanceConfig()

export const RESOLVED_SUPABASE_URL = stripTrailingSlash(
  // User explicitly chose Mushi Cloud → skip env vars (they may point to a
  // self-hosted instance) and go straight to the cloud constant.
  (_storedAtLoad?.mode === 'cloud' && CLOUD_SUPABASE_URL) ||
  (_storedAtLoad?.mode === 'self-hosted' && _storedAtLoad.supabaseUrl) ||
  (import.meta.env.VITE_SUPABASE_URL ?? '').trim() ||
  CLOUD_SUPABASE_URL,
)
export const RESOLVED_SUPABASE_ANON_KEY =
  // Same short-circuit: cloud mode must not fall through to env-var overrides.
  (_storedAtLoad?.mode === 'cloud' && CLOUD_SUPABASE_ANON_KEY) ||
  (_storedAtLoad?.mode === 'self-hosted' && _storedAtLoad.supabaseAnonKey) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim() ||
  CLOUD_SUPABASE_ANON_KEY
export const RESOLVED_API_URL = stripTrailingSlash(
  (import.meta.env.VITE_API_URL ?? '').trim() || `${RESOLVED_SUPABASE_URL}/functions/v1/api`,
)

// Langfuse host used to build click-through URLs from fix attempts and LLM
// invocation rows. Defaults to the public cloud — self-hosted Langfuse users
// can override via VITE_LANGFUSE_HOST (e.g. https://langfuse.example.com).
export const RESOLVED_LANGFUSE_HOST = stripTrailingSlash(
  (import.meta.env.VITE_LANGFUSE_HOST ?? '').trim() || 'https://cloud.langfuse.com',
)

/**
 * Build a deep-link to a Langfuse trace. Returns null when no traceId is set
 * so the caller can render a disabled badge instead of a dead link.
 *
 * Optional `host` overrides the resolved env-level default. Pass the per-project
 * `langfuse_host` from the integrations API so Mushi tenants on US/EU/self-hosted
 * Langfuse all get correct deep-links without rebuilding the bundle.
 */
export function langfuseTraceUrl(
  traceId: string | null | undefined,
  host?: string | null,
): string | null {
  if (!traceId) return null
  const base = stripTrailingSlash((host ?? '').trim() || RESOLVED_LANGFUSE_HOST)
  return `${base}/trace/${encodeURIComponent(traceId)}`
}

export type InstanceMode = 'cloud' | 'self-hosted'

export interface EnvStatus {
  supabaseUrl: string
  supabaseAnonKey: string
  apiUrl: string
  missing: string[]
  ready: boolean
  mode: InstanceMode
}

function detectMode(supabaseUrl: string): InstanceMode {
  // 1. Stored runtime preference (highest priority — user explicitly chose this)
  if (_storedAtLoad?.mode) return _storedAtLoad.mode
  // 2. Build-time explicit override
  const explicit = (import.meta.env.VITE_INSTANCE_TYPE ?? '').trim().toLowerCase()
  if (explicit === 'self-hosted') return 'self-hosted'
  // 3. URL differs from cloud — infer self-hosted
  if (supabaseUrl && supabaseUrl !== CLOUD_SUPABASE_URL) return 'self-hosted'
  return 'cloud'
}

export function checkEnv(): EnvStatus {
  // detectMode needs the raw build-time URL only for the "URL differs from
  // cloud → infer self-hosted" heuristic (priority 3). Priorities 1 and 2
  // are independent of the URL value.
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()

  const mode = detectMode(rawUrl)

  if (mode === 'cloud') {
    return {
      supabaseUrl: RESOLVED_SUPABASE_URL,
      supabaseAnonKey: RESOLVED_SUPABASE_ANON_KEY,
      apiUrl: RESOLVED_API_URL,
      missing: [],
      ready: true,
      mode,
    }
  }

  // Self-hosted: the operator may have configured credentials at runtime via
  // BackendModePanel (stored in localStorage) rather than at build time via
  // .env — stored credentials must count as "present" (validating only the
  // raw build-time vars was the original lockout bug). But we must validate
  // the PRE-cloud-fallback chain: RESOLVED_* always terminate in the cloud
  // constants, so checking them directly makes `missing` permanently empty
  // and silently routes a credential-less self-hosted instance to the
  // production cloud project.
  const storedUrl = (_storedAtLoad?.supabaseUrl ?? '').trim()
  const storedKey = (_storedAtLoad?.supabaseAnonKey ?? '').trim()
  const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  const missing: string[] = []
  if (!storedUrl && !rawUrl) missing.push('VITE_SUPABASE_URL')
  if (!storedKey && !rawKey) missing.push('VITE_SUPABASE_ANON_KEY')

  return {
    supabaseUrl: RESOLVED_SUPABASE_URL,
    supabaseAnonKey: RESOLVED_SUPABASE_ANON_KEY,
    apiUrl: RESOLVED_API_URL,
    missing,
    ready: missing.length === 0,
    mode,
  }
}

export function isCloudMode(): boolean {
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
  return detectMode(rawUrl) === 'cloud'
}
