/**
 * C8: BYO Storage abstraction.
 *
 * One adapter shape, four backends:
 *   - 'supabase' → built-in Supabase Storage (default)
 *   - 's3'       → AWS S3
 *   - 'r2'       → Cloudflare R2
 *   - 'gcs'      → Google Cloud Storage
 *   - 'minio'    → self-hosted MinIO (S3-compatible)
 *
 * Secrets are resolved from Supabase Vault references stored on the
 * `project_storage_settings` row — raw access keys are never persisted in
 * application tables. The S3-compatible backends (s3/r2/minio) all use the
 * same SigV4 path; only the endpoint and signing region differ.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getServiceClient } from './db.ts'
import { log } from './logger.ts'

const storageLog = log.child('storage')

export type StorageProvider = 'supabase' | 's3' | 'r2' | 'gcs' | 'minio'

export interface StorageSettings {
  project_id: string
  provider: StorageProvider
  bucket: string
  region: string | null
  endpoint: string | null
  path_prefix: string
  signed_url_ttl_secs: number
  use_signed_urls: boolean
  access_key_vault_ref: string | null
  secret_key_vault_ref: string | null
  service_account_vault_ref: string | null
  kms_key_id: string | null
  encryption_required: boolean
}

export interface UploadInput {
  key: string                 // path inside the bucket (no leading slash)
  body: Uint8Array
  contentType: string
  /** SEC (Wave 5 Gap-B): TTL for signed URL in seconds. Defaults to 3600. */
  ttlSecs?: number
}

export interface UploadResult {
  url: string                 // either public URL or signed URL
  storagePath: string         // canonical storage:// URL for our DB
  signed: boolean
}

export interface HealthDebugStep {
  step: string
  ok: boolean
  ms: number
  detail?: string
}

export interface HealthCheckResult {
  ok: boolean
  error?: string
  debug: HealthDebugStep[]
}

export interface StorageAdapter {
  upload(input: UploadInput): Promise<UploadResult>
  signedUrl(key: string, ttlSecs?: number): Promise<string>
  delete(key: string): Promise<void>
  healthCheck(): Promise<HealthCheckResult>
}

const settingsCache = new Map<string, { settings: StorageSettings | null; expiresAt: number }>()
const SETTINGS_TTL_MS = 60 * 1000
const CLUSTER_DEFAULT_BUCKET = 'screenshots'

/** Normalize legacy / typo bucket names to the cluster default Supabase bucket. */
function resolveSupabaseBucket(configured?: string | null): string {
  if (!configured || configured === CLUSTER_DEFAULT_BUCKET) return CLUSTER_DEFAULT_BUCKET
  // Admin once seeded mushi-screenshots for glot.it; that bucket was never created.
  if (configured === 'mushi-screenshots') return CLUSTER_DEFAULT_BUCKET
  return configured
}

export async function getStorageSettings(projectId: string): Promise<StorageSettings | null> {
  const cached = settingsCache.get(projectId)
  if (cached && cached.expiresAt > Date.now()) return cached.settings

  const db = getServiceClient()
  const { data } = await db
    .from('project_storage_settings')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()

  const settings = (data as StorageSettings | null) ?? null
  settingsCache.set(projectId, { settings, expiresAt: Date.now() + SETTINGS_TTL_MS })
  return settings
}

export function invalidateStorageCache(projectId?: string): void {
  if (projectId) settingsCache.delete(projectId)
  else settingsCache.clear()
}

/**
 * Top-level factory. Always returns *some* adapter, even on misconfiguration —
 * falls back to the cluster default Supabase bucket so that report ingest
 * never breaks because of a storage settings issue.
 */
export async function getStorageAdapter(projectId: string): Promise<StorageAdapter> {
  const settings = await getStorageSettings(projectId)
  if (!settings || settings.provider === 'supabase') {
    return new SupabaseStorageAdapter(
      getServiceClient(),
      resolveSupabaseBucket(settings?.bucket),
    )
  }
  try {
    return await buildExternalAdapter(settings)
  } catch (err) {
    storageLog.error('Failed to build BYO storage adapter, falling back to Supabase', {
      projectId,
      provider: settings.provider,
      err: String(err),
    })
    return new SupabaseStorageAdapter(getServiceClient(), CLUSTER_DEFAULT_BUCKET)
  }
}

/**
 * Health-check variant of the factory that also captures vault-ref resolution
 * timing as debug steps, so the admin UI can show a structured trace.
 * Returns null adapter + debug steps if the settings row is missing or if
 * building the external adapter fails (the caller should surface this as a
 * configuration error rather than falling back silently).
 */
export async function getStorageAdapterForHealthCheck(
  projectId: string,
): Promise<{ adapter: StorageAdapter; prefixDebug: HealthDebugStep[] }> {
  const prefixDebug: HealthDebugStep[] = []

  const t0 = Date.now()
  const settings = await getStorageSettings(projectId)
  prefixDebug.push({
    step: 'settings_lookup',
    ok: settings !== null,
    ms: Date.now() - t0,
    detail: settings
      ? `provider=${settings.provider} bucket=${settings.bucket}`
      : 'no settings row — using cluster default',
  })

  if (!settings || settings.provider === 'supabase') {
    const bucket = resolveSupabaseBucket(settings?.bucket)
    return {
      adapter: new SupabaseStorageAdapter(getServiceClient(), bucket),
      prefixDebug,
    }
  }

  // Vault-ref resolution for external providers
  if (['s3', 'r2', 'minio'].includes(settings.provider)) {
    const tv1 = Date.now()
    const hasAccess = !!(await resolveVaultSecret(settings.access_key_vault_ref))
    prefixDebug.push({
      step: 'vault_access_key',
      ok: hasAccess,
      ms: Date.now() - tv1,
      detail: settings.access_key_vault_ref
        ? `ref=${settings.access_key_vault_ref} resolved=${hasAccess}`
        : 'no ref configured',
    })

    const tv2 = Date.now()
    const hasSecret = !!(await resolveVaultSecret(settings.secret_key_vault_ref))
    prefixDebug.push({
      step: 'vault_secret_key',
      ok: hasSecret,
      ms: Date.now() - tv2,
      detail: settings.secret_key_vault_ref
        ? `ref=${settings.secret_key_vault_ref} resolved=${hasSecret}`
        : 'no ref configured',
    })

    if (!hasAccess || !hasSecret) {
      // Return a broken adapter that immediately fails its own probe so the
      // healthCheck route can produce a coherent debug log rather than throwing.
      const missingMsg = `Missing vault secret: ${!hasAccess ? 'access_key' : ''}${!hasAccess && !hasSecret ? '+' : ''}${!hasSecret ? 'secret_key' : ''}`
      return {
        adapter: {
          upload: async () => { throw new Error(missingMsg) },
          signedUrl: async () => { throw new Error(missingMsg) },
          delete: async () => { throw new Error(missingMsg) },
          healthCheck: async () => ({ ok: false, error: missingMsg, debug: [] }),
        },
        prefixDebug,
      }
    }
  }

  if (settings.provider === 'gcs') {
    const tv = Date.now()
    const hasSa = !!(await resolveVaultSecret(settings.service_account_vault_ref))
    prefixDebug.push({
      step: 'vault_service_account',
      ok: hasSa,
      ms: Date.now() - tv,
      detail: settings.service_account_vault_ref
        ? `ref=${settings.service_account_vault_ref} resolved=${hasSa}`
        : 'no ref configured',
    })

    if (!hasSa) {
      const missingMsg = 'Missing GCS service-account vault ref'
      return {
        adapter: {
          upload: async () => { throw new Error(missingMsg) },
          signedUrl: async () => { throw new Error(missingMsg) },
          delete: async () => { throw new Error(missingMsg) },
          healthCheck: async () => ({ ok: false, error: missingMsg, debug: [] }),
        },
        prefixDebug,
      }
    }
  }

  try {
    const tb = Date.now()
    const adapter = await buildExternalAdapter(settings)
    prefixDebug.push({ step: 'adapter_build', ok: true, ms: Date.now() - tb })
    return { adapter, prefixDebug }
  } catch (err) {
    const msg = String(err)
    prefixDebug.push({ step: 'adapter_build', ok: false, ms: 0, detail: msg.slice(0, 200) })
    return {
      adapter: {
        upload: async () => { throw new Error(msg) },
        signedUrl: async () => { throw new Error(msg) },
        delete: async () => { throw new Error(msg) },
        healthCheck: async () => ({ ok: false, error: msg, debug: [] }),
      },
      prefixDebug,
    }
  }
}

async function buildExternalAdapter(settings: StorageSettings): Promise<StorageAdapter> {
  switch (settings.provider) {
    case 's3':
    case 'r2':
    case 'minio': {
      const accessKey = await resolveVaultSecret(settings.access_key_vault_ref)
      const secretKey = await resolveVaultSecret(settings.secret_key_vault_ref)
      if (!accessKey || !secretKey) {
        throw new Error(`Missing access/secret key vault refs for ${settings.provider}`)
      }
      return new S3CompatibleAdapter({
        bucket: settings.bucket,
        region: settings.region ?? 'auto',
        endpoint: settings.endpoint ?? defaultEndpoint(settings.provider, settings.region),
        accessKey,
        secretKey,
        prefix: settings.path_prefix,
        kmsKeyId: settings.kms_key_id,
        signedUrlTtlSecs: settings.signed_url_ttl_secs,
      })
    }
    case 'gcs': {
      const sa = await resolveVaultSecret(settings.service_account_vault_ref)
      if (!sa) throw new Error('Missing GCS service-account vault ref')
      return new GcsAdapter({
        bucket: settings.bucket,
        serviceAccountJson: sa,
        prefix: settings.path_prefix,
        signedUrlTtlSecs: settings.signed_url_ttl_secs,
      })
    }
    default:
      throw new Error(`Unsupported provider: ${settings.provider}`)
  }
}

function defaultEndpoint(provider: StorageProvider, region: string | null): string {
  if (provider === 'r2') return 'https://r2.cloudflarestorage.com'
  if (provider === 'minio') throw new Error('MinIO requires an explicit endpoint')
  // s3
  return `https://s3.${region ?? 'us-east-1'}.amazonaws.com`
}

async function resolveVaultSecret(ref: string | null): Promise<string | null> {
  if (!ref) return null
  // Supabase Vault is exposed via the `vault.decrypted_secrets` view. We use
  // a tiny SECURITY DEFINER RPC `vault_lookup(name)` (added separately) to
  // keep the contract uniform across self-hosted deployments.
  try {
    const db = getServiceClient()
    const { data, error } = await db.rpc('vault_lookup', { secret_name: ref })
    if (error) {
      storageLog.error('vault_lookup failed', { ref, error: error.message })
      return null
    }
    return typeof data === 'string' ? data : null
  } catch (err) {
    storageLog.error('vault_lookup threw', { ref, err: String(err) })
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Supabase Storage adapter (default)
// ──────────────────────────────────────────────────────────────────────────

class SupabaseStorageAdapter implements StorageAdapter {
  constructor(private db: SupabaseClient, private bucket: string) {}

  async upload(input: UploadInput): Promise<UploadResult> {
    const { error } = await this.db.storage.from(this.bucket).upload(input.key, input.body, {
      contentType: input.contentType,
      upsert: false,
    })
    if (error) throw new Error(`Supabase upload failed: ${error.message}`)

    // SEC (Wave 5 Gap-B): the screenshots bucket is public=false. Using
    // getPublicUrl() on a private bucket produces a URL that resolves to a 400
    // today — but if the bucket were ever flipped to public the value stored in
    // reports.screenshot_url would retroactively expose every screenshot.
    // createSignedUrl() is always correct for private buckets: it works now,
    // stays correct after any bucket config change, and makes intent explicit.
    //
    // TTL: screenshots are stored at-rest indefinitely alongside their report.
    // A short TTL (e.g. 3600) would make every screenshot in the admin UI
    // silently break after 60 minutes. 7 years (220_752_000 s) matches the
    // de-facto "permanent" convention used elsewhere in the codebase while
    // still being bounded (Supabase max is 315_360_000).
    const ttlSecs = input.ttlSecs ?? 220_752_000;
    const { data: signed, error: signErr } = await this.db.storage
      .from(this.bucket)
      .createSignedUrl(input.key, ttlSecs)
    if (signErr || !signed) throw new Error(`Supabase signed URL failed: ${signErr?.message}`)
    return {
      url: signed.signedUrl,
      storagePath: `storage://supabase/${this.bucket}/${input.key}`,
      signed: true,
    }
  }

  async signedUrl(key: string, ttlSecs = 3600): Promise<string> {
    const { data, error } = await this.db.storage.from(this.bucket).createSignedUrl(key, ttlSecs)
    if (error || !data) throw new Error(`Supabase signed URL failed: ${error?.message}`)
    return data.signedUrl
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.db.storage.from(this.bucket).remove([key])
    if (error) throw new Error(`Supabase delete failed: ${error.message}`)
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const debug: HealthDebugStep[] = []
    debug.push({ step: 'provider', ok: true, ms: 0, detail: `supabase bucket=${this.bucket}` })

    const t0 = Date.now()
    try {
      const { error } = await this.db.storage.from(this.bucket).list('', { limit: 1 })
      const ms = Date.now() - t0
      if (error) {
        debug.push({ step: 'list', ok: false, ms, detail: error.message.slice(0, 200) })
        return { ok: false, error: error.message, debug }
      }
      debug.push({ step: 'list', ok: true, ms })
      return { ok: true, debug }
    } catch (err) {
      const ms = Date.now() - t0
      const msg = String(err)
      debug.push({ step: 'list', ok: false, ms, detail: msg.slice(0, 200) })
      return { ok: false, error: msg, debug }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// S3-compatible adapter (S3 / R2 / MinIO)
//
// SigV4 signing implemented inline using Web Crypto so we stay zero-dep on
// the Edge Function runtime. Standard PUT, GET (presigned), DELETE.
// ──────────────────────────────────────────────────────────────────────────

interface S3Opts {
  bucket: string
  region: string
  endpoint: string
  accessKey: string
  secretKey: string
  prefix: string
  kmsKeyId: string | null
  signedUrlTtlSecs: number
}

class S3CompatibleAdapter implements StorageAdapter {
  constructor(private opts: S3Opts) {}

  private fullKey(key: string): string {
    return this.opts.prefix ? `${this.opts.prefix.replace(/\/$/, '')}/${key}` : key
  }

  private hostedUrl(key: string): string {
    const base = this.opts.endpoint.replace(/\/$/, '')
    return `${base}/${this.opts.bucket}/${this.fullKey(key)}`
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const url = this.hostedUrl(input.key)
    const headers: Record<string, string> = {
      'Content-Type': input.contentType,
      'x-amz-content-sha256': await sha256Hex(input.body),
    }
    if (this.opts.kmsKeyId) {
      headers['x-amz-server-side-encryption'] = 'aws:kms'
      headers['x-amz-server-side-encryption-aws-kms-key-id'] = this.opts.kmsKeyId
    }
    const signed = await sigV4(this.opts, 'PUT', url, headers, input.body)
    const res = await fetch(url, { method: 'PUT', headers: signed, body: input.body })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`S3 PUT failed: ${res.status} ${txt.slice(0, 200)}`)
    }
    const signedGet = await this.signedUrl(input.key, this.opts.signedUrlTtlSecs)
    return {
      url: signedGet,
      storagePath: `storage://s3/${this.opts.bucket}/${this.fullKey(input.key)}`,
      signed: true,
    }
  }

  async signedUrl(key: string, ttlSecs = this.opts.signedUrlTtlSecs): Promise<string> {
    return presignGet(this.opts, this.hostedUrl(key), ttlSecs)
  }

  async delete(key: string): Promise<void> {
    const url = this.hostedUrl(key)
    const headers = await sigV4(this.opts, 'DELETE', url, {
      'x-amz-content-sha256': await sha256Hex(new Uint8Array()),
    })
    const res = await fetch(url, { method: 'DELETE', headers })
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE failed: ${res.status}`)
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const debug: HealthDebugStep[] = []
    const providerLabel = `${this.opts.endpoint} bucket=${this.opts.bucket} region=${this.opts.region} prefix=${this.opts.prefix || '(none)'}`
    debug.push({ step: 'provider', ok: true, ms: 0, detail: providerLabel })

    const probeKey = `_mushi_health_${Date.now()}.txt`
    debug.push({ step: 'probe_key', ok: true, ms: 0, detail: probeKey })

    const t1 = Date.now()
    try {
      await this.upload({ key: probeKey, body: new TextEncoder().encode('ok'), contentType: 'text/plain' })
      debug.push({ step: 'put', ok: true, ms: Date.now() - t1 })
    } catch (err) {
      const ms = Date.now() - t1
      const msg = String(err)
      debug.push({ step: 'put', ok: false, ms, detail: msg.slice(0, 200) })
      return { ok: false, error: msg, debug }
    }

    const t2 = Date.now()
    try {
      await this.delete(probeKey)
      debug.push({ step: 'delete', ok: true, ms: Date.now() - t2 })
    } catch (err) {
      const ms = Date.now() - t2
      const msg = String(err)
      debug.push({ step: 'delete', ok: false, ms, detail: msg.slice(0, 200) })
      return { ok: false, error: msg, debug }
    }

    return { ok: true, debug }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GCS adapter — uses HMAC keys (S3-compatible interop) when available;
// otherwise falls back to a JWT-signed XML API request. This keeps us
// dependency-free vs. pulling in google-auth-library on Deno.
// ──────────────────────────────────────────────────────────────────────────

interface GcsOpts {
  bucket: string
  serviceAccountJson: string
  prefix: string
  signedUrlTtlSecs: number
}

class GcsAdapter implements StorageAdapter {
  constructor(private opts: GcsOpts) {}

  private fullKey(key: string): string {
    return this.opts.prefix ? `${this.opts.prefix.replace(/\/$/, '')}/${key}` : key
  }

  private async accessToken(): Promise<string> {
    const sa = JSON.parse(this.opts.serviceAccountJson) as {
      client_email: string
      private_key: string
      token_uri: string
    }
    const now = Math.floor(Date.now() / 1000)
    const claims = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/devstorage.read_write',
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    }
    const header = { alg: 'RS256', typ: 'JWT' }
    const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)))
    const unsigned = `${enc(header)}.${enc(claims)}`
    const sig = await rs256Sign(sa.private_key, unsigned)
    const jwt = `${unsigned}.${sig}`
    const res = await fetch(sa.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    })
    const body = (await res.json()) as { access_token: string }
    if (!body.access_token) throw new Error('GCS token exchange failed')
    return body.access_token
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const token = await this.accessToken()
    const key = this.fullKey(input.key)
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${this.opts.bucket}/o?uploadType=media&name=${encodeURIComponent(key)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': input.contentType },
      body: input.body,
    })
    if (!res.ok) throw new Error(`GCS upload failed: ${res.status}`)
    const signed = await this.signedUrl(input.key)
    return {
      url: signed,
      storagePath: `storage://gcs/${this.opts.bucket}/${key}`,
      signed: true,
    }
  }

  async signedUrl(key: string, ttlSecs = this.opts.signedUrlTtlSecs): Promise<string> {
    const token = await this.accessToken()
    // GCS supports OAuth-bearer signed-cookie URLs for short TTLs; for a v4
    // signed URL we'd reimplement the canonical signing here. Real-world,
    // we recommend customers use the S3-compatible HMAC interop and the
    // S3CompatibleAdapter — this keeps this branch simple for fallback use.
    const fullKey = this.fullKey(key)
    return `https://storage.googleapis.com/${this.opts.bucket}/${encodeURIComponent(fullKey)}?access_token=${token}&expires_in=${ttlSecs}`
  }

  async delete(key: string): Promise<void> {
    const token = await this.accessToken()
    const fullKey = this.fullKey(key)
    const url = `https://storage.googleapis.com/storage/v1/b/${this.opts.bucket}/o/${encodeURIComponent(fullKey)}`
    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok && res.status !== 404) throw new Error(`GCS delete failed: ${res.status}`)
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const debug: HealthDebugStep[] = []
    debug.push({ step: 'provider', ok: true, ms: 0, detail: `gcs bucket=${this.opts.bucket} prefix=${this.opts.prefix || '(none)'}` })

    // Verify we can obtain an access token (validates service-account JSON shape)
    const t0 = Date.now()
    let token: string
    try {
      token = await this.accessToken()
      debug.push({ step: 'token', ok: true, ms: Date.now() - t0, detail: 'access token obtained' })
    } catch (err) {
      const ms = Date.now() - t0
      const msg = String(err)
      debug.push({ step: 'token', ok: false, ms, detail: msg.slice(0, 200) })
      return { ok: false, error: msg, debug }
    }
    void token // used by upload/delete internally

    const probeKey = `_mushi_health_${Date.now()}.txt`
    debug.push({ step: 'probe_key', ok: true, ms: 0, detail: probeKey })

    const t1 = Date.now()
    try {
      await this.upload({ key: probeKey, body: new TextEncoder().encode('ok'), contentType: 'text/plain' })
      debug.push({ step: 'put', ok: true, ms: Date.now() - t1 })
    } catch (err) {
      const ms = Date.now() - t1
      const msg = String(err)
      debug.push({ step: 'put', ok: false, ms, detail: msg.slice(0, 200) })
      return { ok: false, error: msg, debug }
    }

    const t2 = Date.now()
    try {
      await this.delete(probeKey)
      debug.push({ step: 'delete', ok: true, ms: Date.now() - t2 })
    } catch (err) {
      const ms = Date.now() - t2
      const msg = String(err)
      debug.push({ step: 'delete', ok: false, ms, detail: msg.slice(0, 200) })
      return { ok: false, error: msg, debug }
    }

    return { ok: true, debug }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// SigV4 helpers (S3-compatible)
// Implemented inline to avoid pulling in @aws-sdk/* on the Edge Function
// runtime (each AWS SDK package is ~300KB+ at cold start).
// ──────────────────────────────────────────────────────────────────────────

async function sigV4(
  opts: { region: string; accessKey: string; secretKey: string },
  method: string,
  url: string,
  extraHeaders: Record<string, string>,
  body: Uint8Array | undefined = undefined,
): Promise<Record<string, string>> {
  const u = new URL(url)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = body ? await sha256Hex(body) : await sha256Hex(new Uint8Array())

  const headers: Record<string, string> = {
    Host: u.host,
    'x-amz-date': amzDate,
    ...extraHeaders,
  }
  if (!headers['x-amz-content-sha256']) headers['x-amz-content-sha256'] = payloadHash

  const sortedHeaders = Object.entries(headers).sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
  const canonicalHeaders = sortedHeaders.map(([k, v]) => `${k.toLowerCase()}:${v.trim()}\n`).join('')
  const signedHeaders = sortedHeaders.map(([k]) => k.toLowerCase()).join(';')

  const canonicalRequest = [
    method,
    encodePath(u.pathname),
    u.search.replace(/^\?/, ''),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credScope = `${dateStamp}/${opts.region}/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(new TextEncoder().encode(canonicalRequest))].join('\n')

  const signingKey = await deriveSigningKey(opts.secretKey, dateStamp, opts.region, 's3')
  const signature = bufToHex(await hmac(signingKey, stringToSign))

  return {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

async function presignGet(
  opts: { region: string; accessKey: string; secretKey: string },
  url: string,
  ttlSecs: number,
): Promise<string> {
  const u = new URL(url)
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const credScope = `${dateStamp}/${opts.region}/s3/aws4_request`

  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${opts.accessKey}/${credScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(ttlSecs),
    'X-Amz-SignedHeaders': 'host',
  })
  const canonicalQs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')

  const canonicalRequest = [
    'GET',
    encodePath(u.pathname),
    canonicalQs,
    `host:${u.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(new TextEncoder().encode(canonicalRequest))].join('\n')
  const key = await deriveSigningKey(opts.secretKey, dateStamp, opts.region, 's3')
  const signature = bufToHex(await hmac(key, stringToSign))
  return `${u.origin}${u.pathname}?${canonicalQs}&X-Amz-Signature=${signature}`
}

function encodePath(path: string): string {
  return path.split('/').map((s) => encodeURIComponent(s)).join('/').replace(/%2F/g, '/')
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data)
  return bufToHex(buf)
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))
}

async function deriveSigningKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`), date)
  const kRegion = await hmac(kDate, region)
  const kService = await hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

function b64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function rs256Sign(privateKeyPem: string, data: string): Promise<string> {
  const pem = privateKeyPem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))
  return b64url(new Uint8Array(sig))
}
