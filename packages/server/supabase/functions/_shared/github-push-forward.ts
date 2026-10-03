/**
 * FILE: packages/server/supabase/functions/_shared/github-push-forward.ts
 * PURPOSE: Push indexing for repos connected with a Personal Access Token
 *          (gap #16b).
 *
 * The GitHub App delivers pushes straight to webhooks-github-indexer, but a
 * repo connected with a PAT has no App installation. Its owner adds a repo
 * webhook pointing at the api's `/v1/webhooks/github`, signed with the
 * project's `github_webhook_secret` (the one Codebase indexing reveals). This
 * module routes such a `push` delivery:
 *
 *   1. find every project_repos row for the repository (case-insensitive
 *      URL match), whatever its indexing or App state;
 *   2. verify X-Hub-Signature-256 against each of those projects' own
 *      secret (fail closed: no verified project, no indexing);
 *   3. hand each verified, indexing-enabled, App-less row's push to the
 *      indexer's internal `mode: 'push'` (the path an App delivery takes).
 *
 * An unverified delivery gets the same 401 whether or not any project has
 * the repo, so the public endpoint cannot be used to learn which repos Mushi
 * customers index. The difference is kept in the audit note only.
 *
 * Rows with an App installation are skipped: the App already delivers that
 * push to the indexer, and indexing it twice would double the embedding cost.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { dereferenceMaybeVault } from './settings-secrets.ts'

/** Timing-safe check of GitHub's `X-Hub-Signature-256: sha256=<hex>` header. */
export async function githubSignatureMatches(headerSig: string, body: string, secret: string): Promise<boolean> {
  const expected = headerSig.startsWith('sha256=') ? headerSig.slice('sha256='.length) : ''
  if (!expected || !secret) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (computed.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/** Escape LIKE wildcards so a repo named `my_app` cannot match `myXapp`. */
function likeLiteral(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export interface PushForwardRequest {
  projectId: string
  repoId: string
  deliveryId: string
  payload: unknown
}

export interface PatPushResult {
  status: 200 | 202 | 400 | 401 | 500
  body: Record<string, unknown>
  /** Audit-log outcome for the delivery. */
  outcome: 'accepted' | 'rejected_signature' | 'error'
  /** Projects whose secret verified the push (first one tags the audit row). */
  projectIds: string[]
  /** Audit-log note: why a delivery was rejected or not forwarded. */
  auditNote?: string
}

const UNVERIFIED: Omit<PatPushResult, 'auditNote'> = {
  status: 401,
  body: {
    ok: false,
    error: {
      code: 'INVALID_SIGNATURE',
      message:
        "Push signature did not match the webhook secret of a project indexing this repo. Use the secret Codebase indexing revealed (or rotate it).",
    },
  },
  outcome: 'rejected_signature',
  projectIds: [],
}

/**
 * Route one `push` delivery received on `/v1/webhooks/github`. `forward`
 * performs the hand-off to the indexer (in production: a background POST
 * with internal-caller auth); it is only called for verified projects.
 */
export async function routePatPushWebhook(
  input: { body: string; signature: string; deliveryId: string | null },
  deps: { db: SupabaseClient; forward: (req: PushForwardRequest) => Promise<void> },
): Promise<PatPushResult> {
  let payload: { repository?: { full_name?: unknown } } & Record<string, unknown>
  try {
    payload = JSON.parse(input.body)
  } catch {
    return { status: 400, body: { ok: false, error: { code: 'BAD_JSON', message: 'Invalid JSON body' } }, outcome: 'error', projectIds: [] }
  }
  const fullName = typeof payload?.repository?.full_name === 'string' ? payload.repository.full_name : ''
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    return { status: 200, body: { ok: true, data: { reason: 'missing repository' } }, outcome: 'accepted', projectIds: [] }
  }
  const repoUrl = `https://github.com/${fullName}`

  const { data: rows, error } = await deps.db
    .from('project_repos')
    .select('id, project_id, repo_url, github_app_installation_id, indexing_enabled')
    .ilike('repo_url', likeLiteral(repoUrl))
    .limit(50)
  if (error) {
    return { status: 500, body: { ok: false, error: { code: 'DB_ERROR', message: 'Could not look up the repository' } }, outcome: 'error', projectIds: [] }
  }
  const candidates = ((rows ?? []) as Array<{
    id: string
    project_id: string
    repo_url: string
    github_app_installation_id: number | null
    indexing_enabled: boolean | null
  }>).filter((r) => String(r.repo_url).toLowerCase() === repoUrl.toLowerCase())
  if (candidates.length === 0) return { ...UNVERIFIED, auditNote: 'NO_PROJECT_FOR_REPO' }

  const verified: typeof candidates = []
  const secretByProject = new Map<string, boolean>()
  for (const cand of candidates) {
    let ok = secretByProject.get(cand.project_id)
    if (ok === undefined) {
      const { data: settings } = await deps.db
        .from('project_settings')
        .select('github_webhook_secret')
        .eq('project_id', cand.project_id)
        .maybeSingle()
      const secret = await dereferenceMaybeVault(
        deps.db,
        ((settings as { github_webhook_secret?: string | null } | null)?.github_webhook_secret) ?? null,
      )
      ok = !!secret && (await githubSignatureMatches(input.signature, input.body, secret))
      secretByProject.set(cand.project_id, ok)
    }
    if (ok) verified.push(cand)
  }
  if (verified.length === 0) return { ...UNVERIFIED, auditNote: 'INVALID_SIGNATURE' }

  // Only a signed caller learns what happened to its push.
  const projectIds = [...new Set(verified.map((r) => r.project_id))]
  const toIndex = verified.filter((r) => r.indexing_enabled === true && r.github_app_installation_id == null)
  if (toIndex.length === 0) {
    const appCovered = verified.some((r) => r.github_app_installation_id != null)
    return {
      status: 202,
      body: {
        ok: true,
        data: {
          forwarded: 0,
          reason: appCovered ? 'the GitHub App indexes this repo' : 'codebase indexing is off for this repo',
        },
      },
      outcome: 'accepted',
      projectIds,
      auditNote: appCovered ? 'APP_DELIVERS_PUSH' : 'INDEXING_OFF',
    }
  }

  const deliveryId = input.deliveryId ?? crypto.randomUUID()
  for (const row of toIndex) {
    await deps.forward({ projectId: row.project_id, repoId: row.id, deliveryId, payload })
  }
  return {
    status: 202,
    body: { ok: true, data: { forwarded: toIndex.length, projectIds: [...new Set(toIndex.map((r) => r.project_id))] } },
    outcome: 'accepted',
    projectIds,
  }
}

/** Wall-clock budget for one forwarded push (the edge function limit). */
export const PUSH_FORWARD_TIMEOUT_MS = 150_000

/**
 * The production `forward` for routePatPushWebhook: POST the push to the
 * indexer's internal `mode: 'push'` in the background (GitHub wants an answer
 * within 10 s). The outcome is not only logged: a non-2xx answer, a failed
 * request or a timeout is written to the repo's `last_index_error` and
 * `last_index_attempt_at`, so the console and doctor show it.
 */
export function createIndexerPushForwarder(deps: {
  db: SupabaseClient
  supabaseUrl: string | undefined
  internalSecret: string | undefined
  background: (task: Promise<unknown>, label: string) => void
  log: { warn(msg: string, ctx?: Record<string, unknown>): void; error(msg: string, ctx?: Record<string, unknown>): void }
  fetchImpl?: typeof fetch
  timeoutMs?: number
  nowIso?: () => string
}): (req: PushForwardRequest) => Promise<void> {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.nowIso ?? (() => new Date().toISOString())
  const timeoutMs = deps.timeoutMs ?? PUSH_FORWARD_TIMEOUT_MS

  const recordFailure = async (req: PushForwardRequest, message: string): Promise<void> => {
    deps.log.warn('PAT push index failed', { projectId: req.projectId, repoId: req.repoId, error: message })
    const { error } = await deps.db
      .from('project_repos')
      .update({ last_index_attempt_at: now(), last_index_error: message.slice(0, 500) })
      .eq('id', req.repoId)
    if (error) deps.log.error('PAT push index failure could not be recorded', { repoId: req.repoId, error: error.message })
  }

  return async (req) => {
    if (!deps.supabaseUrl || !deps.internalSecret) {
      await recordFailure(req, 'push indexing is not configured on this server (SUPABASE_URL / internal caller secret missing)')
      throw new Error('indexer forward not configured (SUPABASE_URL / internal secret)')
    }
    const task = (async () => {
      let res: Response
      try {
        res = await doFetch(`${deps.supabaseUrl}/functions/v1/webhooks-github-indexer`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${deps.internalSecret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'push',
            project_id: req.projectId,
            repo_id: req.repoId,
            delivery_id: req.deliveryId,
            payload: req.payload,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        const name = err instanceof Error ? err.name : ''
        const message = name === 'TimeoutError' || name === 'AbortError'
          ? `push indexing did not answer within ${Math.round(timeoutMs / 1000)} s (it may have hit the edge function time limit); the daily sweep catches the files up`
          : `push indexing request failed: ${err instanceof Error ? err.message : String(err)}`
        await recordFailure(req, message)
        return
      }
      if (!res.ok) {
        const detail = await res.text().then((t) => t.slice(0, 300)).catch(() => '')
        await recordFailure(req, `push indexing failed: HTTP ${res.status}${detail ? `: ${detail}` : ''}`)
      }
    })()
    deps.background(task, 'pat-push-index')
  }
}
