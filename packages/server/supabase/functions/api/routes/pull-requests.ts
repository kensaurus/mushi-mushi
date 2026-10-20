/**
 * FILE: packages/server/supabase/functions/api/routes/pull-requests.ts
 * PURPOSE: The open pull requests of the repos connected to a project, with
 *          the checks each needs, and a merge a person starts from the
 *          console (ADR 0017). Fixes and UX runs merge their own PRs; this
 *          covers every other PR, so a release can ship from the console
 *          without a trip to GitHub (owner, 2026-10-08).
 *
 * Merging is jwtAuth only: an API key cannot merge. GitHub's own branch
 * rules still refuse a PR whose required checks have not passed. The squash
 * title and message are written here, never GitHub's commit list, which can
 * carry a "[skip ci]" that silences the release workflow.
 *
 * A PR that is a Mushi fix goes through the same review gate as
 * POST /v1/admin/fixes/:id/merge (ADR 0030): a hold is refused unless the
 * person overrides it with a reason, and GitHub merges only the head commit
 * the gate saw. The list shows each fix PR's review.
 */
import type { Hono } from 'npm:hono@4'
import { z } from 'npm:zod@3'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { callerCanAccessProject, jsonError } from '../shared.ts'
import { logAudit } from '../../_shared/audit.ts'
import type { GithubRepoRef } from '../../_shared/github.ts'
import { checkRuns, connectedRepoRefs, githubJsonHeaders, repoTokenResolver, requiredChecks, sameRepo, stripCiSkips } from '../../_shared/github-pr-checks.ts'
import { summarizeChecks, type PrChecks } from '../../_shared/ux-runs.ts'
import { reviewStatesForPrs } from '../../_shared/fix-review-db.ts'
import { gatedMergePullRequest } from '../../_shared/gated-merge.ts'
import type { ReviewState, ReviewVerdict } from '../../_shared/fix-review.ts'

const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/
/** Open PRs read per repo; the console lists the most recently updated. */
const PRS_PER_REPO = 10
const REPOS_READ = 3

export interface OpenPullRequest {
  repo: string
  number: number
  title: string
  url: string
  draft: boolean
  author: string | null
  headRef: string
  baseRef: string
  updatedAt: string
  checks: PrChecks
  /** The Opus review when this PR is a Mushi fix (ADR 0030); absent otherwise. */
  review?: { state: ReviewState; label: string; fixId: string | null; verdict: ReviewVerdict | null }
}

interface GithubPull {
  number: number
  title: string
  html_url: string
  draft?: boolean
  user?: { login?: string } | null
  head: { ref: string; sha: string }
  base: { ref: string }
  updated_at: string
}

export function registerPullRequestRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/projects/:pid/pull-requests', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    const repos = (await connectedRepoRefs(db, projectId)).slice(0, REPOS_READ)
    if (repos.length === 0) return c.json({ ok: true, data: { pullRequests: [], repos: [] } })
    // Each repo is read with its own App installation; a repo nothing can read is left out.
    const tokenFor = await repoTokenResolver(db, projectId)
    const readable = (await Promise.all(repos.map(async (ref) => ({ ref, token: await tokenFor(ref) }))))
      .filter((r): r is { ref: GithubRepoRef; token: string } => r.token !== null)
    if (readable.length === 0) return jsonError(c, 'GITHUB_NOT_CONNECTED', 'Connect GitHub for this project (App or token) to see its pull requests.', 409)
    try {
      const lists = await Promise.all(readable.map(({ ref, token }) => openPulls(token, ref)))
      const required = new Map<string, Promise<string[]>>()
      const requiredFor = (token: string, ref: GithubRepoRef, base: string) => {
        const key = `${ref.owner}/${ref.repo}#${base}`
        if (!required.has(key)) required.set(key, requiredChecks(token, ref, base))
        return required.get(key)!
      }
      const pullRequests: OpenPullRequest[] = await Promise.all(
        lists.flatMap(({ ref, token, pulls }) =>
          pulls.map(async (p) => {
            const [req, runs] = await Promise.all([requiredFor(token, ref, p.base.ref), checkRuns(token, ref, p.head.sha)])
            return {
              repo: `${ref.owner}/${ref.repo}`,
              number: p.number,
              title: p.title,
              url: p.html_url,
              draft: p.draft === true,
              author: p.user?.login ?? null,
              headRef: p.head.ref,
              baseRef: p.base.ref,
              updatedAt: p.updated_at,
              checks: summarizeChecks(req, runs),
            }
          }),
        ),
      )
      const heads = new Map<string, string>(
        lists.flatMap(({ ref, pulls }) => pulls.map((p): [string, string] => [`${ref.owner}/${ref.repo}#${p.number}`, p.head.sha])),
      )
      const reviews = await reviewStatesForPrs(
        db,
        projectId,
        pullRequests.map((p) => ({ repo: p.repo, number: p.number, headSha: heads.get(`${p.repo}#${p.number}`) ?? null })),
      )
      for (const pr of pullRequests) {
        const review = reviews.get(`${pr.repo}#${pr.number}`)
        if (review) pr.review = { state: review.state, label: review.label, fixId: review.fixAttemptId, verdict: review.verdict }
      }
      pullRequests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      return c.json({ ok: true, data: { pullRequests, repos: readable.map(({ ref }) => `${ref.owner}/${ref.repo}`) } })
    } catch (err) {
      return jsonError(c, 'UPSTREAM_ERROR', `GitHub did not answer: ${(err as Error).message.slice(0, 200)}`, 502)
    }
  })

  // Console session only (jwtAuth): a person clicks Merge (ADR 0017).
  app.post('/v1/admin/projects/:pid/pull-requests/:owner/:repo/:number/merge', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const projectId = c.req.param('pid')!
    const owner = c.req.param('owner')!
    const repo = c.req.param('repo')!
    const number = Number(c.req.param('number'))
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo) || !Number.isInteger(number) || number < 1) {
      return jsonError(c, 'VALIDATION_ERROR', 'Malformed repository or pull request number.')
    }
    const body = z
      .object({
        method: z.enum(['squash', 'merge', 'rebase']).default('squash'),
        override: z.boolean().optional(),
        overrideReason: z.string().max(500).optional(),
        confirmPendingReview: z.boolean().optional(),
      })
      .safeParse((await c.req.json().catch(() => ({}))) ?? {})
    if (!body.success) return jsonError(c, 'VALIDATION_ERROR', 'method must be squash, merge or rebase')
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed) return jsonError(c, 'FORBIDDEN', 'Not a member of this project', 403)
    if (access.role === 'viewer') return jsonError(c, 'FORBIDDEN', 'Viewers cannot merge.', 403)
    const ref: GithubRepoRef = { owner, repo }
    if (!(await connectedRepoRefs(db, projectId)).some((r) => sameRepo(r, ref))) {
      return jsonError(c, 'FORBIDDEN', `${owner}/${repo} is not connected to this project.`, 403)
    }
    const token = await (await repoTokenResolver(db, projectId))(ref)
    if (!token) return jsonError(c, 'GITHUB_NOT_CONNECTED', 'Connect GitHub for this project (App or token) to merge its pull requests.', 409)
    const pull = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${number}`, { headers: githubJsonHeaders(token), signal: AbortSignal.timeout(10_000) })
      .then(async (r) => (r.ok ? ((await r.json()) as { title?: string; state?: string; head?: { sha?: string } }) : null))
      .catch(() => null)
    if (!pull) return jsonError(c, 'NOT_FOUND', `Pull request #${number} was not found in ${owner}/${repo}.`, 404)
    if (pull.state !== 'open') return jsonError(c, 'NOT_OPEN', `Pull request #${number} is not open.`, 409)

    // ADR 0030: the one gated merge (_shared/gated-merge.ts). A PR linked to
    // a Mushi fix review goes through the review gate; any other PR merges as before.
    let outcome
    try {
      outcome = await gatedMergePullRequest(db, {
        projectId,
        token,
        ref,
        number,
        currentHead: pull.head?.sha ?? null,
        override: body.data.override === true,
        overrideReason: body.data.overrideReason?.trim() || null,
        confirmPendingReview: body.data.confirmPendingReview === true,
        authMethod: c.get('authMethod') as string | undefined,
        role: access.role,
        merge: {
          mergeMethod: body.data.method,
          ...(body.data.method === 'rebase'
            ? {}
            : {
                commitTitle: pull.title ? `${stripCiSkips(pull.title)} (#${number})` : undefined,
                commitMessage: 'Merged from the Mushi console.',
              }),
        },
      })
    } catch (err) {
      return jsonError(c, 'UPSTREAM_ERROR', `GitHub did not merge: ${(err as Error).message.slice(0, 200)}`, 502)
    }
    if (!outcome.ok) {
      return c.json({ ok: false, error: { code: outcome.code, message: outcome.message }, data: { review: outcome.review } }, outcome.status)
    }
    const result = outcome.result
    if (!result.merged) return jsonError(c, result.headMoved ? 'HEAD_MOVED' : 'MERGE_REJECTED', result.message ?? 'GitHub refused the merge.', 409)
    await logAudit(db, projectId, userId, 'pull_request.merged', 'pull_request', `${owner}/${repo}#${number}`, {
      method: body.data.method,
      already_merged: result.alreadyMerged,
      sha: result.sha ?? null,
      ...outcome.audit,
    }).catch(() => null)
    return c.json({ ok: true, data: { merged: true, alreadyMerged: result.alreadyMerged, sha: result.sha, message: result.message } })
  })
}

async function openPulls(token: string, ref: GithubRepoRef): Promise<{ ref: GithubRepoRef; token: string; pulls: GithubPull[] }> {
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls?state=open&sort=updated&direction=desc&per_page=${PRS_PER_REPO}`,
    { headers: githubJsonHeaders(token), signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) throw new Error(`${ref.owner}/${ref.repo} pulls ${res.status}`)
  return { ref, token, pulls: (await res.json()) as GithubPull[] }
}
