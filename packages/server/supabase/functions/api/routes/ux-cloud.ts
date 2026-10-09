/**
 * FILE: packages/server/supabase/functions/api/routes/ux-cloud.ts
 * PURPOSE: "Start a cloud UX run" from the console (Plan 021 Phase 4).
 *
 *   POST /v1/admin/projects/:pid/ux-runs/cloud
 *
 * Fires a `repository_dispatch` (event `mushi-ux-run`) at the project's front
 * end repo. The host's `.github/workflows/mushi-ux.yml` runs the pass on its
 * own runner and syncs it back, so the run shows up on /ux-runs like a local
 * one. The pass ends in a draft PR at most; nothing merges (ADR 0016/0017).
 *
 * Console session only (jwtAuth): an API key cannot start a run that spends
 * the host's Actions minutes and Cursor credits (ADR 0017). Every failure
 * answers with the `gh workflow run` command to start it by hand, under
 * `data.fallback` (the console keeps `data` on an error envelope).
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { logAudit } from '../../_shared/audit.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken } from '../../_shared/github.ts'
import { claimTenantRateLimit } from '../../_shared/tenant-observability.ts'
import {
  CloudRunInput,
  clientPayload,
  fallbackCommand,
  pickUxRepo,
  UX_DISPATCH_EVENT,
  UX_TEMPLATE_URL,
  UX_WORKFLOW_PATH,
  type UxRepoRow,
} from '../../_shared/ux-cloud.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'

const RUNS_PER_HOUR = 3

export function registerUxCloudRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/v1/admin/projects/:pid/ux-runs/cloud', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot start a cloud run.', 403)

    const parsed = CloudRunInput.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return jsonError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid run settings')
    const input = parsed.data

    const [{ data: repoRows }, { data: settings }] = await Promise.all([
      db
        .from('project_repos')
        .select('repo_url, role, is_primary, default_branch, github_app_installation_id')
        .eq('project_id', projectId),
      db.from('project_settings').select('github_repo_url').eq('project_id', projectId).maybeSingle(),
    ])
    const choice = pickUxRepo((repoRows ?? []) as UxRepoRow[], (settings as { github_repo_url?: string | null } | null)?.github_repo_url ?? null)
    const ref = parseGithubRepoUrl(choice?.repoUrl ?? null)
    if (!choice || !ref) return jsonError(c, 'NO_REPO', 'Link the app’s GitHub repo first (Code → Repos).', 409)
    const { owner, repo } = ref
    const fallback = { command: fallbackCommand(owner, repo, input), template_url: UX_TEMPLATE_URL }

    // Never the platform token: it could reach repos this project does not own.
    const token = await resolveProjectGithubToken(db, projectId, choice.installationId, { allowEnvFallback: false })
    if (!token) {
      return c.json({ ok: false, error: { code: 'NO_GITHUB_TOKEN', message: 'Connect GitHub for this project, or run the command yourself.' }, data: { fallback } }, 409)
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    const api = `https://api.github.com/repos/${owner}/${repo}`

    // repository_dispatch only runs the workflow on the default branch, so
    // that is where the file has to be.
    const info = await fetch(api, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (info?.status === 404 || info?.status === 403) {
      return c.json(
        {
          ok: false,
          error: { code: 'NO_REPO_ACCESS', message: `Mushi’s GitHub connection cannot see ${owner}/${repo}. Reconnect GitHub for this repo, or run the command yourself.` },
          data: { fallback },
        },
        409,
      )
    }
    const repoInfo = info?.ok ? ((await info.json()) as { default_branch?: string }) : null
    const branch = repoInfo?.default_branch ?? choice.defaultBranch ?? 'main'
    const wf = await fetch(`${api}/contents/${UX_WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!wf?.ok) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'WORKFLOW_MISSING',
            message: `${owner}/${repo} has no ${UX_WORKFLOW_PATH} on ${branch}. Add the template, then try again.`,
          },
          data: { fallback },
        },
        409,
      )
    }

    const rate = await claimTenantRateLimit(db, `project:${projectId}:ux_cloud_run`, RUNS_PER_HOUR, 3600)
    if (!rate.allowed) {
      return c.json(
        { ok: false, error: { code: 'RATE_LIMITED', message: `At most ${RUNS_PER_HOUR} cloud runs an hour per app.`, retry_after_sec: rate.retryAfterSec } },
        429,
      )
    }

    const res = await fetch(`${api}/dispatches`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: UX_DISPATCH_EVENT, client_payload: clientPayload(input) }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null)
    if (!res || res.status !== 204) {
      const refused = res?.status === 403 || res?.status === 404 || res?.status === 422
      // A refusal is the host's setup, not a Mushi fault: 409 keeps it out of
      // the console's 5xx error reporting. A timeout or GitHub 5xx stays 502.
      return c.json(
        {
          ok: false,
          error: {
            code: refused ? 'GH_DISPATCH_FORBIDDEN' : 'GH_DISPATCH_FAILED',
            message: `GitHub did not accept the run (HTTP ${res?.status ?? 'timeout'}). Start it with the command instead.`,
          },
          data: { fallback },
        },
        refused ? 409 : 502,
      )
    }

    void logAudit(
      db,
      projectId,
      userId,
      'ux_run.cloud_requested',
      'repository',
      `${owner}/${repo}`,
      { agent: input.agent, model: input.model ?? null, max_surfaces: input.max_surfaces, iterations: input.iterations },
      { email: (c.get('userEmail') as string | undefined) ?? undefined },
    )
    return c.json(
      {
        ok: true,
        data: { repo: `${owner}/${repo}`, actions_url: `https://github.com/${owner}/${repo}/actions/workflows/mushi-ux.yml` },
      },
      202,
    )
  })
}
