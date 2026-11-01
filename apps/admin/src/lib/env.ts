/**
 * FILE: apps/admin/src/lib/env.ts
 * PURPOSE: Centralized env-var check with dual-mode support (cloud vs self-hosted).
 *          Cloud mode: falls back to Mushi Mushi Cloud Supabase when no .env is set.
 *          Self-hosted mode: requires user-provided Supabase credentials.
 *
 * DETECTION PRIORITY:
 *   0. env.js says MUSHI_LOCAL_ONLY=1 → self-hosted, pinned to the URL the
 *      container wrote; the cloud fallback and saved browser choices are
 *      never used (Plan 023, ADR 0034)
 *   1. VITE_INSTANCE_TYPE=self-hosted explicitly set → self-hosted
 *   2. VITE_SUPABASE_URL set and differs from CLOUD_SUPABASE_URL → self-hosted
 *   3. Otherwise → cloud (uses hardcoded cloud defaults)
 *
 * RUNTIME ENV: the admin container writes `env.js` at start
 * (deploy/admin/40-mushi-env.sh) as `window.__MUSHI_ENV__ = {…}`, loaded by
 * index.html before the bundle. Its VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * and VITE_API_URL win over the values baked in at build time, so one image
 * serves any backend. The default public/env.js sets nothing.
 */

import { MUSHI_CANONICAL_URLS } from '@mushi-mushi/brand'

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
    if (config.mode === 'self-hosted') {
      const url = stripTrailingSlash((config.supabaseUrl ?? '').trim())
      const key = (config.supabaseAnonKey ?? '').trim()
      if (!isValidBackendUrl(url) || !key) return
      localStorage.setItem(STORAGE_KEY_MODE, config.mode)
      localStorage.setItem(STORAGE_KEY_URL, url)
      localStorage.setItem(STORAGE_KEY_KEY, key)
    } else {
      localStorage.setItem(STORAGE_KEY_MODE, config.mode)
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
const HARDCODED_CLOUD_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4cHRud3Jod3NxY2thZnR5eW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNDk4OTQsImV4cCI6MjA5MTgyNTg5NH0.Vs09uA6QY9CPi6PLZe2lO9kS27JgSWpbzFepMRzoaaM' // gitleaks:allow
export const CLOUD_SUPABASE_ANON_KEY =
  (import.meta.env.VITE_CLOUD_SUPABASE_ANON_KEY ?? '').trim() ||
  HARDCODED_CLOUD_ANON_KEY_FALLBACK
const CLOUD_API_URL = `${CLOUD_SUPABASE_URL}/functions/v1/api`

// Resolved env values with cloud fallback baked in. Use these everywhere
// instead of reading `import.meta.env.VITE_SUPABASE_URL` directly — when no
// .env is set (cloud mode default) the raw env var is `undefined`, which
// silently produces broken strings like `"undefined/functions/v1/api"`.
// Trailing slashes are normalized so `${url}/functions/v1/api` never produces `//`.
const stripTrailingSlash = (s: string) => s.replace(/\/+$/, '')

/** Supabase Cloud project refs are exactly 20 lowercase alphanumeric characters. */
const SUPABASE_CLOUD_REF_RE = /^[a-z0-9]{20}$/

/**
 * Validate a backend URL before persisting or resolving against it.
 * Rejects typo'd Supabase refs (e.g. 24-char garbage in localStorage) that
 * produce `Failed to fetch` on every admin API call.
 * @internal Exported for tests only.
 */
export function isValidBackendUrl(url: string): boolean {
  const trimmed = stripTrailingSlash(url.trim())
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname
    if (!host) return false
    if (host.endsWith('.supabase.co')) {
      const ref = host.slice(0, -'.supabase.co'.length)
      return SUPABASE_CLOUD_REF_RE.test(ref)
    }
    // Self-hosted / custom domain — any resolvable hostname is fine.
    return host.includes('.') || host === 'localhost'
  } catch {
    return false
  }
}

function clearStoredKeysOnly(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_MODE)
    localStorage.removeItem(STORAGE_KEY_URL)
    localStorage.removeItem(STORAGE_KEY_KEY)
  } catch { /* private browsing */ }
}

/** Drop corrupt runtime overrides so RESOLVED_* fall back to cloud defaults. */
function sanitizeStoredInstanceConfig(): ReturnType<typeof getStoredInstanceConfig> {
  const stored = getStoredInstanceConfig()
  if (!stored) return null
  if (stored.mode === 'cloud') return stored
  const url = stripTrailingSlash((stored.supabaseUrl ?? '').trim())
  const key = (stored.supabaseAnonKey ?? '').trim()
  if (!isValidBackendUrl(url) || !key) {
    clearStoredKeysOnly()
    return null
  }
  return { ...stored, supabaseUrl: url, supabaseAnonKey: key }
}

/** Backend values from env.js (runtime) or from the build. Empty when unset. */
interface BackendEnvValues {
  supabaseUrl: string
  supabaseAnonKey: string
  apiUrl: string
}

/** What the admin container wrote into `window.__MUSHI_ENV__`. */
interface RuntimeEnv extends BackendEnvValues {
  /** MUSHI_LOCAL_ONLY was set: never reach Mushi Cloud. */
  localOnly: boolean
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

/**
 * Parse the `window.__MUSHI_ENV__` object written by the admin container.
 * Anything that is not a non-empty string reads as unset.
 * @internal Exported for tests only.
 */
export function readRuntimeEnv(raw: unknown): RuntimeEnv {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const str = (key: string) => (typeof src[key] === 'string' ? (src[key] as string).trim() : '')
  return {
    supabaseUrl: stripTrailingSlash(str('VITE_SUPABASE_URL')),
    supabaseAnonKey: str('VITE_SUPABASE_ANON_KEY'),
    apiUrl: stripTrailingSlash(str('VITE_API_URL')),
    localOnly: TRUTHY.has(str('MUSHI_LOCAL_ONLY').toLowerCase()),
  }
}

interface ResolvedBackend {
  supabaseUrl: string
  supabaseAnonKey: string
  /** VITE_API_URL from env.js or the build; empty means "derive from the URL". */
  explicitApiUrl: string
  mode: InstanceMode
  localOnly: boolean
  /** Self-hosted only: env names with no value anywhere (shown by SetupGatePage). */
  missing: string[]
}

/**
 * Pick the backend the console talks to. Pure, so every precedence rule is
 * tested (env.test.ts):
 *
 *   local-only  env.js URL → build URL → `sameOrigin` (the local stack's
 *               gateway). Never the cloud constants, never a saved choice.
 *   otherwise   saved browser choice → env.js → build → Mushi Cloud.
 * @internal Exported for tests only.
 */
export function resolveBackend(input: {
  stored: ReturnType<typeof getStoredInstanceConfig>
  runtime: RuntimeEnv
  build: BackendEnvValues & { instanceType: string }
  cloud: { supabaseUrl: string; supabaseAnonKey: string }
  sameOrigin: string
}): ResolvedBackend {
  const { stored, runtime, build, cloud } = input
  const validUrl = (url: string) => (url && isValidBackendUrl(url) ? stripTrailingSlash(url) : '')
  const envUrl = validUrl(runtime.supabaseUrl) || validUrl(build.supabaseUrl)
  const envKey = runtime.supabaseAnonKey || build.supabaseAnonKey
  const explicitApiUrl = runtime.apiUrl || build.apiUrl

  if (runtime.localOnly) {
    const missing: string[] = []
    if (!envUrl) missing.push('VITE_SUPABASE_URL')
    if (!envKey) missing.push('VITE_SUPABASE_ANON_KEY')
    return {
      supabaseUrl: envUrl || stripTrailingSlash(input.sameOrigin),
      supabaseAnonKey: envKey,
      explicitApiUrl,
      mode: 'self-hosted',
      localOnly: true,
      missing,
    }
  }

  const supabaseUrl =
    // User explicitly chose Mushi Cloud → skip env vars (they may point to a
    // self-hosted instance) and go straight to the cloud constant.
    (stored?.mode === 'cloud' && cloud.supabaseUrl) ||
    (stored?.mode === 'self-hosted' && stored.supabaseUrl) ||
    envUrl ||
    cloud.supabaseUrl
  const supabaseAnonKey =
    // Same short-circuit: cloud mode must not fall through to env-var overrides.
    (stored?.mode === 'cloud' && cloud.supabaseAnonKey) ||
    (stored?.mode === 'self-hosted' && stored.supabaseAnonKey) ||
    envKey ||
    cloud.supabaseAnonKey

  // 1. Stored runtime preference (highest priority — user explicitly chose this)
  // 2. Build-time explicit override
  // 3. A configured URL that differs from cloud — infer self-hosted
  const rawUrl = runtime.supabaseUrl || build.supabaseUrl
  const mode: InstanceMode =
    stored?.mode ??
    (build.instanceType.toLowerCase() === 'self-hosted' || (rawUrl && rawUrl !== cloud.supabaseUrl)
      ? 'self-hosted'
      : 'cloud')

  // Self-hosted: the operator may have configured credentials at runtime via
  // BackendModePanel (stored in localStorage) or env.js rather than at build
  // time — those must count as "present" (validating only the raw build-time
  // vars was the original lockout bug). But we must validate the PRE-cloud-
  // fallback chain: the resolved values always terminate in the cloud
  // constants, so checking them makes `missing` permanently empty and
  // silently routes a credential-less self-hosted instance to the cloud.
  const missing: string[] = []
  if (mode === 'self-hosted') {
    if (!(stored?.supabaseUrl ?? '').trim() && !rawUrl) missing.push('VITE_SUPABASE_URL')
    if (!(stored?.supabaseAnonKey ?? '').trim() && !envKey) missing.push('VITE_SUPABASE_ANON_KEY')
  }
  return {
    supabaseUrl: stripTrailingSlash(supabaseUrl),
    supabaseAnonKey,
    explicitApiUrl,
    mode,
    localOnly: false,
    missing,
  }
}

const _runtimeEnv = readRuntimeEnv((globalThis as { __MUSHI_ENV__?: unknown }).__MUSHI_ENV__)

// Under local-only the saved browser choice is ignored, so it is not read
// (or cleaned) at all. Otherwise it takes precedence over env values.
const _storedAtLoad = _runtimeEnv.localOnly ? null : sanitizeStoredInstanceConfig()

const _backend = resolveBackend({
  stored: _storedAtLoad,
  runtime: _runtimeEnv,
  build: {
    supabaseUrl: (import.meta.env.VITE_SUPABASE_URL ?? '').trim(),
    supabaseAnonKey: (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
    apiUrl: stripTrailingSlash((import.meta.env.VITE_API_URL ?? '').trim()),
    instanceType: (import.meta.env.VITE_INSTANCE_TYPE ?? '').trim(),
  },
  cloud: { supabaseUrl: CLOUD_SUPABASE_URL, supabaseAnonKey: CLOUD_SUPABASE_ANON_KEY },
  sameOrigin: typeof window === 'undefined' ? '' : window.location.origin,
})

export const RESOLVED_SUPABASE_URL = _backend.supabaseUrl
export const RESOLVED_SUPABASE_ANON_KEY = _backend.supabaseAnonKey
export const RESOLVED_API_URL = stripTrailingSlash(resolveApiUrl())
export const RESOLVED_EXTERNAL_API_URL = stripTrailingSlash(
  RESOLVED_API_URL.startsWith('/')
    ? _backend.localOnly
      ? `${RESOLVED_SUPABASE_URL}/functions/v1/api`
      : CLOUD_API_URL
    : RESOLVED_API_URL,
)

/** True when the admin container set MUSHI_LOCAL_ONLY (env.js). */
export function isLocalOnly(): boolean {
  return _backend.localOnly
}

function resolveApiUrl(): string {
  const explicit = _backend.explicitApiUrl
  // Dev: route API through the Vite `/functions` proxy (any localhost port).
  if (import.meta.env.DEV) {
    if (!explicit || explicit.includes('.supabase.co')) {
      return '/functions/v1/api'
    }
  }
  return explicit || `${RESOLVED_SUPABASE_URL}/functions/v1/api`
}

/** Hosted Streamable HTTP MCP endpoint (Cursor remote / cloud orchestrators). */
export const RESOLVED_MCP_HTTP_URL = stripTrailingSlash(
  (import.meta.env.VITE_MCP_HTTP_URL ?? '').trim() || `${RESOLVED_SUPABASE_URL}/functions/v1/mcp`,
)

/**
 * The MCP URL to hand out for key-less OAuth sign-in (`claude mcp add` +
 * `/mcp` → Authenticate, Cursor remote without headers). Mushi Cloud's
 * supabase.co URL cannot be signed in to: clients look for OAuth metadata at
 * the host root, which on supabase.co is Supabase's gateway, so registration
 * 404s ("requested path is invalid"). kensaur.us serves those root paths. A
 * self-hosted URL is returned as-is — it needs an API-key header, or Claude
 * Code's `oauth.authServerMetadataUrl`.
 * @internal Exported for tests only.
 */
export function mcpOAuthSignInUrl(mcpHttpUrl: string): string {
  return stripTrailingSlash(mcpHttpUrl) === MUSHI_CANONICAL_URLS.mcp ? MUSHI_CANONICAL_URLS.hostedMcp : mcpHttpUrl
}

export const RESOLVED_MCP_OAUTH_URL = mcpOAuthSignInUrl(RESOLVED_MCP_HTTP_URL)

// Langfuse host used to build click-through URLs from fix attempts and LLM
// invocation rows. Defaults to the public cloud — self-hosted Langfuse users
// can override via VITE_LANGFUSE_HOST (e.g. https://langfuse.example.com).
const RESOLVED_LANGFUSE_HOST = stripTrailingSlash(
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

export function checkEnv(): EnvStatus {
  return {
    supabaseUrl: RESOLVED_SUPABASE_URL,
    supabaseAnonKey: RESOLVED_SUPABASE_ANON_KEY,
    apiUrl: RESOLVED_API_URL,
    missing: _backend.missing,
    ready: _backend.missing.length === 0,
    mode: _backend.mode,
  }
}

export function isCloudMode(): boolean {
  return _backend.mode === 'cloud'
}
