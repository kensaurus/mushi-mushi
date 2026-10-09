/**
 * FILE: packages/server/supabase/functions/_shared/indexer-internal.ts
 * PURPOSE: The internal (service-role) entry points of webhooks-github-indexer:
 *          `{ mode: 'sweep' }` from pg_cron / "Index now", and
 *          `{ mode: 'push' }` from the api for PAT-connected repos (gap #16b).
 *
 * Kept out of the indexer's index.ts (which calls Deno.serve at load) so the
 * dispatch and the push handler are unit-tested.
 *
 * The dispatch rule that matters: only JSON.parse may fall through to the
 * GitHub-webhook path. A sweep or push handler that throws used to be caught
 * by the same `catch {}` and fall into webhook handling, where it failed the
 * signature check and came back as 401 "invalid signature", hiding the real
 * error from the api and the console.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export interface InternalIndexerBody {
  mode?: unknown
  project_id?: unknown
  repo_id?: unknown
  delivery_id?: unknown
  payload?: unknown
  frame_paths?: unknown
}

export interface InternalLogger {
  error(message: string, ctx?: Record<string, unknown>): void
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/**
 * Route an internal request. Returns null only when `raw` is not an internal
 * request (not JSON, or no known `mode`), so the caller treats it as a
 * GitHub webhook delivery. A handler that throws becomes a 500 JSON with a
 * stable code and a fixed message; it never falls through. The error itself
 * goes to the log only, never into the response.
 */
export async function dispatchInternalIndexerRequest(
  raw: string,
  handlers: {
    sweep: (body: InternalIndexerBody) => Promise<Response>
    push: (body: InternalIndexerBody) => Promise<Response>
  },
  log: InternalLogger,
): Promise<Response | null> {
  if (raw.length === 0) return null
  let body: InternalIndexerBody
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    body = parsed as InternalIndexerBody
  } catch {
    return null
  }
  const mode = body.mode
  if (mode !== 'sweep' && mode !== 'push') return null
  try {
    return mode === 'sweep' ? await handlers.sweep(body) : await handlers.push(body)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    log.error(`internal ${mode} failed`, { error: detail })
    return json(
      mode === 'sweep'
        ? { ok: false, error: { code: 'SWEEP_FAILED', message: 'The index sweep failed. The indexer logs have the cause.' } }
        : { ok: false, error: { code: 'PUSH_INDEX_FAILED', message: 'Indexing the push failed. The indexer logs have the cause.' } },
      500,
    )
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The project_repos row the internal push handler reads. */
export interface InternalPushRepoRow {
  id: string
  project_id: string
  repo_url: string
  default_branch: string | null
  github_app_installation_id: number | null
  indexing_enabled: boolean
  path_globs: string[] | null
  index_file_cap: number | null
  index_files_indexed: number | null
  index_files_eligible: number | null
  index_tree_truncated: boolean | null
  index_coverage_state: string | null
}

export const INTERNAL_PUSH_REPO_COLUMNS =
  'id, project_id, repo_url, default_branch, github_app_installation_id, indexing_enabled, path_globs, ' +
  'index_file_cap, index_files_indexed, index_files_eligible, index_tree_truncated, index_coverage_state'

export interface InternalPushPayload {
  repository?: { owner?: { login?: string }; name?: string }
  after?: string
}

/**
 * `{ mode: 'push' }`: the api verified a push delivery against a PAT-connected
 * project's own webhook secret and forwards it, because a repo without the
 * GitHub App never delivers to the indexer. Service-role auth only.
 */
export async function handleInternalPushRequest<P extends InternalPushPayload>(
  req: Request,
  body: InternalIndexerBody,
  deps: {
    db: SupabaseClient
    requireAuth: (req: Request) => Response | null
    resolveToken: (projectId: string) => Promise<string | null>
    indexPush: (args: {
      row: InternalPushRepoRow
      token: string
      owner: string
      repo: string
      payload: P
      deliveryId: string
    }) => Promise<{ status: number; body: Record<string, unknown> }>
    nowIso?: () => string
  },
): Promise<Response> {
  const unauthorized = deps.requireAuth(req)
  if (unauthorized) return unauthorized

  const projectId = typeof body.project_id === 'string' && UUID_RE.test(body.project_id) ? body.project_id : null
  const repoId = typeof body.repo_id === 'string' && UUID_RE.test(body.repo_id) ? body.repo_id : null
  const payload = body.payload && typeof body.payload === 'object' ? (body.payload as P) : null
  const owner = payload?.repository?.owner?.login
  const repo = payload?.repository?.name
  if (!projectId || !repoId || !payload || !owner || !repo || !payload.after) {
    return json({ ok: false, error: { code: 'BAD_REQUEST', message: 'project_id, repo_id and a push payload are required' } }, 400)
  }
  const deliveryId = typeof body.delivery_id === 'string' && body.delivery_id ? body.delivery_id : crypto.randomUUID()
  const now = deps.nowIso ?? (() => new Date().toISOString())

  const { data, error } = await deps.db
    .from('project_repos')
    .select(INTERNAL_PUSH_REPO_COLUMNS)
    .eq('id', repoId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) {
    return json({ ok: false, error: { code: 'DB_ERROR', message: error.message } }, 500)
  }
  const row = data as InternalPushRepoRow | null
  if (!row || !row.indexing_enabled) return json({ ok: true, ignored: 'indexing_not_enabled' }, 202)
  // An App install already delivers this push to the indexer directly;
  // indexing it twice would double the embedding spend.
  if (row.github_app_installation_id) return json({ ok: true, ignored: 'app_installation_delivers_directly' }, 202)
  if (String(row.repo_url).toLowerCase() !== `https://github.com/${owner}/${repo}`.toLowerCase()) {
    return json({ ok: true, ignored: 'repo_mismatch' }, 202)
  }

  const token = await deps.resolveToken(projectId)
  if (!token) {
    const { error: bookErr } = await deps.db
      .from('project_repos')
      .update({
        last_index_attempt_at: now(),
        last_index_error: 'no_token: push received but no GitHub token resolved for this project',
      })
      .eq('id', repoId)
    if (bookErr) {
      return json({ ok: false, error: { code: 'DB_ERROR', message: `no_token, and recording it failed: ${bookErr.message}` } }, 500)
    }
    return json({ ok: true, ignored: 'no_token' }, 202)
  }

  const pushed = await deps.indexPush({ row, token, owner, repo, payload, deliveryId })
  return json({ ...pushed.body, via: 'pat_webhook' }, pushed.status)
}
