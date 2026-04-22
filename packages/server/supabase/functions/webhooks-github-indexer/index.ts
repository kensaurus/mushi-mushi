/**
 * V5.3 §2.3.4: GitHub App webhook handler for the RAG codebase indexer.
 *
 * - Verifies X-Hub-Signature-256 against the webhook secret (timing-safe).
 * - Mints a short-lived installation access token via the GitHub App private key.
 * - Diff-walks the push (added + modified + removed paths), pulls file
 *   contents via the contents API, chunks them, embeds, and upserts into
 *   project_codebase_files. Removed paths are tombstoned, not hard-deleted.
 *
 * Env required:
 *   GITHUB_APP_ID                — numeric App ID
 *   GITHUB_APP_PRIVATE_KEY       — PEM (no passphrase)
 *   GITHUB_APP_WEBHOOK_SECRET    — secret configured on the App
 */

import { Hono } from 'npm:hono@4'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { chunk, shouldIndex, sha256Hex } from '../_shared/code-indexer.ts'
import { createEmbedding } from '../_shared/embeddings.ts'
import { log as rootLog } from '../_shared/logger.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { requireServiceRoleAuth } from '../_shared/auth.ts'

ensureSentry('webhooks-github-indexer')

const log = rootLog.child('webhooks-github-indexer')
const app = new Hono()
app.onError(sentryHonoErrorHandler)

function getDb() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )
}

async function verifySignature(req: Request, raw: string): Promise<boolean> {
  const secret = Deno.env.get('GITHUB_APP_WEBHOOK_SECRET')
  if (!secret) return false
  const sig = req.headers.get('X-Hub-Signature-256') ?? ''
  if (!sig.startsWith('sha256=')) return false
  const expected = await hmacSha256Hex(secret, raw)
  return timingSafeEqual(sig.slice(7), expected)
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

/**
 * Mint a JWT for the App, exchange for an installation token. JWTs are tiny —
 * we sign in-process via Web Crypto rather than pulling jose into the bundle.
 */
async function mintInstallationToken(installationId: number): Promise<string> {
  const appId = Deno.env.get('GITHUB_APP_ID')
  const pem = Deno.env.get('GITHUB_APP_PRIVATE_KEY')
  if (!appId || !pem) throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required')

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iat: now - 30, exp: now + 540, iss: appId }
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const data = `${enc(header)}.${enc(payload)}`

  const key = await importPkcs8(pem)
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(data))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  const jwt = `${data}.${sigB64}`

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!res.ok) throw new Error(`installation token mint failed: ${res.status}`)
  const body = await res.json() as { token: string }
  return body.token
}

async function importPkcs8(pem: string): Promise<CryptoKey> {
  const stripped = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(stripped), c => c.charCodeAt(0))
  return await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * Encode a repo-relative file path for the GitHub Contents API. Each segment
 * is percent-encoded independently so characters like `#` or spaces are escaped
 * but the path separators stay as literal `/` — `encodeURIComponent` on the
 * whole string would convert `/` to `%2F` and turn every subdirectory file
 * into a 404.
 */
function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join('/')
}

async function fetchFileContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    log.warn('contents fetch failed', { path, status: res.status })
    return null
  }
  const text = await res.text()
  if (text.length > 500_000) return null
  return text
}

app.get('/webhooks-github-indexer/health', (c) => c.json({ ok: true }))

/**
 * Handle a `pull_request.closed` event with `merged: true`.
 *
 * Looks up the `fix_attempts` row whose `pr_url` matches the merged PR — if
 * it's one of ours, append a `fixes_succeeded` usage_event so the aggregator
 * pushes it to Stripe Meter Events on the next tick. Idempotent: a `pr_url`
 * unique constraint on the metadata field would be ideal, but for now we
 * `select first` and bail if a `fixes_succeeded` event already exists for
 * the same PR. This is best-effort billing — we never 500 on a billing
 * write so GitHub doesn't retry the webhook for non-billing reasons.
 */
async function handleFixPrMerged(payload: {
  pull_request?: { html_url?: string; number?: number }
  repository?: { full_name?: string }
}): Promise<Response> {
  const prUrl = payload.pull_request?.html_url
  if (!prUrl) return new Response(JSON.stringify({ ok: true, ignored: 'no_pr_url' }), { status: 202 })

  const db = getDb()
  const { data: attempt } = await db
    .from('fix_attempts')
    .select('id, project_id')
    .eq('pr_url', prUrl)
    .maybeSingle()

  if (!attempt) {
    return new Response(
      JSON.stringify({ ok: true, ignored: 'pr_not_a_mushi_fix', pr_url: prUrl }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Mark the fix attempt as merged so the dashboard PDCA cockpit + the
  // intelligence reports can show "successful fixes" downstream.
  await db.from('fix_attempts')
    .update({ merged_at: new Date().toISOString() })
    .eq('id', attempt.id)
    .is('merged_at', null)

  // Idempotency check — if we already billed this PR, skip the second insert.
  const { data: existing } = await db
    .from('usage_events')
    .select('id')
    .eq('project_id', attempt.project_id)
    .eq('event_name', 'fixes_succeeded')
    .contains('metadata', { fix_attempt_id: attempt.id })
    .limit(1)
    .maybeSingle()

  if (existing) {
    return new Response(
      JSON.stringify({ ok: true, deduped: true, fix_attempt_id: attempt.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { error: usageErr } = await db.from('usage_events').insert({
    project_id: attempt.project_id,
    event_name: 'fixes_succeeded',
    quantity: 1,
    metadata: {
      fix_attempt_id: attempt.id,
      pr_url: prUrl,
      pr_number: payload.pull_request?.number,
      repository: payload.repository?.full_name,
    },
  })

  if (usageErr) {
    log.warn('usage_events fixes_succeeded insert failed (non-fatal)', {
      err: usageErr.message,
      projectId: attempt.project_id,
      prUrl,
    })
  }

  return new Response(
    JSON.stringify({ ok: true, fix_attempt_id: attempt.id, project_id: attempt.project_id }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/**
 * Resolve a GitHub token for a project. Preference order:
 *   1. `project_settings.github_installation_token_ref` (PAT in vault or raw)
 *   2. `GITHUB_TOKEN` env fallback (self-host / founder dogfood)
 * Returns null if nothing resolves. Callers that prefer App installs should
 * call `mintInstallationToken` first and fall through to this helper.
 */
async function resolveProjectGithubToken(
  db: ReturnType<typeof getDb>,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('project_settings')
    .select('github_installation_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (!error && data?.github_installation_token_ref) {
    const ref = String(data.github_installation_token_ref)
    if (ref.startsWith('vault://')) {
      const id = ref.slice('vault://'.length)
      const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: id })
      if (!vaultErr && typeof secret === 'string' && secret.length > 0) {
        return secret
      }
    } else if (ref.length > 0) {
      return ref
    }
  }
  return Deno.env.get('GITHUB_TOKEN') ?? null
}

/**
 * Sweep mode: invoked hourly by pg_cron (see migration
 * 20260418003200_repo_indexer_cron.sql). Re-indexes every project_repos row
 * whose `last_indexed_at` is older than `staleAfterHours` (default 24h).
 *
 * Authenticated via Authorization: Bearer <service_role_key>; we never accept
 * external sweep requests.
 *
 * Token resolution prefers a GitHub App install (`github_app_installation_id`
 * on the row) but falls back to the project's PAT stored in
 * `project_settings.github_installation_token_ref` so repos can be indexed
 * without going through the App flow.
 */
async function handleSweep(req: Request, parsedBody: { project_id?: string } | null): Promise<Response> {
  // Accept either the auto-injected SUPABASE_SERVICE_ROLE_KEY (edge-to-edge
  // calls) or MUSHI_INTERNAL_CALLER_SECRET (pg_cron → pg_net callers, which
  // cannot read the reserved Supabase env var). See packages/server/README.md
  // §"Internal-caller authentication" for the rationale.
  const unauthorized = requireServiceRoleAuth(req)
  if (unauthorized) return unauthorized

  const db = getDb()
  const staleAfterHours = Number(Deno.env.get('MUSHI_REPO_INDEX_STALE_HOURS') ?? '24')
  const cutoff = new Date(Date.now() - staleAfterHours * 3_600_000).toISOString()
  const limit = Number(Deno.env.get('MUSHI_REPO_INDEX_SWEEP_BATCH') ?? '5')

  // Optional body filter: `{ mode:'sweep', project_id? }` scopes the sweep to a
  // single project (used by the new `/v1/admin/projects/:id/codebase/enable`
  // endpoint to index-now without blocking the whole hourly batch).
  let scopedProjectId: string | null = null
  if (parsedBody?.project_id && /^[0-9a-f-]{36}$/i.test(parsedBody.project_id)) {
    scopedProjectId = parsedBody.project_id
  }

  let query = db
    .from('project_repos')
    .select('id, project_id, repo_url, default_branch, github_app_installation_id, last_indexed_at')
    .eq('indexing_enabled', true)

  if (scopedProjectId) {
    query = query.eq('project_id', scopedProjectId)
  } else {
    query = query
      .or(`last_indexed_at.is.null,last_indexed_at.lt.${cutoff}`)
      .order('last_indexed_at', { ascending: true, nullsFirst: true })
      .limit(limit)
  }

  const { data: repos, error } = await query

  if (error) {
    log.error('sweep: project_repos query failed', { error: error.message })
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  const summary: Array<{ repo: string; ok: boolean; error?: string }> = []
  for (const repo of repos ?? []) {
    const [owner, name] = String(repo.repo_url).split('/').slice(-2)
    if (!owner || !name) {
      summary.push({ repo: repo.repo_url, ok: false, error: 'bad_repo_url' })
      continue
    }

    let token: string | null = null
    try {
      token = repo.github_app_installation_id
        ? await mintInstallationToken(Number(repo.github_app_installation_id))
        : await resolveProjectGithubToken(db, repo.project_id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.warn('sweep: App install token mint failed; falling back to PAT', { repo: repo.repo_url, error: msg })
      token = await resolveProjectGithubToken(db, repo.project_id)
    }

    if (!token) {
      summary.push({ repo: repo.repo_url, ok: false, error: 'no_token' })
      await db.from('project_repos').update({
        last_index_attempt_at: new Date().toISOString(),
        last_index_error: 'no_token: neither github_app_installation_id nor project_settings.github_installation_token_ref resolved',
      }).eq('id', repo.id)
      continue
    }

    try {
      const stats = await sweepIndexRepo(db, repo.project_id, token, owner, name, repo.default_branch ?? 'main')
      await db.from('project_repos').update({
        last_indexed_at: new Date().toISOString(),
        last_index_attempt_at: new Date().toISOString(),
        last_index_error: null,
      }).eq('id', repo.id)
      summary.push({ repo: repo.repo_url, ok: true, ...stats })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('sweep: repo index failed', { repo: repo.repo_url, error: msg })
      await db.from('project_repos').update({
        last_index_attempt_at: new Date().toISOString(),
        last_index_error: msg.slice(0, 500),
      }).eq('id', repo.id)
      summary.push({ repo: repo.repo_url, ok: false, error: msg })
    }
  }

  return new Response(JSON.stringify({ ok: true, swept: summary.length, results: summary }), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Index every indexable file at HEAD for `ref`. Used by sweep mode for repos
 * that have never been indexed (or are stale). Push events stick with the
 * narrower diff-walk path because it's much cheaper.
 *
 * Accepts an already-resolved bearer token so the caller can choose between
 * a GitHub App installation token and a user PAT. Both authenticate the same
 * read-only `tree` + `contents` endpoints used below.
 */
async function sweepIndexRepo(
  db: ReturnType<typeof getDb>,
  projectId: string,
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ inserted: number; skipped: number }> {
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!treeRes.ok) throw new Error(`tree fetch ${treeRes.status}`)
  const tree = await treeRes.json() as {
    tree?: Array<{ path: string; type: string }>
    truncated?: boolean
  }
  const files = (tree.tree ?? []).filter(t => t.type === 'blob' && shouldIndex(t.path))
  let inserted = 0
  let skipped = 0
  const cap = Number(Deno.env.get('MUSHI_REPO_INDEX_SWEEP_FILE_CAP') ?? '300')
  for (const f of files.slice(0, cap)) {
    const source = await fetchFileContents(token, owner, repo, f.path, branch)
    if (!source) { skipped++; continue }
    const chunks = chunk(f.path, source)
    for (const ch of chunks) {
      const text = `${f.path}::${ch.symbolName ?? 'whole'}\n${ch.body}`
      const embedding = await createEmbedding(text, { projectId })
      const contentHash = await sha256Hex(ch.body)
      const { error } = await db.from('project_codebase_files').upsert({
        project_id: projectId,
        file_path: f.path,
        symbol_name: ch.symbolName,
        signature: ch.signature,
        line_start: ch.lineStart,
        line_end: ch.lineEnd,
        language: ch.language,
        content_hash: contentHash,
        content_preview: ch.body.slice(0, 600),
        embedding,
        embedding_model: 'text-embedding-3-small',
        last_modified: new Date().toISOString(),
        tombstoned_at: null,
      }, { onConflict: 'project_id,file_path,symbol_name' })
      if (error) { skipped++; continue }
      inserted++
    }
  }
  return { inserted, skipped }
}

app.post('/webhooks-github-indexer', async (c) => {
  const raw = await c.req.text()

  // Sweep mode: cron-invoked, no GitHub signature; auth via service-role bearer.
  if (raw.length > 0) {
    try {
      const peek = JSON.parse(raw) as { mode?: string; project_id?: string }
      if (peek?.mode === 'sweep') {
        return await handleSweep(c.req.raw, peek)
      }
    } catch { /* fall through to webhook handling */ }
  }

  if (!await verifySignature(c.req.raw, raw)) {
    return c.json({ error: 'invalid signature' }, 401)
  }
  const event = c.req.header('X-GitHub-Event') ?? 'unknown'

  // pull_request.closed (merged=true) — value-based billing trigger.
  // Record `fixes_succeeded` if this PR matches a fix we opened.
  if (event === 'pull_request') {
    const prPayload = JSON.parse(raw) as {
      action?: string
      pull_request?: {
        merged?: boolean
        html_url?: string
        number?: number
      }
      repository?: { full_name?: string }
    }
    if (prPayload.action !== 'closed' || !prPayload.pull_request?.merged) {
      return c.json({ ok: true, ignored: `pull_request.${prPayload.action ?? 'unknown'}` }, 202)
    }
    return await handleFixPrMerged(prPayload)
  }

  if (event !== 'push' && event !== 'installation_repositories') {
    return c.json({ ok: true, ignored: event }, 202)
  }

  const payload = JSON.parse(raw) as {
    repository?: { full_name?: string; owner?: { login?: string }; name?: string }
    installation?: { id?: number }
    after?: string
    commits?: Array<{ added?: string[]; modified?: string[]; removed?: string[] }>
  }

  const installationId = payload.installation?.id
  const owner = payload.repository?.owner?.login
  const repo = payload.repository?.name
  const ref = payload.after
  if (!installationId || !owner || !repo || !ref) {
    return c.json({ error: 'missing webhook fields' }, 400)
  }

  const db = getDb()
  const repoFullName = `${owner}/${repo}`
  const { data: project } = await db
    .from('project_integrations')
    .select('project_id')
    .eq('integration_type', 'github')
    .contains('config', { repo: repoFullName })
    .single()

  if (!project?.project_id) {
    return c.json({ ok: true, ignored: 'no_project_for_repo', repoFullName }, 202)
  }

  const token = await mintInstallationToken(installationId)
  const projectId = project.project_id as string

  const added = new Set<string>()
  const removed = new Set<string>()
  for (const commit of payload.commits ?? []) {
    for (const p of [...(commit.added ?? []), ...(commit.modified ?? [])]) added.add(p)
    for (const p of (commit.removed ?? [])) removed.add(p)
  }

  let inserted = 0
  let tombstoned = 0
  let upsertFailures = 0
  let tombstoneFailures = 0
  const languageCounts: Record<string, number> = {}

  for (const path of removed) {
    if (!shouldIndex(path)) continue
    const { error } = await db.from('project_codebase_files')
      .update({ tombstoned_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('file_path', path)
    if (error) {
      tombstoneFailures++
      log.warn('tombstone failed', { projectId, path, error: error.message })
      continue
    }
    tombstoned++
  }

  for (const path of added) {
    if (!shouldIndex(path)) continue
    const source = await fetchFileContents(token, owner, repo, path, ref)
    if (!source) continue
    const chunks = chunk(path, source)
    for (const ch of chunks) {
      const text = `${path}::${ch.symbolName ?? 'whole'}\n${ch.body}`
      const embedding = await createEmbedding(text, { projectId })
      const contentHash = await sha256Hex(ch.body)
      // onConflict matches uq_codebase_chunks (project_id, file_path, symbol_name)
      // NULLS NOT DISTINCT — see migration 20260418000300_codebase_indexer.sql.
      const { error } = await db.from('project_codebase_files').upsert({
        project_id: projectId,
        file_path: path,
        symbol_name: ch.symbolName,
        signature: ch.signature,
        line_start: ch.lineStart,
        line_end: ch.lineEnd,
        language: ch.language,
        content_hash: contentHash,
        content_preview: ch.body.slice(0, 600),
        embedding,
        embedding_model: 'text-embedding-3-small',
        last_modified: new Date().toISOString(),
        tombstoned_at: null,
      }, { onConflict: 'project_id,file_path,symbol_name' })
      if (error) {
        upsertFailures++
        log.error('chunk upsert failed', {
          projectId,
          path,
          symbolName: ch.symbolName,
          error: error.message,
        })
        continue
      }
      inserted++
      languageCounts[ch.language] = (languageCounts[ch.language] ?? 0) + 1
    }
  }

  log.info('indexed push', { projectId, repoFullName, ref, inserted, tombstoned, upsertFailures, tombstoneFailures })

  // If every attempted write failed, fail loudly so the webhook is retried —
  // a silent 200 here is what masked the original onConflict mismatch.
  const attempted = inserted + upsertFailures
  if (attempted > 0 && inserted === 0) {
    return c.json({
      ok: false,
      error: { code: 'ALL_UPSERTS_FAILED', message: 'Every chunk upsert failed; check logs.' },
      projectId,
      attempted,
    }, 500)
  }

  return c.json({
    ok: true,
    projectId,
    inserted,
    tombstoned,
    upsertFailures,
    tombstoneFailures,
    languages: languageCounts,
  })
})

Deno.serve(app.fetch)
