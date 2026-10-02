/**
 * FILE: packages/server/supabase/functions/api/routes/repo-diagram.ts
 * PURPOSE: Architecture diagram v0 and its opt-in public page
 *          (Plan 020 §10.3.2–3).
 *
 *   GET    /v1/admin/projects/:id/codebase/diagram                  latest diagram + publish state
 *   POST   /v1/admin/projects/:id/codebase/diagram                  generate for the current SHA (on demand only)
 *   GET    /v1/admin/projects/:id/codebase/diagram/publish-preview  exactly what would be public
 *   POST   /v1/admin/projects/:id/codebase/diagram/publish          publish (owner/admin, console only)
 *   DELETE /v1/admin/projects/:id/codebase/diagram/publish          unpublish
 *   GET    /v1/public/diagrams/:owner/:repo                         the public page's data
 *
 * Cost rule: a diagram is one LLM call per (project, SHA), made only when a
 * person asks. A second request for the same SHA returns the stored one
 * unless `force` is set, and generation is rate limited per project.
 *
 * Public pages: public repos may publish after one click; a private repo's
 * page needs the owner to confirm a preview of exactly what becomes public.
 * The publish request carries the hash of the payload the owner saw, so a
 * regenerate between preview and publish is refused instead of publishing
 * something nobody reviewed. A published page is a frozen copy: regenerating
 * does not change it until the owner publishes again.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { z } from 'npm:zod@3'

import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts'
import { ASSIST_EFFORT, ASSIST_FALLBACK, ASSIST_MODEL, THINKING_HEADROOM_TOKENS } from '../../_shared/models.ts'
import { claudeGenerateObject } from '../../_shared/claude-messages.ts'
import { generateValidatedObject } from '../../_shared/structured-output.ts'
import { withAnthropicOrOpenAi } from '../../_shared/llm-failover.ts'
import { logLlmInvocation } from '../../_shared/telemetry.ts'
import { createTrace } from '../../_shared/observability.ts'
import { emitProductEvent } from '../../_shared/product-events.ts'
import { logAudit } from '../../_shared/audit.ts'
import {
  buildRepoDigestFromTree,
  fetchTreeAtSha,
  resolveCommitSha,
  sha256HexOf,
  treePathSet,
  RepoDigestError,
} from '../../_shared/repo-digest.ts'
import {
  buildDiagramUserPrompt,
  decidePublish,
  DIAGRAM_SYSTEM_PROMPT,
  fetchRepoVisibility,
  isValidRepoSlug,
  layoutDiagram,
  publicDiagramPayload,
  publicPayloadHash,
  publicationOutdated,
  validateDiagram,
  type DiagramGraph,
} from '../../_shared/repo-diagram.ts'
import { callerCanAccessProject, dbError } from '../shared.ts'
import { resolveConnectedRepo } from './repo-digest.ts'
import { claimIpRateLimit, extractClientIp } from './cli-auth.ts'

const routeLog = log.child('repo-diagram')

type Db = ReturnType<typeof getServiceClient>

/** The digest the model reads: README, manifests, entry points and top source files. */
const DIAGRAM_DIGEST_BUDGET = 24_000
const DIAGRAM_MAX_OUTPUT_TOKENS = 6_000
const DIAGRAM_GENERATIONS_PER_HOUR = 6
const MAX_DIAGRAMS_PER_PROJECT = 10
const PUBLIC_VIEWS_PER_HOUR_PER_IP = 120
const PUBLIC_PAGE_BASE = 'https://kensaur.us/mushi-mushi/r'
/**
 * Wall-clock budget: the edge function must finish the GitHub reads and the
 * LLM call well inside the platform limit (150 s), or the console shows an
 * error while the server is still working and a retry pays twice.
 */
const DIAGRAM_DIGEST_DEADLINE_MS = 30_000
const DIAGRAM_LLM_TIMEOUT_MS = 90_000

const DiagramLlmSchema = z.object({
  groups: z.array(z.object({ id: z.string(), label: z.string() })),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      group: z.string(),
      path: z.string().describe('Folder or file path copied exactly from the tree, or empty'),
      description: z.string(),
    }),
  ),
  edges: z.array(z.object({ from: z.string(), to: z.string(), label: z.string() })),
})

interface DiagramRow {
  id: string
  project_id: string
  commit_sha: string
  repo_owner: string
  repo_name: string
  graph: DiagramGraph
  stats: Record<string, unknown>
  model: string | null
  created_at: string
  updated_at: string
}

const DIAGRAM_COLUMNS = 'id, project_id, commit_sha, repo_owner, repo_name, graph, stats, model, created_at, updated_at'

export function publicDiagramUrl(owner: string, repo: string): string {
  return `${PUBLIC_PAGE_BASE}/${owner}/${repo}`
}

async function claimDiagramGeneration(db: Db, projectId: string): Promise<'ok' | 'limited' | 'unavailable'> {
  const { error } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: projectId,
    p_scope: 'repo-diagram',
    p_max_per_window: DIAGRAM_GENERATIONS_PER_HOUR,
    p_window: '1 hour',
  })
  if (!error) return 'ok'
  if ((error.message ?? '').includes('rate_limit_exceeded')) return 'limited'
  // Fail closed: this guards LLM spend, and a guard that silently opens on an
  // RPC error is the pattern that has shipped four times already.
  routeLog.error('diagram rate limit rpc failed', { projectId, error: error.message })
  return 'unavailable'
}

async function loadPublication(db: Db, projectId: string) {
  const { data } = await db
    .from('public_repo_diagrams')
    .select('diagram_id, commit_sha, repo_owner, repo_name, repo_private, payload, payload_hash, published_at')
    .eq('project_id', projectId)
    .maybeSingle()
  return data as
    | {
        diagram_id: string | null
        commit_sha: string
        repo_owner: string
        repo_name: string
        repo_private: boolean
        payload: { owner: string; repo: string }
        payload_hash: string
        published_at: string
      }
    | null
}

async function pruneDiagrams(db: Db, projectId: string, keepId: string): Promise<void> {
  const { data } = await db
    .from('project_codebase_diagrams')
    .select('id')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false })
    .range(MAX_DIAGRAMS_PER_PROJECT, MAX_DIAGRAMS_PER_PROJECT + 50)
  const ids = (data ?? []).map((r) => r.id as string).filter((id) => id !== keepId)
  if (ids.length > 0) await db.from('project_codebase_diagrams').delete().in('id', ids)
}

async function publicationView(pub: Awaited<ReturnType<typeof loadPublication>>, latest: DiagramRow | null) {
  if (!pub) return { published: false as const }
  return {
    published: true as const,
    url: publicDiagramUrl(pub.payload.owner, pub.payload.repo),
    commit_sha: pub.commit_sha,
    repo_private: pub.repo_private,
    published_at: pub.published_at,
    /** The page shows something other than the latest diagram (a new commit or a Redraw). */
    outdated: await publicationOutdated(pub, latest),
  }
}

export function registerRepoDiagramRoutes(app: Hono<{ Variables: Variables }>): void {
  const readAuth = adminOrApiKey({ scope: 'mcp:read' })
  const writeAuth = adminOrApiKey({ scope: 'mcp:write' })

  app.get('/v1/admin/projects/:id/codebase/diagram', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)

    const { data, error } = await db
      .from('project_codebase_diagrams')
      .select(DIAGRAM_COLUMNS)
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return dbError(c, error)
    const row = data as DiagramRow | null
    const pub = await loadPublication(db, projectId)
    return c.json({ ok: true, data: { diagram: row, publication: await publicationView(pub, row) } })
  })

  app.post('/v1/admin/projects/:id/codebase/diagram', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed || access.role === 'viewer') {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Viewers cannot generate diagrams' } }, 403)
    }
    const body = (await c.req.json().catch(() => ({}))) as { force?: unknown }
    const force = body.force === true

    const resolved = await resolveConnectedRepo(db, projectId)
    if (!resolved.ok) return c.json({ ok: false, error: { code: resolved.code, message: resolved.message } }, resolved.status)
    const { owner, repo, token } = resolved.repo

    let pinned: { sha: string; ref: string }
    let tree: Awaited<ReturnType<typeof fetchTreeAtSha>>
    try {
      pinned = await resolveCommitSha({ token, owner, repo })
      if (!force) {
        const { data: existing } = await db
          .from('project_codebase_diagrams')
          .select(DIAGRAM_COLUMNS)
          .eq('project_id', projectId)
          .eq('commit_sha', pinned.sha)
          .maybeSingle()
        if (existing) {
          const pub = await loadPublication(db, projectId)
          return c.json({ ok: true, data: { diagram: existing, publication: await publicationView(pub, existing as DiagramRow), reused: true } })
        }
      }
      tree = await fetchTreeAtSha({ token, owner, repo, sha: pinned.sha })
    } catch (err) {
      if (err instanceof RepoDigestError) {
        return c.json({ ok: false, error: { code: err.code, message: err.message } }, err.code === 'REF_NOT_FOUND' ? 404 : 502)
      }
      routeLog.warn('github read failed', { projectId, error: String(err) })
      return c.json({ ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'Could not read the repo from GitHub. Try again in a minute.' } }, 502)
    }

    const claim = await claimDiagramGeneration(db, projectId)
    if (claim === 'limited') {
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: `Up to ${DIAGRAM_GENERATIONS_PER_HOUR} diagrams per hour per project. Try again later.` } }, 429)
    }
    if (claim === 'unavailable') {
      return c.json({ ok: false, error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Diagram generation is paused for a moment. Try again shortly.' } }, 503)
    }

    // Secret-bearing files are already replaced in the digest, so nothing
    // secret reaches the model.
    const digest = await buildRepoDigestFromTree({
      token, owner, repo, pinned, tree,
      options: { budgetTokens: DIAGRAM_DIGEST_BUDGET },
      scopeLabel: 'whole repo (diagram input)',
      deadlineMs: DIAGRAM_DIGEST_DEADLINE_MS,
    })

    const started = Date.now()
    const trace = createTrace('repo-diagram', { projectId, sha: pinned.sha })
    const span = trace.span('generate')
    const userPrompt = buildDiagramUserPrompt(owner, repo, digest.text)
    let usedModel = ASSIST_MODEL
    let fallbackUsed = false
    let raw: z.infer<typeof DiagramLlmSchema>
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    try {
      const { result, usedProvider } = await withAnthropicOrOpenAi(
        db,
        projectId,
        (key) => claudeGenerateObject({
          apiKey: key.key,
          model: ASSIST_MODEL,
          schema: DiagramLlmSchema,
          effort: ASSIST_EFFORT,
          system: DIAGRAM_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
          maxTokens: DIAGRAM_MAX_OUTPUT_TOKENS + THINKING_HEADROOM_TOKENS,
          timeoutMs: DIAGRAM_LLM_TIMEOUT_MS,
        }),
        (key) => {
          usedModel = ASSIST_FALLBACK
          fallbackUsed = true
          const openai = createOpenAI({ apiKey: key.key, baseURL: key.baseUrl })
          return generateValidatedObject(DiagramLlmSchema, {
            model: openai(ASSIST_FALLBACK),
            system: DIAGRAM_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            maxTokens: DIAGRAM_MAX_OUTPUT_TOKENS,
          })
        },
      )
      if (usedProvider === 'openai') { usedModel = ASSIST_FALLBACK; fallbackUsed = true }
      raw = result.object as z.infer<typeof DiagramLlmSchema>
      inputTokens = result.usage?.promptTokens
      outputTokens = result.usage?.completionTokens
      span.end({ model: usedModel, inputTokens, outputTokens, latencyMs: Date.now() - started })
      await trace.end()
      void logLlmInvocation(db, {
        projectId,
        functionName: 'repo-diagram',
        stage: 'repo-diagram',
        primaryModel: ASSIST_MODEL,
        usedModel,
        fallbackUsed,
        fallbackReason: null,
        status: 'success',
        latencyMs: Date.now() - started,
        inputTokens,
        outputTokens,
        langfuseTraceId: trace.id,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      span.end({ model: usedModel, error: msg, latencyMs: Date.now() - started })
      await trace.end().catch(() => {})
      void logLlmInvocation(db, {
        projectId,
        functionName: 'repo-diagram',
        stage: 'repo-diagram',
        primaryModel: ASSIST_MODEL,
        usedModel,
        fallbackUsed,
        fallbackReason: null,
        status: 'error',
        errorMessage: msg,
        latencyMs: Date.now() - started,
        langfuseTraceId: trace.id,
      })
      routeLog.error('diagram llm failed', { projectId, error: msg })
      return c.json({ ok: false, error: { code: 'DIAGRAM_FAILED', message: 'The diagram could not be drawn. Check the AI key on the Settings page, then try again.' } }, 502)
    }

    const { graph, stats } = validateDiagram(raw, treePathSet(tree.entries))
    if (graph.nodes.length === 0) {
      return c.json({ ok: false, error: { code: 'DIAGRAM_EMPTY', message: 'The model returned no components for this repo. Try again.' } }, 502)
    }
    const laidOut = layoutDiagram(graph)
    const now = new Date().toISOString()
    const { data: saved, error: saveErr } = await db
      .from('project_codebase_diagrams')
      .upsert(
        {
          project_id: projectId,
          commit_sha: pinned.sha,
          repo_owner: owner,
          repo_name: repo,
          graph: laidOut,
          stats: { ...stats, input_tokens: inputTokens ?? null, output_tokens: outputTokens ?? null, digest_files: digest.files.length, ref: pinned.ref },
          model: usedModel,
          generated_by: userId,
          updated_at: now,
        },
        { onConflict: 'project_id,commit_sha' },
      )
      .select(DIAGRAM_COLUMNS)
      .single()
    if (saveErr) return dbError(c, saveErr)
    void pruneDiagrams(db, projectId, (saved as DiagramRow).id)

    void emitProductEvent(db, {
      userId,
      eventName: 'repo_diagram_generated',
      surface: 'server',
      properties: { project_id: projectId, nodes: stats.nodes, invalid_paths: stats.invalid_paths.length, forced: force },
    })

    const pub = await loadPublication(db, projectId)
    return c.json({ ok: true, data: { diagram: saved, publication: await publicationView(pub, saved as DiagramRow), reused: false } })
  })

  // What the public page would show for the latest diagram, its hash (the
  // publish call must echo it), and whether GitHub says the repo is private.
  app.get('/v1/admin/projects/:id/codebase/diagram/publish-preview', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, c.get('userId') as string, projectId)
    if (!access.allowed) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)

    const { data } = await db
      .from('project_codebase_diagrams')
      .select(DIAGRAM_COLUMNS)
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const row = data as DiagramRow | null
    if (!row) return c.json({ ok: false, error: { code: 'NO_DIAGRAM', message: 'Generate a diagram first.' } }, 404)

    const resolved = await resolveConnectedRepo(db, projectId)
    if (!resolved.ok) return c.json({ ok: false, error: { code: resolved.code, message: resolved.message } }, resolved.status)
    const vis = await fetchRepoVisibility({ token: resolved.repo.token, owner: row.repo_owner, repo: row.repo_name })
    if (!vis.ok) {
      return c.json({ ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'Could not check whether the repo is public on GitHub.' } }, 502)
    }
    const payload = publicDiagramPayload({ ...row, repo_owner: vis.owner, repo_name: vis.repo })
    return c.json({
      ok: true,
      data: {
        diagram_id: row.id,
        repo_private: vis.private,
        payload,
        payload_hash: await publicPayloadHash(payload),
        url: publicDiagramUrl(vis.owner, vis.repo),
        can_publish: (access.role === 'owner' || access.role === 'admin') && vis.canWrite,
        publish_blocked_reason: !(access.role === 'owner' || access.role === 'admin')
          ? 'Only a project owner or admin can publish.'
          : !vis.canWrite
            ? "Only someone with write access to this repo on GitHub can publish its diagram. The project's GitHub token cannot push to it."
            : null,
      },
    })
  })

  app.post('/v1/admin/projects/:id/codebase/diagram/publish', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only a project owner or admin can publish' } }, 403)
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      diagram_id?: unknown
      payload_hash?: unknown
      confirm_private?: unknown
    }
    if (typeof body.diagram_id !== 'string' || typeof body.payload_hash !== 'string') {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'diagram_id and payload_hash are required' } }, 400)
    }

    const { data } = await db
      .from('project_codebase_diagrams')
      .select(DIAGRAM_COLUMNS)
      .eq('id', body.diagram_id)
      .eq('project_id', projectId)
      .maybeSingle()
    const row = data as DiagramRow | null
    if (!row) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Diagram not found' } }, 404)

    const resolved = await resolveConnectedRepo(db, projectId)
    if (!resolved.ok) return c.json({ ok: false, error: { code: resolved.code, message: resolved.message } }, resolved.status)
    const vis = await fetchRepoVisibility({ token: resolved.repo.token, owner: row.repo_owner, repo: row.repo_name })
    if (!vis.ok) {
      return c.json({ ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'Could not check whether the repo is public on GitHub.' } }, 502)
    }

    const payload = publicDiagramPayload({ ...row, repo_owner: vis.owner, repo_name: vis.repo })
    const hash = await publicPayloadHash(payload)
    const { data: taken } = await db
      .from('public_repo_diagrams')
      .select('project_id')
      .eq('repo_owner', vis.owner.toLowerCase())
      .eq('repo_name', vis.repo.toLowerCase())
      .maybeSingle()
    const decision = decidePublish({
      repoWriteAccess: vis.canWrite,
      previewedHash: body.payload_hash,
      currentHash: hash,
      repoPrivate: vis.private,
      confirmPrivate: body.confirm_private === true,
      publishedByOtherProject: !!taken && taken.project_id !== projectId,
    })
    if (!decision.ok) {
      return c.json({ ok: false, error: { code: decision.code, message: decision.message } }, decision.status)
    }

    const { error } = await db.from('public_repo_diagrams').upsert(
      {
        project_id: projectId,
        diagram_id: row.id,
        commit_sha: row.commit_sha,
        // Lowercase for lookup; the payload keeps GitHub's spelling for display.
        repo_owner: vis.owner.toLowerCase(),
        repo_name: vis.repo.toLowerCase(),
        repo_private: vis.private,
        payload,
        payload_hash: hash,
        published_by: userId,
        published_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    )
    if (error) return dbError(c, error)

    await logAudit(db, projectId, userId, 'settings.updated', 'public_diagram', row.id, {
      action: 'publish',
      commit_sha: row.commit_sha,
      repo_private: vis.private,
    }).catch(() => {})
    void emitProductEvent(db, {
      userId,
      eventName: 'repo_diagram_published',
      surface: 'server',
      properties: { project_id: projectId, repo_private: vis.private },
    })
    return c.json({ ok: true, data: { url: publicDiagramUrl(vis.owner, vis.repo), commit_sha: row.commit_sha } })
  })

  app.delete('/v1/admin/projects/:id/codebase/diagram/publish', jwtAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const access = await callerCanAccessProject(c, db, userId, projectId)
    if (!access.allowed || (access.role !== 'owner' && access.role !== 'admin')) {
      return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only a project owner or admin can unpublish' } }, 403)
    }
    const { error } = await db.from('public_repo_diagrams').delete().eq('project_id', projectId)
    if (error) return dbError(c, error)
    await logAudit(db, projectId, userId, 'settings.updated', 'public_diagram', undefined, { action: 'unpublish' }).catch(() => {})
    return c.json({ ok: true, data: { published: false } })
  })

  app.get('/v1/public/diagrams/:owner/:repo', async (c) => {
    const owner = c.req.param('owner') ?? ''
    const repo = c.req.param('repo') ?? ''
    if (!isValidRepoSlug(owner, repo)) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No public diagram for this repo' } }, 404)
    }
    const db = getServiceClient()
    const ip = extractClientIp(c)
    const limited = await claimIpRateLimit(db, ip, 'public-diagram', PUBLIC_VIEWS_PER_HOUR_PER_IP, '1 hour')
    if (limited) {
      c.header('Retry-After', String(limited.retryAfterSeconds))
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429)
    }

    const { data, error } = await db
      .from('public_repo_diagrams')
      .select('project_id, payload, published_at')
      .eq('repo_owner', owner.toLowerCase())
      .eq('repo_name', repo.toLowerCase())
      .maybeSingle()
    if (error) {
      routeLog.warn('public diagram read failed', { error: error.message })
      return c.json({ ok: false, error: { code: 'UNAVAILABLE', message: 'Try again shortly' } }, 503)
    }
    if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No public diagram for this repo' } }, 404)

    // One view per visitor per day, so reloads do not inflate the count.
    const day = new Date().toISOString().slice(0, 10)
    const visitor = (await sha256HexOf(`${ip}|${day}`)).slice(0, 16)
    void emitProductEvent(db, {
      eventName: 'public_diagram_viewed',
      surface: 'server',
      properties: { project_id: data.project_id as string },
      dedupKey: `public_diagram_viewed:${data.project_id}:${day}:${visitor}`,
    })

    c.header('Cache-Control', 'public, max-age=300')
    return c.json({ ok: true, data: { ...(data.payload as Record<string, unknown>), published_at: data.published_at } })
  })
}
