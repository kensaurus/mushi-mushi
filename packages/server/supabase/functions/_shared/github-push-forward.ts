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
 *   1. find the indexing-enabled, App-less project_repos rows for the
 *      repository (case-insensitive URL match);
 *   2. verify X-Hub-Signature-256 against each candidate project's own
 *      secret (fail closed: no verified project, no indexing);
 *   3. hand each verified project's push to the indexer's internal
 *      `mode: 'push'` (the same path an App delivery takes).
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
  /** Projects the push was forwarded for (first one tags the audit row). */
  projectIds: string[]
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
    .select('id, project_id, repo_url, github_app_installation_id')
    .ilike('repo_url', likeLiteral(repoUrl))
    .eq('indexing_enabled', true)
    .is('github_app_installation_id', null)
    .limit(20)
  if (error) {
    return { status: 500, body: { ok: false, error: { code: 'DB_ERROR', message: 'Could not look up the repository' } }, outcome: 'error', projectIds: [] }
  }
  const candidates = ((rows ?? []) as Array<{ id: string; project_id: string; repo_url: string; github_app_installation_id: number | null }>)
    .filter((r) => r.github_app_installation_id == null && String(r.repo_url).toLowerCase() === repoUrl.toLowerCase())
  if (candidates.length === 0) {
    return { status: 200, body: { ok: true, data: { reason: 'no PAT-connected repo with indexing on' } }, outcome: 'accepted', projectIds: [] }
  }

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
  if (verified.length === 0) {
    return {
      status: 401,
      body: {
        ok: false,
        error: {
          code: 'INVALID_SIGNATURE',
          message: "Push signature did not match the webhook secret of any project indexing this repo. Use the secret Codebase indexing revealed (or rotate it).",
        },
      },
      outcome: 'rejected_signature',
      projectIds: [],
    }
  }

  const deliveryId = input.deliveryId ?? crypto.randomUUID()
  for (const row of verified) {
    await deps.forward({ projectId: row.project_id, repoId: row.id, deliveryId, payload })
  }
  const projectIds = [...new Set(verified.map((r) => r.project_id))]
  return { status: 202, body: { ok: true, data: { forwarded: verified.length, projectIds } }, outcome: 'accepted', projectIds }
}
