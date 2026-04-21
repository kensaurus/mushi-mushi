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

export const CLOUD_SUPABASE_URL = 'https://dxptnwrhwsqckaftyymj.supabase.co'
// Supabase anon key is public by design — it is the client-facing JWT that
// lets the browser talk to Supabase under RLS. Not a secret.
// check-no-secrets: ignore-next-line
export const CLOUD_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4cHRud3Jod3NxY2thZnR5eW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDk4OTQsImV4cCI6MjA5MTgyNTg5NH0.Vs09uA6QY9CPi6PLZe2lO9kS27JgSWpbzFepMRzoaaM'
export const CLOUD_API_URL = `${CLOUD_SUPABASE_URL}/functions/v1/api`

// Resolved env values with cloud fallback baked in. Use these everywhere
// instead of reading `import.meta.env.VITE_SUPABASE_URL` directly — when no
// .env is set (cloud mode default) the raw env var is `undefined`, which
// silently produces broken strings like `"undefined/functions/v1/api"`.
// Trailing slashes are normalized so `${url}/functions/v1/api` never produces `//`.
const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '')
export const RESOLVED_SUPABASE_URL = stripTrailingSlash(
  (import.meta.env.VITE_SUPABASE_URL ?? '').trim() || CLOUD_SUPABASE_URL,
)
export const RESOLVED_SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim() || CLOUD_SUPABASE_ANON_KEY
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
  const explicit = (import.meta.env.VITE_INSTANCE_TYPE ?? '').trim().toLowerCase()
  if (explicit === 'self-hosted') return 'self-hosted'
  if (supabaseUrl && supabaseUrl !== CLOUD_SUPABASE_URL) return 'self-hosted'
  return 'cloud'
}

export function checkEnv(): EnvStatus {
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
  const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
  const rawApi = (import.meta.env.VITE_API_URL ?? '').trim()

  const mode = detectMode(rawUrl)

  if (mode === 'cloud') {
    return {
      supabaseUrl: rawUrl || CLOUD_SUPABASE_URL,
      supabaseAnonKey: rawKey || CLOUD_SUPABASE_ANON_KEY,
      apiUrl: rawApi || CLOUD_API_URL,
      missing: [],
      ready: true,
      mode,
    }
  }

  const missing: string[] = []
  if (!rawUrl) missing.push('VITE_SUPABASE_URL')
  if (!rawKey) missing.push('VITE_SUPABASE_ANON_KEY')

  return {
    supabaseUrl: rawUrl,
    supabaseAnonKey: rawKey,
    apiUrl: rawApi,
    missing,
    ready: missing.length === 0,
    mode,
  }
}

export function isCloudMode(): boolean {
  const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
  return detectMode(rawUrl) === 'cloud'
}
