/**
 * FILE: packages/server/supabase/functions/api/routes/project-ci-secrets.ts
 * PURPOSE: SDK CI-secret diagnostic + one-click GitHub Actions secret sync.
 *
 * ROUTES
 * ──────
 * GET  /v1/admin/projects/:id/sdk-diagnostics
 *   Returns a fused verdict combining:
 *     - GitHub CI-secret presence (authoritative, when a GitHub token is available)
 *     - Heartbeat telemetry (native-platform coverage from last_seen_origin/ua)
 *     - project_settings SDK config flags (banner enabled, launcher mode)
 *   Response shape: SdkDiagnosticsResult
 *
 * POST /v1/admin/projects/:id/sync-ci-secrets
 *   One-click: mints a project-scoped report:write API key, then writes the
 *   required Mushi env vars into the project's linked GitHub repo as Actions
 *   secrets (API_KEY) or variables (PROJECT_ID, API_ENDPOINT) using the
 *   GitHub REST API.
 *
 *   Requires the GitHub token to have Actions "Secrets: write" permission.
 *   If it doesn't (403 from GitHub), returns a guided fallback with the
 *   `gh secret set` commands the developer can run locally.
 *
 * IDEMPOTENCY
 * ───────────
 *   - sync-ci-secrets deactivates any prior `ci-auto:*` labelled key before
 *     minting a fresh one, so repeated calls don't accumulate stale keys.
 *   - GitHub PUT /actions/secrets/{name} is already idempotent (upsert).
 *
 * SECURITY
 *   - jwtAuth on both routes; owner/admin on POST.
 *   - The plaintext API key is transmitted in the response body (HTTPS only).
 *   - No secret value is written to audit_logs; only the key prefix is logged.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { dbError, userCanAccessProject } from '../shared.ts'
import { resolveProjectGithubToken, parseGithubRepoUrl } from '../../_shared/github.ts'
import { ghFetch, ghFetchOptional } from '../../_shared/github-pr.ts'

// ---------------------------------------------------------------------------
// Per-stack env-var maps (mirrors apps/admin/src/lib/projectMushiEnv.ts)
// Keys that should go into GitHub SECRETS vs VARIABLES.
// ---------------------------------------------------------------------------

interface CiVar {
  name: string
  /** Deterministic value — set before calling sync. Undefined means the freshly-minted API key. */
  value?: string
  ghKind: 'secret' | 'variable'
}

/**
 * Build the list of required Mushi CI vars for a given project.
 * projectId and endpoint are deterministic; apiKey is the freshly-minted key
 * (passed as `mintedKey`).
 */
function buildCiVars(params: {
  stack: 'nextjs' | 'expo' | 'vite'
  projectId: string
  endpoint: string
  mintedKey: string
}): CiVar[] {
  const { stack, projectId, endpoint, mintedKey } = params

  if (stack === 'expo') {
    return [
      { name: 'EXPO_PUBLIC_MUSHI_PROJECT_ID', value: projectId, ghKind: 'variable' },
      { name: 'EXPO_PUBLIC_MUSHI_API_KEY', value: mintedKey, ghKind: 'secret' },
      { name: 'EXPO_PUBLIC_MUSHI_API_ENDPOINT', value: endpoint, ghKind: 'variable' },
    ]
  }

  if (stack === 'vite') {
    return [
      { name: 'VITE_MUSHI_PROJECT_ID', value: projectId, ghKind: 'variable' },
      { name: 'VITE_MUSHI_API_KEY', value: mintedKey, ghKind: 'secret' },
      { name: 'VITE_MUSHI_API_ENDPOINT', value: endpoint, ghKind: 'variable' },
    ]
  }

  // Default: Next.js (NEXT_PUBLIC_*)
  return [
    { name: 'NEXT_PUBLIC_MUSHI_PROJECT_ID', value: projectId, ghKind: 'variable' },
    { name: 'NEXT_PUBLIC_MUSHI_API_KEY', value: mintedKey, ghKind: 'secret' },
    { name: 'NEXT_PUBLIC_MUSHI_API_ENDPOINT', value: endpoint, ghKind: 'variable' },
  ]
}

/** Required names (no values) for diagnosis/comparison. */
function requiredCiVarNames(stack: 'nextjs' | 'expo' | 'vite'): Array<{ name: string; ghKind: 'secret' | 'variable' }> {
  return buildCiVars({ stack, projectId: '', endpoint: '', mintedKey: '' })
    .map(({ name, ghKind }) => ({ name, ghKind }))
}

// ---------------------------------------------------------------------------
// Detect stack from project slug / known config (simple heuristic for now)
// ---------------------------------------------------------------------------

function inferStack(slug: string | null): 'nextjs' | 'expo' | 'vite' {
  if (!slug) return 'nextjs'
  const s = slug.toLowerCase()
  if (s === 'yen-yen') return 'expo'
  if (s === 'mushi-mushi' || s === 'solo-boss-cloud' || s === 'atpeak') return 'vite'
  return 'nextjs'
}

// ---------------------------------------------------------------------------
// GitHub secrets / variables REST helpers
// ---------------------------------------------------------------------------

const GH_API = 'https://api.github.com'

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'mushi-mushi/1.0',
    'Content-Type': 'application/json',
  }
}

interface GhPublicKey {
  key_id: string
  key: string
}

/**
 * Encrypt a secret value with the repo's libsodium public key (sealed box),
 * as required by the GitHub Actions Secrets API.
 *
 * Uses the native Web Crypto subtle API. GitHub uses X25519 / XSalsa20-Poly1305
 * (NaCl sealed box = crypto_box_seal). Deno / V8 does not have a built-in
 * sealed-box implementation, so we load libsodium-wrappers via esm.sh at
 * runtime (the WASM payload is ~330kB, cached by the edge runtime after the
 * first cold start).
 */
async function encryptSecret(publicKeyB64: string, secretValue: string): Promise<string> {
  // @ts-ignore — esm.sh dynamic import not in Deno type stubs
  const { default: _sodium } = await import('https://esm.sh/libsodium-wrappers@0.7.13')
  await _sodium.ready
  const sodium = _sodium as {
    ready: Promise<void>
    from_base64: (s: string, v?: number) => Uint8Array
    crypto_box_seal: (msg: Uint8Array, pk: Uint8Array) => Uint8Array
    to_base64: (b: Uint8Array, v?: number) => string
    base64_variants: { ORIGINAL: number }
  }

  const binKey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL)
  const binSecret = new TextEncoder().encode(secretValue)
  const encryptedBytes = sodium.crypto_box_seal(binSecret, binKey)
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL)
}

/** List existing Actions secret names for a repo. */
async function listRepoSecretNames(owner: string, repo: string, token: string): Promise<string[]> {
  const data = await ghFetchOptional(
    `${GH_API}/repos/${owner}/${repo}/actions/secrets?per_page=100`,
    { method: 'GET', headers: ghHeaders(token) },
  ) as { secrets?: Array<{ name: string }> } | null
  return data?.secrets?.map((s) => s.name) ?? []
}

/** List existing Actions variable names for a repo. */
async function listRepoVariableNames(owner: string, repo: string, token: string): Promise<string[]> {
  const data = await ghFetchOptional(
    `${GH_API}/repos/${owner}/${repo}/actions/variables?per_page=100`,
    { method: 'GET', headers: ghHeaders(token) },
  ) as { variables?: Array<{ name: string }> } | null
  return data?.variables?.map((v) => v.name) ?? []
}

/** Write one Actions secret (sealed-box encrypted). */
async function putRepoSecret(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  const pubKeyData = (await ghFetch(
    `${GH_API}/repos/${owner}/${repo}/actions/secrets/public-key`,
    { method: 'GET', headers: ghHeaders(token) },
  )) as GhPublicKey

  const encryptedValue = await encryptSecret(pubKeyData.key, value)

  await ghFetch(`${GH_API}/repos/${owner}/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({
      encrypted_value: encryptedValue,
      key_id: pubKeyData.key_id,
    }),
  })
}

/** Write one Actions variable (plaintext). */
async function putRepoVariable(
  owner: string,
  repo: string,
  name: string,
  value: string,
  token: string,
): Promise<void> {
  // Try PATCH first (update existing); fall back to POST (create new).
  const patchRes = await fetch(`${GH_API}/repos/${owner}/${repo}/actions/variables/${name}`, {
    method: 'PATCH',
    headers: ghHeaders(token),
    body: JSON.stringify({ name, value }),
  })
  if (patchRes.status === 404) {
    await ghFetch(`${GH_API}/repos/${owner}/${repo}/actions/variables`, {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ name, value }),
    })
  } else if (!patchRes.ok) {
    const txt = await patchRes.text()
    throw new Error(`GitHub PATCH variable ${name} → ${patchRes.status}: ${txt.slice(0, 200)}`)
  }
}

// ---------------------------------------------------------------------------
// Build guided fallback commands (used when GitHub write is unavailable)
// ---------------------------------------------------------------------------

function buildGuidedFallback(params: {
  owner: string
  repo: string
  ciVarTemplates: Array<{ name: string; ghKind: 'secret' | 'variable' }>
  projectId: string
  endpoint: string
}): { commands: string[]; envBlock: string } {
  const { owner, repo, ciVarTemplates, projectId, endpoint } = params
  const repoFlag = `--repo ${owner}/${repo}`

  const commands: string[] = []
  const envLines: string[] = []

  for (const v of ciVarTemplates) {
    if (v.ghKind === 'secret') {
      // API key — user must supply their project-scoped key; we can't print it here
      commands.push(`gh secret set ${v.name} --body "<your-mushi-project-api-key>" ${repoFlag}`)
    } else {
      const val = v.name.toLowerCase().includes('endpoint') ? endpoint : projectId
      commands.push(`gh variable set ${v.name} --body "${val}" ${repoFlag}`)
    }
    envLines.push(`          ${v.name}: \${{ ${v.ghKind === 'secret' ? 'secrets' : 'vars'}.${v.name} }}`)
  }

  const envBlock = `        env:\n${envLines.join('\n')}`

  return { commands, envBlock }
}

// ---------------------------------------------------------------------------
// Mint a project-scoped report:write API key (deactivates prior ci-auto keys)
// ---------------------------------------------------------------------------

async function mintCiApiKey(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  repoSlug: string,
): Promise<{ rawKey: string; prefix: string }> {
  const ciLabel = `ci-auto:${repoSlug}`

  // Deactivate prior ci-auto keys for this project (idempotent across retries).
  await db
    .from('project_api_keys')
    .update({ is_active: false })
    .eq('project_id', projectId)
    .like('label', 'ci-auto:%')

  const rawKey = `mushi_${crypto.randomUUID().replace(/-/g, '')}`
  const prefix = rawKey.slice(0, 12)

  const encoder = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawKey))
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const { error } = await db.from('project_api_keys').insert({
    project_id: projectId,
    key_hash: keyHash,
    key_prefix: prefix,
    label: ciLabel,
    scopes: ['report:write'],
    is_active: true,
  })

  if (error) throw new Error(`Failed to mint CI API key: ${error.message}`)

  return { rawKey, prefix }
}

// ---------------------------------------------------------------------------
// Route exports
// ---------------------------------------------------------------------------

export interface SdkDiagnosticsResult {
  status: 'healthy' | 'ci-secret-missing' | 'native-never-seen' | 'banner-disabled' | 'unknown'
  bannerEnabled: boolean
  launcherMode: string | null
  hasGithubToken: boolean
  repoUrl: string | null
  /** Names present in CI (secrets + variables combined). Null when no GitHub token. */
  presentVars: string[] | null
  /** Names required for the inferred stack. */
  requiredVars: string[]
  /** Names from requiredVars that are absent. Null when no GitHub token. */
  missingVars: string[] | null
  /** Last heartbeat across all active keys. */
  lastSeenAt: string | null
  /** True when any key has been seen from a native origin (capacitor:// / okhttp / CFNetwork). */
  nativeEverSeen: boolean
  stack: 'nextjs' | 'expo' | 'vite'
  recommendedFix: string
}

export function registerProjectCiSecretsRoutes(app: Hono<{ Variables: Variables }>): void {
  // ──────────────────────────────────────────────────────────────
  // GET /v1/admin/projects/:id/sdk-diagnostics
  // ──────────────────────────────────────────────────────────────
  app.get('/v1/admin/projects/:id/sdk-diagnostics', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }

    // 1. Fetch project slug + settings + repo.
    const { data: projectRow, error: projErr } = await db
      .from('projects')
      .select('id, slug')
      .eq('id', projectId)
      .maybeSingle()
    if (projErr) return dbError(c, projErr)

    const slug = (projectRow as { id: string; slug?: string } | null)?.slug ?? null
    const stack = inferStack(slug)

    const { data: settingsRow } = await db
      .from('project_settings')
      .select('sdk_config_enabled, sdk_widget_launcher')
      .eq('project_id', projectId)
      .maybeSingle()

    const bannerEnabled = (settingsRow as { sdk_config_enabled?: boolean } | null)?.sdk_config_enabled !== false
    const launcherMode = (settingsRow as { sdk_widget_launcher?: string } | null)?.sdk_widget_launcher ?? null

    // 2. Heartbeat: last seen + native origin detection.
    const { data: keys } = await db
      .from('project_api_keys')
      .select('last_seen_at, last_seen_origin, last_seen_user_agent')
      .eq('project_id', projectId)
      .eq('is_active', true)
      .order('last_seen_at', { ascending: false, nullsFirst: false })

    const keyRows = (keys ?? []) as Array<{
      last_seen_at: string | null
      last_seen_origin: string | null
      last_seen_user_agent: string | null
    }>

    const lastSeenAt = keyRows.find((r) => r.last_seen_at)?.last_seen_at ?? null

    const nativePatterns = [
      /^capacitor:/i,
      /okhttp/i,
      /cfnetwork/i,
      /darwin.*like.*mac/i, // iOS sim
      /testflight/i,
    ]
    const nativeEverSeen = keyRows.some((r) => {
      const origin = r.last_seen_origin ?? ''
      const ua = r.last_seen_user_agent ?? ''
      return nativePatterns.some((re) => re.test(origin) || re.test(ua))
    })

    // 3. GitHub CI-secret presence check.
    const { data: repoRow } = await db
      .from('project_repos')
      .select('repo_url, github_app_installation_id')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .maybeSingle()

    const repoUrl = (repoRow as { repo_url?: string } | null)?.repo_url ?? null
    const repoRef = parseGithubRepoUrl(repoUrl)
    const installationId = (repoRow as { github_app_installation_id?: number | null } | null)
      ?.github_app_installation_id ?? null

    const required = requiredCiVarNames(stack)
    let presentVars: string[] | null = null
    let missingVars: string[] | null = null
    let hasGithubToken = false

    if (repoRef) {
      try {
        const token = await resolveProjectGithubToken(db, projectId, installationId)
        if (token) {
          hasGithubToken = true
          const [secretNames, varNames] = await Promise.all([
            listRepoSecretNames(repoRef.owner, repoRef.repo, token),
            listRepoVariableNames(repoRef.owner, repoRef.repo, token),
          ])
          presentVars = [...secretNames, ...varNames]
          missingVars = required
            .filter((v) => !presentVars!.includes(v.name))
            .map((v) => v.name)
        }
      } catch {
        // Token resolution or GitHub call failed — fall through to telemetry-only.
      }
    }

    // 4. Compute status verdict.
    let status: SdkDiagnosticsResult['status'] = 'unknown'
    let recommendedFix = ''

    if (!bannerEnabled || launcherMode === 'hidden' || launcherMode === 'manual') {
      status = 'banner-disabled'
      recommendedFix = 'Enable the banner in SDK Config → Launcher mode → Banner.'
    } else if (missingVars && missingVars.length > 0) {
      status = 'ci-secret-missing'
      recommendedFix =
        `The CI secrets/variables ${missingVars.join(', ')} are missing on the repo. ` +
        'Click "Sync CI secrets" to write them automatically, or copy the commands below.'
    } else if (!nativeEverSeen && lastSeenAt) {
      status = 'native-never-seen'
      recommendedFix =
        'The SDK has been seen from web/server origins but never from a native Capacitor ' +
        'build. Ensure the Mushi env vars are in the native build and that you have ' +
        'installed the app from the store after the last CI build.'
    } else if (missingVars !== null && missingVars.length === 0 && (nativeEverSeen || lastSeenAt)) {
      status = 'healthy'
      recommendedFix = 'All CI secrets present and SDK has reported from expected origins.'
    } else if (!lastSeenAt) {
      status = 'ci-secret-missing'
      recommendedFix =
        'SDK has never sent a heartbeat. Check that the Mushi env vars are set and the ' +
        'build:native step includes them.'
    }

    const result: SdkDiagnosticsResult = {
      status,
      bannerEnabled,
      launcherMode,
      hasGithubToken,
      repoUrl,
      presentVars,
      requiredVars: required.map((v) => v.name),
      missingVars,
      lastSeenAt,
      nativeEverSeen,
      stack,
      recommendedFix,
    }

    return c.json({ ok: true, data: result })
  })

  // ──────────────────────────────────────────────────────────────
  // POST /v1/admin/projects/:id/sync-ci-secrets
  // ──────────────────────────────────────────────────────────────
  app.post('/v1/admin/projects/:id/sync-ci-secrets', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()

    // Owner or admin only — minting keys + writing secrets is privileged.
    const access = await userCanAccessProject(db, userId, projectId)
    if (!access.allowed) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Project not found' } }, 404)
    }
    if (access.role !== 'owner' && access.role !== 'admin') {
      return c.json(
        { ok: false, error: { code: 'FORBIDDEN', message: 'Owner or admin access required' } },
        403,
      )
    }

    // 1. Resolve project slug + Mushi cloud endpoint.
    const { data: projectRow, error: projErr } = await db
      .from('projects')
      .select('id, slug')
      .eq('id', projectId)
      .maybeSingle()
    if (projErr) return dbError(c, projErr)

    const slug = (projectRow as { id: string; slug?: string } | null)?.slug ?? null
    const stack = inferStack(slug)

    // The Mushi cloud endpoint (the canonical ingest URL for this backend).
    const MUSHI_ENDPOINT =
      Deno.env.get('MUSHI_API_ENDPOINT') ??
      `https://${Deno.env.get('SUPABASE_URL')?.replace('https://', '').split('.')[0]}.supabase.co/functions/v1/api`

    // 2. Resolve GitHub repo.
    const { data: repoRow, error: repoErr } = await db
      .from('project_repos')
      .select('repo_url, github_app_installation_id')
      .eq('project_id', projectId)
      .eq('is_primary', true)
      .maybeSingle()
    if (repoErr) return dbError(c, repoErr)

    const repoUrl = (repoRow as { repo_url?: string } | null)?.repo_url ?? null
    const repoRef = parseGithubRepoUrl(repoUrl)
    const installationId = (repoRow as { github_app_installation_id?: number | null } | null)
      ?.github_app_installation_id ?? null

    // 3. Mint a project-scoped report:write key (deactivates prior ci-auto keys).
    const repoSlug = repoRef ? `${repoRef.owner}/${repoRef.repo}` : (slug ?? projectId)
    const { rawKey, prefix } = await mintCiApiKey(db, projectId, repoSlug)

    // 4. Build the vars list.
    const ciVars = buildCiVars({
      stack,
      projectId,
      endpoint: MUSHI_ENDPOINT,
      mintedKey: rawKey,
    })

    // 5. If no repo or no token, return guided fallback immediately.
    if (!repoRef) {
      const fallback = buildGuidedFallback({
        owner: '<your-org>',
        repo: '<your-repo>',
        ciVarTemplates: requiredCiVarNames(stack),
        projectId,
        endpoint: MUSHI_ENDPOINT,
      })
      return c.json({
        ok: false,
        error: { code: 'NO_GITHUB_REPO', message: 'No primary GitHub repo linked to this project.' },
        data: {
          minted: { prefix, rawKey },
          fallback,
        },
      }, 200) // 200 so the UI can show the key + fallback
    }

    // 6. Resolve token.
    let token: string | null = null
    try {
      token = await resolveProjectGithubToken(db, projectId, installationId)
    } catch {
      // Fall through to guided fallback.
    }

    if (!token) {
      const fallback = buildGuidedFallback({
        owner: repoRef.owner,
        repo: repoRef.repo,
        ciVarTemplates: requiredCiVarNames(stack),
        projectId,
        endpoint: MUSHI_ENDPOINT,
      })
      return c.json({
        ok: false,
        error: { code: 'GH_NO_TOKEN', message: 'No GitHub token available for this project. Store a fine-grained PAT in project settings.' },
        data: {
          minted: { prefix, rawKey },
          fallback,
        },
      }, 200)
    }

    // 7. Write secrets and variables to GitHub.
    const written: string[] = []
    const failed: Array<{ name: string; reason: string }> = []
    let ghForbidden = false

    for (const v of ciVars) {
      try {
        if (v.ghKind === 'secret') {
          await putRepoSecret(repoRef.owner, repoRef.repo, v.name, v.value!, token)
        } else {
          await putRepoVariable(repoRef.owner, repoRef.repo, v.name, v.value!, token)
        }
        written.push(v.name)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('403')) {
          ghForbidden = true
          failed.push({ name: v.name, reason: 'GitHub returned 403 — token lacks Secrets/Variables write permission.' })
        } else {
          failed.push({ name: v.name, reason: msg })
        }
      }
    }

    // 8. Log audit (never log the raw key value — only prefix).
    await logAudit(
      db,
      projectId,
      userId,
      'settings.updated',
      'ci_secrets',
      projectId,
      { written, failed: failed.map((f) => f.name), keyPrefix: prefix },
    ).catch(() => {})

    // 9. Build guided fallback (always included so the UI can show the raw key
    //    to the user regardless of write success — the user needs it for manual setup).
    const fallback = buildGuidedFallback({
      owner: repoRef.owner,
      repo: repoRef.repo,
      ciVarTemplates: requiredCiVarNames(stack),
      projectId,
      endpoint: MUSHI_ENDPOINT,
    })

    if (ghForbidden && written.length === 0) {
      return c.json({
        ok: false,
        error: {
          code: 'GH_SECRETS_FORBIDDEN',
          message:
            'GitHub returned 403 for Actions secrets/variables write. ' +
            'The stored token lacks "Secrets: write" + "Variables: write" permission. ' +
            'Either add those permissions to the GitHub App (requires installation re-consent) ' +
            'or store a fine-grained PAT with those permissions in project settings. ' +
            'Use the guided fallback commands below to set secrets manually.',
        },
        data: { minted: { prefix, rawKey }, written, failed, fallback },
      }, 200) // 200 so the UI can render the key + copy commands
    }

    return c.json({
      ok: true,
      data: {
        minted: { prefix, rawKey },
        written,
        failed,
        fallback,
      },
    })
  })
}
