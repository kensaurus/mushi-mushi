/**
 * Codebase Understand routes — chat-with-repo, lazy summaries, guided tour,
 * domain view, and diff-impact analysis. Grounded on project_codebase_files +
 * match_codebase_files; LLM via BYOK + Langfuse.
 */

import type { Context, Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { streamSSE } from 'npm:hono@4/streaming'
import { createAnthropic } from 'npm:@ai-sdk/anthropic@1'
import { createOpenAI } from 'npm:@ai-sdk/openai@1'
import { generateText, streamText } from 'npm:ai@4'
import { z } from 'npm:zod@3'

import { getServiceClient } from '../../_shared/db.ts'
import { log } from '../../_shared/logger.ts'
import { adminOrApiKey } from '../../_shared/auth.ts'
import { toSseEvent } from '../../_shared/sse.ts'
import { createTrace } from '../../_shared/observability.ts'
import { ASSIST_MODEL, ASSIST_FALLBACK } from '../../_shared/models.ts'
import { estimateCallCostUsd } from '../../_shared/pricing.ts'
import { logLlmInvocation, extractAnthropicCacheUsage } from '../../_shared/telemetry.ts'
import { withAnthropicOrOpenAi, LlmFailoverError } from '../../_shared/llm-failover.ts'
import { resolveLlmKey } from '../../_shared/byok.ts'
import {
  buildCodebaseChatSystemPrompt,
  buildSummaryPrompt,
  computeImportImpact,
  getIndexFingerprint,
  hitsToCitations,
  isSummaryStale,
  loadExploreGraph,
  orderTourStops,
  retrieveCodeForQuestion,
  detectExploreLayer,
  getProjectCodebaseScope,
  type DomainView,
  type ExploreGraphNode,
} from '../../_shared/codebase-understand.ts'
import { resolveImpactChangedPaths } from '../../_shared/codebase-impact-resolve.ts'
import { enqueueCodebaseAnalyzeJob, runCodebaseAnalyzeJob } from '../../_shared/codebase-analyze-runner.ts'
import { dbError, userCanAccessProject } from '../shared.ts'

const routeLog = log.child('codebase-understand')

function deriveThreadTitle(firstUserMessage: string): string {
  const t = firstUserMessage.replace(/\s+/g, ' ').trim()
  return t.slice(0, 120) || 'Untitled chat'
}

async function upsertCodebaseChatThread(
  db: ReturnType<typeof getServiceClient>,
  opts: { threadId: string; projectId: string; userId: string; firstUserContent?: string },
) {
  const now = new Date().toISOString()
  const { data: existing } = await db
    .from('codebase_chat_threads')
    .select('title')
    .eq('id', opts.threadId)
    .maybeSingle()

  const patch: Record<string, unknown> = {
    id: opts.threadId,
    project_id: opts.projectId,
    user_id: opts.userId,
    updated_at: now,
  }
  if (!existing?.title && opts.firstUserContent) {
    patch.title = deriveThreadTitle(opts.firstUserContent)
  }
  await db.from('codebase_chat_threads').upsert(patch, { onConflict: 'id' })
}

async function assertProjectAccess(c: Context, projectId: string, userId: string) {
  const db = getServiceClient()
  const access = await userCanAccessProject(db, userId, projectId)
  if (!access.allowed) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } }, 403)
  }
  return null
}

async function assertIndexEnabled(c: Context, projectId: string) {
  const db = getServiceClient()
  const { data: settings } = await db
    .from('project_settings')
    .select('codebase_index_enabled')
    .eq('project_id', projectId)
    .maybeSingle()
  if (!settings?.codebase_index_enabled) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'INDEX_DISABLED',
          message: 'Codebase indexing is not enabled. Turn it on in Settings or Connect.',
        },
      },
      400,
    )
  }
  return null
}

async function assertLlmAvailable(c: Context, projectId: string) {
  const db = getServiceClient()
  const anthropic = await resolveLlmKey(db, projectId, 'anthropic')
  const openai = await resolveLlmKey(db, projectId, 'openai')
  if (!anthropic && !openai) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'NO_LLM_KEY',
          message: 'Add an Anthropic or OpenAI key in Settings → API Keys to use codebase Q&A.',
        },
      },
      503,
    )
  }
  return null
}

async function claimCodebaseChatRateLimit(userId: string): Promise<Response | null> {
  const db = getServiceClient()
  const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: userId,
    p_scope: 'codebase_chat',
    p_max_per_window: 120,
    p_window: '1 hour',
  })
  if (!rateErr) return null
  if ((rateErr.message ?? '').includes('rate_limit_exceeded')) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Codebase chat hourly limit reached (120/hour).' },
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    )
  }
  routeLog.warn('codebase chat rate limit RPC failed', { error: rateErr.message })
  return null
}

const DomainsSchema = z.object({
  domains: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      flows: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          steps: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              description: z.string(),
              file_paths: z.array(z.string()),
            }),
          ),
        }),
      ),
    }),
  ),
})

export function registerCodebaseUnderstandRoutes(app: Hono<{ Variables: Variables }>): void {
  const readAuth = adminOrApiKey({ scope: 'mcp:read' })
  const writeAuth = adminOrApiKey({ scope: 'mcp:write' })

  // ── POST /codebase/chat (non-stream) ─────────────────────────────────────
  app.post('/v1/admin/projects/:id/codebase/chat', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const indexErr = await assertIndexEnabled(c, projectId)
    if (indexErr) return indexErr
    const llmErr = await assertLlmAvailable(c, projectId)
    if (llmErr) return llmErr

    const rateBlocked = await claimCodebaseChatRateLimit(userId)
    if (rateBlocked) return rateBlocked

    const body = (await c.req.json().catch(() => null)) as {
      threadId?: string
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      fileFocus?: { file_path: string; symbol_name?: string | null }
    } | null
    if (!body?.messages?.length) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'messages required' } }, 400)
    }

    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser?.content?.trim()) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'user message required' } }, 400)
    }

    const threadId =
      typeof body.threadId === 'string' && /^[0-9a-f-]{36}$/i.test(body.threadId)
        ? body.threadId
        : crypto.randomUUID()

    const db = getServiceClient()
    const { data: project } = await db.from('projects').select('name').eq('id', projectId).maybeSingle()

    const retrieval = await retrieveCodeForQuestion(db, projectId, lastUser.content, 12)
    const citations = hitsToCitations(retrieval.files)
    const codeContext = retrieval.files.length
      ? retrieval.files
          .map((f) => {
            const head = f.symbolName
              ? `--- ${f.filePath}:${f.lineStart ?? '?'} :: ${f.symbolName} ---`
              : `--- ${f.filePath} ---`
            return `${head}\n${f.signature ? `${f.signature}\n` : ''}${f.preview}`
          })
          .join('\n\n')
      : ''

    const systemPrompt = buildCodebaseChatSystemPrompt({
      projectName: project?.name ?? null,
      codeContext,
      citations,
      fileFocus: body.fileFocus ?? null,
    })

    const trace = createTrace('codebase-chat', { projectId, threadId })
    const llmSpan = trace.span('codebase-chat.generate')
    const started = Date.now()
    let usedModel = ASSIST_MODEL
    let keySource: 'byok' | 'env' = 'env'
    let inputTokens: number | undefined
    let outputTokens: number | undefined

    try {
      const { result, usedProvider } = await withAnthropicOrOpenAi(
        db,
        projectId,
        async (key) => {
          keySource = key.source
          const anthropic = createAnthropic({ apiKey: key.key })
          return generateText({
            model: anthropic(ASSIST_MODEL),
            messages: [
              {
                role: 'system',
                content: systemPrompt,
                experimental_providerMetadata: {
                  anthropic: { cacheControl: { type: 'ephemeral' } },
                },
              },
              ...body.messages!.slice(-10).map((m) => ({ role: m.role, content: m.content })),
            ],
            maxTokens: 900,
          })
        },
        async (key) => {
          keySource = key.source
          const openai = createOpenAI({
            apiKey: key.key,
            ...(key.baseUrl ? { baseURL: key.baseUrl } : {}),
          })
          usedModel = ASSIST_FALLBACK
          return generateText({
            model: openai(ASSIST_FALLBACK),
            system: systemPrompt,
            messages: body.messages!.slice(-10).map((m) => ({ role: m.role, content: m.content })),
            maxTokens: 900,
          })
        },
      )
      usedModel = usedProvider === 'openai' ? ASSIST_FALLBACK : ASSIST_MODEL
      inputTokens = result.usage?.promptTokens
      outputTokens = result.usage?.completionTokens
      const cache = extractAnthropicCacheUsage(result.experimental_providerMetadata)
      llmSpan.end({
        model: usedModel,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - started,
      })

      const answer = result.text.trim()
      const latencyMs = Date.now() - started
      const costUsd = estimateCallCostUsd(usedModel, inputTokens ?? 0, outputTokens ?? 0)

      await upsertCodebaseChatThread(db, {
        threadId,
        projectId,
        userId,
        firstUserContent: lastUser.content,
      })
      await db.from('codebase_chat_messages').insert([
        {
          thread_id: threadId,
          project_id: projectId,
          user_id: userId,
          role: 'user',
          content: lastUser.content,
        },
        {
          thread_id: threadId,
          project_id: projectId,
          user_id: userId,
          role: 'assistant',
          content: answer,
          citations,
          model: usedModel,
          input_tokens: inputTokens ?? null,
          output_tokens: outputTokens ?? null,
          cost_usd: costUsd,
          latency_ms: latencyMs,
          langfuse_trace_id: trace.id,
        },
      ])

      void logLlmInvocation(db, {
        projectId,
        functionName: 'codebase-chat',
        stage: 'codebase-chat',
        primaryModel: ASSIST_MODEL,
        usedModel,
        fallbackUsed: usedProvider === 'openai',
        status: 'success',
        latencyMs,
        inputTokens,
        outputTokens,
        keySource,
        langfuseTraceId: trace.id,
      })
      await trace.end()

      return c.json({
        ok: true,
        data: { threadId, answer, citations, model: usedModel, latencyMs, costUsd },
      })
    } catch (err) {
      llmSpan.end({ model: usedModel, latencyMs: Date.now() - started, error: String(err) })
      await trace.end()
      if (err instanceof LlmFailoverError) {
        return c.json(
          { ok: false, error: { code: 'NO_LLM_KEY', message: err.message } },
          503,
        )
      }
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ ok: false, error: { code: 'LLM_ERROR', message: msg } }, 500)
    }
  })

  // ── POST /codebase/chat/stream ───────────────────────────────────────────
  app.post('/v1/admin/projects/:id/codebase/chat/stream', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const indexErr = await assertIndexEnabled(c, projectId)
    if (indexErr) return indexErr
    const llmErr = await assertLlmAvailable(c, projectId)
    if (llmErr) return llmErr

    const rateBlocked = await claimCodebaseChatRateLimit(userId)
    if (rateBlocked) return rateBlocked

    const body = (await c.req.json().catch(() => null)) as {
      threadId?: string
      messages?: Array<{ role: 'user' | 'assistant'; content: string }>
      fileFocus?: { file_path: string; symbol_name?: string | null }
    } | null
    if (!body?.messages?.length) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'messages required' } }, 400)
    }

    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')
    if (!lastUser?.content?.trim()) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'user message required' } }, 400)
    }

    const threadId =
      typeof body.threadId === 'string' && /^[0-9a-f-]{36}$/i.test(body.threadId)
        ? body.threadId
        : crypto.randomUUID()

    const db = getServiceClient()
    const { data: project } = await db.from('projects').select('name').eq('id', projectId).maybeSingle()
    const retrieval = await retrieveCodeForQuestion(db, projectId, lastUser.content, 12)
    const citations = hitsToCitations(retrieval.files)
    const codeContext = retrieval.files.length
      ? retrieval.files
          .map((f) => {
            const head = f.symbolName
              ? `--- ${f.filePath}:${f.lineStart ?? '?'} :: ${f.symbolName} ---`
              : `--- ${f.filePath} ---`
            return `${head}\n${f.signature ? `${f.signature}\n` : ''}${f.preview}`
          })
          .join('\n\n')
      : ''

    const systemPrompt = buildCodebaseChatSystemPrompt({
      projectName: project?.name ?? null,
      codeContext,
      citations,
      fileFocus: body.fileFocus ?? null,
    })

    return streamSSE(c, async (stream) => {
      const trace = createTrace('codebase-chat-stream', { projectId, threadId })
      const started = Date.now()
      let acc = ''
      let usedModel = ASSIST_MODEL
      let keySource: 'byok' | 'env' = 'env'
      let inputTokens: number | undefined
      let outputTokens: number | undefined

      await stream.write(toSseEvent({ threadId, citations }, { event: 'start' }))

      try {
        const { result, usedProvider } = await withAnthropicOrOpenAi(
          db,
          projectId,
          async (key) => {
            keySource = key.source
            const anthropic = createAnthropic({ apiKey: key.key })
            return streamText({
              model: anthropic(ASSIST_MODEL),
              messages: [
                {
                  role: 'system',
                  content: systemPrompt,
                  experimental_providerMetadata: {
                    anthropic: { cacheControl: { type: 'ephemeral' } },
                  },
                },
                ...body.messages!.slice(-10).map((m) => ({ role: m.role, content: m.content })),
              ],
              maxTokens: 900,
            })
          },
          async (key) => {
            keySource = key.source
            usedModel = ASSIST_FALLBACK
            const openai = createOpenAI({
              apiKey: key.key,
              ...(key.baseUrl ? { baseURL: key.baseUrl } : {}),
            })
            return streamText({
              model: openai(ASSIST_FALLBACK),
              system: systemPrompt,
              messages: body.messages!.slice(-10).map((m) => ({ role: m.role, content: m.content })),
              maxTokens: 900,
            })
          },
        )
        usedModel = usedProvider === 'openai' ? ASSIST_FALLBACK : ASSIST_MODEL
        for await (const delta of result.textStream) {
          acc += delta
          await stream.write(toSseEvent({ delta }, { event: 'delta' }))
        }
        const usage = await result.usage
        inputTokens = usage?.promptTokens
        outputTokens = usage?.completionTokens

        const latencyMs = Date.now() - started
        const costUsd = estimateCallCostUsd(usedModel, inputTokens ?? 0, outputTokens ?? 0)

        await upsertCodebaseChatThread(db, {
          threadId,
          projectId,
          userId,
          firstUserContent: lastUser.content,
        })
        await db.from('codebase_chat_messages').insert([
          { thread_id: threadId, project_id: projectId, user_id: userId, role: 'user', content: lastUser.content },
          {
            thread_id: threadId,
            project_id: projectId,
            user_id: userId,
            role: 'assistant',
            content: acc,
            citations,
            model: usedModel,
            input_tokens: inputTokens ?? null,
            output_tokens: outputTokens ?? null,
            cost_usd: costUsd,
            latency_ms: latencyMs,
            langfuse_trace_id: trace.id,
          },
        ])

        void logLlmInvocation(db, {
          projectId,
          functionName: 'codebase-chat',
          stage: 'codebase-chat-stream',
          primaryModel: ASSIST_MODEL,
          usedModel,
          fallbackUsed: usedProvider === 'openai',
          status: 'success',
          latencyMs,
          inputTokens,
          outputTokens,
          keySource,
          langfuseTraceId: trace.id,
        })
        await trace.end()

        await stream.write(
          toSseEvent(
            {
              threadId,
              model: usedModel,
              citations,
              latencyMs,
              costUsd,
              inputTokens,
              outputTokens,
              keySource,
            },
            { event: 'meta' },
          ),
        )
        await stream.write(toSseEvent({ done: true }, { event: 'done' }))
      } catch (err) {
        await trace.end()
        const code = err instanceof LlmFailoverError ? 'NO_LLM_KEY' : 'LLM_ERROR'
        await stream.write(
          toSseEvent(
            { code, message: err instanceof Error ? err.message : String(err) },
            { event: 'error' },
          ),
        )
      }
    })
  })

  // ── GET/POST /codebase/summary ───────────────────────────────────────────
  async function handleSummary(
    c: Context,
    projectId: string,
    userId: string,
    opts: { force?: boolean; filePath?: string; symbolName?: string | null } = {},
  ) {
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const indexErr = await assertIndexEnabled(c, projectId)
    if (indexErr) return indexErr

    const filePath = opts.filePath ?? c.req.query('file_path')
    const symbolName = opts.symbolName ?? c.req.query('symbol_name') ?? null
    const force = opts.force ?? false
    if (!filePath || typeof filePath !== 'string') {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'file_path required' } }, 400)
    }

    const db = getServiceClient()
    let q = db
      .from('project_codebase_files')
      .select('content_preview, content_hash, signature, file_path, symbol_name')
      .eq('project_id', projectId)
      .eq('file_path', filePath)
      .is('tombstoned_at', null)
    if (symbolName) q = q.eq('symbol_name', symbolName)
    else q = q.is('symbol_name', null)

    const { data: row, error: rowErr } = await q.maybeSingle()
    if (rowErr) return dbError(c, rowErr)
    if (!row) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'File not indexed' } }, 404)
    }

    const sym = symbolName ? String(symbolName) : null
    const { data: cached } = await db
      .from('project_codebase_summaries')
      .select('summary, model, content_hash, updated_at')
      .eq('project_id', projectId)
      .eq('file_path', filePath)
      .is('symbol_name', sym)
      .maybeSingle()

    if (cached && !force && !isSummaryStale(cached.content_hash, row.content_hash)) {
      return c.json({
        ok: true,
        data: { summary: cached.summary, model: cached.model, cached: true, updated_at: cached.updated_at },
      })
    }

    const llmErr = await assertLlmAvailable(c, projectId)
    if (llmErr) return llmErr

    const layer = detectExploreLayer(filePath)
    const prompt = buildSummaryPrompt({
      file_path: filePath,
      symbol_name: sym,
      signature: row.signature ?? null,
      layer,
      content: row.content_preview ?? '',
    })

    const trace = createTrace('codebase-summary', { projectId, filePath })
    const started = Date.now()
    let usedModel = ASSIST_MODEL
    let keySource: 'byok' | 'env' = 'env'

    try {
      const { result, usedProvider } = await withAnthropicOrOpenAi(
        db,
        projectId,
        async (key) => {
          keySource = key.source
          const anthropic = createAnthropic({ apiKey: key.key })
          return generateText({
            model: anthropic(ASSIST_MODEL),
            prompt,
            maxTokens: 400,
          })
        },
        async (key) => {
          keySource = key.source
          usedModel = ASSIST_FALLBACK
          const openai = createOpenAI({
            apiKey: key.key,
            ...(key.baseUrl ? { baseURL: key.baseUrl } : {}),
          })
          return generateText({
            model: openai(ASSIST_FALLBACK),
            prompt,
            maxTokens: 400,
          })
        },
      )
      usedModel = usedProvider === 'openai' ? ASSIST_FALLBACK : ASSIST_MODEL
      const summary = result.text.trim()
      const latencyMs = Date.now() - started

      await db.from('project_codebase_summaries').upsert(
        {
          project_id: projectId,
          file_path: filePath,
          symbol_name: sym,
          summary,
          model: usedModel,
          content_hash: row.content_hash,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,file_path,symbol_name' },
      )

      void logLlmInvocation(db, {
        projectId,
        functionName: 'codebase-summary',
        stage: 'summary',
        primaryModel: ASSIST_MODEL,
        usedModel,
        fallbackUsed: usedProvider === 'openai',
        status: 'success',
        latencyMs,
        inputTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.completionTokens,
        keySource,
        langfuseTraceId: trace.id,
      })
      await trace.end()

      return c.json({
        ok: true,
        data: { summary, model: usedModel, cached: false, updated_at: new Date().toISOString() },
      })
    } catch (err) {
      await trace.end()
      if (err instanceof LlmFailoverError) {
        return c.json({ ok: false, error: { code: 'NO_LLM_KEY', message: err.message } }, 503)
      }
      return c.json(
        { ok: false, error: { code: 'LLM_ERROR', message: err instanceof Error ? err.message : String(err) } },
        500,
      )
    }
  }

  app.get('/v1/admin/projects/:id/codebase/summary', readAuth, async (c) => {
    return handleSummary(c, c.req.param('id')!, c.get('userId') as string, {
      force: c.req.query('force') === '1',
    })
  })

  app.post('/v1/admin/projects/:id/codebase/summary', writeAuth, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      file_path?: string
      symbol_name?: string | null
    }
    return handleSummary(c, c.req.param('id')!, c.get('userId') as string, {
      force: true,
      filePath: body.file_path,
      symbolName: body.symbol_name ?? null,
    })
  })

  // ── GET /codebase/tour ───────────────────────────────────────────────────
  app.get('/v1/admin/projects/:id/codebase/tour', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const indexErr = await assertIndexEnabled(c, projectId)
    if (indexErr) return indexErr

    const db = getServiceClient()
    const fingerprint = await getIndexFingerprint(db, projectId)
    const force = c.req.query('force') === '1'

    if (!force) {
      const { data: cached } = await db
        .from('project_codebase_tours')
        .select('stops, updated_at, index_fingerprint')
        .eq('project_id', projectId)
        .maybeSingle()
      if (cached && cached.index_fingerprint === fingerprint) {
        return c.json({ ok: true, data: { stops: cached.stops, cached: true, updated_at: cached.updated_at } })
      }
    }

    const { nodes, edges } = await loadExploreGraph(db, projectId)
    let stops = orderTourStops(nodes, edges, 10)

    const llmErr = await assertLlmAvailable(c, projectId)
    if (!llmErr && stops.length > 0) {
      try {
        const trace = createTrace('codebase-tour', { projectId })
        const started = Date.now()
        let usedModel = ASSIST_MODEL
        let keySource: 'byok' | 'env' = 'env'
        const tourContext = stops
          .map((s) => `${s.order}. ${s.title} (${s.layer}): ${s.file_paths.join(', ')}`)
          .join('\n')
        const { result, usedProvider } = await withAnthropicOrOpenAi(
          db,
          projectId,
          async (key) => {
            keySource = key.source
            const anthropic = createAnthropic({ apiKey: key.key })
            return generateText({
              model: anthropic(ASSIST_MODEL),
              prompt: `Improve these guided-tour stop rationales for onboarding a new developer. Keep the same order. Return JSON array of {order, rationale} only.\n\n${tourContext}`,
              maxTokens: 800,
            })
          },
          async (key) => {
            keySource = key.source
            usedModel = ASSIST_FALLBACK
            const openai = createOpenAI({ apiKey: key.key, ...(key.baseUrl ? { baseURL: key.baseUrl } : {}) })
            return generateText({
              model: openai(ASSIST_FALLBACK),
              prompt: `Improve these guided-tour stop rationales for onboarding a new developer. Keep the same order. Return JSON array of {order, rationale} only.\n\n${tourContext}`,
              maxTokens: 800,
            })
          },
        )
        usedModel = usedProvider === 'openai' ? ASSIST_FALLBACK : ASSIST_MODEL
        const latencyMs = Date.now() - started
        void logLlmInvocation(db, {
          projectId,
          functionName: 'codebase-tour',
          stage: 'tour',
          primaryModel: ASSIST_MODEL,
          usedModel,
          fallbackUsed: usedProvider === 'openai',
          status: 'success',
          latencyMs,
          inputTokens: result.usage?.promptTokens,
          outputTokens: result.usage?.completionTokens,
          keySource,
          langfuseTraceId: trace.id,
        })
        await trace.end()
        try {
          const parsed = JSON.parse(result.text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as Array<{
            order: number
            rationale: string
          }>
          stops = stops.map((s) => {
            const hit = parsed.find((p) => p.order === s.order)
            return hit?.rationale ? { ...s, rationale: hit.rationale } : s
          })
        } catch {
          /* keep deterministic rationales */
        }
      } catch {
        /* LLM polish optional */
      }
    }

    await db.from('project_codebase_tours').upsert(
      {
        project_id: projectId,
        index_fingerprint: fingerprint,
        stops,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    )

    return c.json({ ok: true, data: { stops, cached: false, updated_at: new Date().toISOString() } })
  })

  // ── GET /codebase/domains ────────────────────────────────────────────────
  app.get('/v1/admin/projects/:id/codebase/domains', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const indexErr = await assertIndexEnabled(c, projectId)
    if (indexErr) return indexErr

    const db = getServiceClient()
    const fingerprint = await getIndexFingerprint(db, projectId)
    const force = c.req.query('force') === '1'

    if (!force) {
      const { data: cached } = await db
        .from('project_codebase_domains')
        .select('domains, updated_at, index_fingerprint')
        .eq('project_id', projectId)
        .maybeSingle()
      if (cached && cached.index_fingerprint === fingerprint) {
        const domains = (cached.domains ?? []) as DomainView[]
        return c.json({
          ok: true,
          data: {
            domains,
            source: inferDomainSource(domains),
            cached: true,
            updated_at: cached.updated_at,
          },
        })
      }
    }

    const { nodes } = await loadExploreGraph(db, projectId)
    const fileList = nodes
      .slice(0, 80)
      .map((n) => `- ${n.metadata.file_path} (${n.metadata.layer})`)
      .join('\n')

    let domains: DomainView[] = []
    let domainSource: 'llm' | 'fallback' = 'llm'

    const llmErr = await assertLlmAvailable(c, projectId)
    if (llmErr) return llmErr

    try {
      const trace = createTrace('codebase-domains', { projectId })
      const started = Date.now()
      let usedModel = ASSIST_MODEL
      let keySource: 'byok' | 'env' = 'env'
      const { result, usedProvider } = await withAnthropicOrOpenAi(
        db,
        projectId,
        async (key) => {
          keySource = key.source
          const anthropic = createAnthropic({ apiKey: key.key })
          return generateText({
            model: anthropic(ASSIST_MODEL),
            prompt: `From this indexed file list, extract business domains, user flows, and steps. Return JSON matching {domains:[{id,name,description,flows:[{id,name,description,steps:[{id,name,description,file_paths[]}]}]}]}.\n\nFiles:\n${fileList}`,
            maxTokens: 1200,
          })
        },
        async (key) => {
          keySource = key.source
          usedModel = ASSIST_FALLBACK
          const openai = createOpenAI({ apiKey: key.key, ...(key.baseUrl ? { baseURL: key.baseUrl } : {}) })
          return generateText({
            model: openai(ASSIST_FALLBACK),
            prompt: `From this indexed file list, extract business domains, user flows, and steps. Return JSON matching {domains:[{id,name,description,flows:[{id,name,description,steps:[{id,name,description,file_paths[]}]}]}]}.\n\nFiles:\n${fileList}`,
            maxTokens: 1200,
          })
        },
      )
      usedModel = usedProvider === 'openai' ? ASSIST_FALLBACK : ASSIST_MODEL
      const latencyMs = Date.now() - started
      void logLlmInvocation(db, {
        projectId,
        functionName: 'codebase-domains',
        stage: 'domains',
        primaryModel: ASSIST_MODEL,
        usedModel,
        fallbackUsed: usedProvider === 'openai',
        status: 'success',
        latencyMs,
        inputTokens: result.usage?.promptTokens,
        outputTokens: result.usage?.completionTokens,
        keySource,
        langfuseTraceId: trace.id,
      })
      await trace.end()
      const jsonMatch = result.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = DomainsSchema.safeParse(JSON.parse(jsonMatch[0]))
        if (parsed.success) domains = parsed.data.domains as DomainView[]
      }
    } catch (err) {
      if (err instanceof LlmFailoverError) {
        return c.json({ ok: false, error: { code: 'NO_LLM_KEY', message: err.message } }, 503)
      }
      routeLog.warn('domain extraction failed', { err: String(err) })
    }

    if (domains.length === 0) {
      domains = fallbackDomainsFromLayers(nodes)
      domainSource = 'fallback'
    }

    await db.from('project_codebase_domains').upsert(
      {
        project_id: projectId,
        index_fingerprint: fingerprint,
        domains,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id' },
    )

    return c.json({
      ok: true,
      data: { domains, source: domainSource, cached: false, updated_at: new Date().toISOString() },
    })
  })

  // ── POST /codebase/analyze ───────────────────────────────────────────────
  app.post('/v1/admin/projects/:id/codebase/analyze', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const indexErr = await assertIndexEnabled(c, projectId)
    if (indexErr) return indexErr

    const body = (await c.req.json().catch(() => ({}))) as { changed_paths?: string[] }
    const db = getServiceClient()
    const { jobId } = await enqueueCodebaseAnalyzeJob(db, {
      projectId,
      requestedBy: userId,
      trigger: 'manual',
      changedPaths: body.changed_paths,
    })

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (supabaseUrl && serviceKey) {
      fetch(`${supabaseUrl}/functions/v1/codebase-analyze-worker`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobId }),
      }).catch((err) => routeLog.warn('analyze worker invoke failed', { err: String(err) }))
    } else {
      void runCodebaseAnalyzeJob(db, jobId)
    }

    return c.json({ ok: true, data: { job_id: jobId, status: 'queued' } })
  })

  app.get('/v1/admin/projects/:id/codebase/analyze/:jobId', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const jobId = c.req.param('jobId')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const db = getServiceClient()
    const { data, error } = await db
      .from('codebase_analyze_jobs')
      .select('id, status, trigger, changed_paths, plan, error, started_at, finished_at, created_at')
      .eq('id', jobId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) return dbError(c, error)
    if (!data) return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Job not found' } }, 404)
    return c.json({ ok: true, data })
  })

  // ── Codebase index settings (scope / output language) ────────────────────
  app.get('/v1/admin/projects/:id/codebase/settings', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const scope = await getProjectCodebaseScope(getServiceClient(), projectId)
    return c.json({
      ok: true,
      data: {
        scope_paths: scope.scope_paths,
        exclude_globs: scope.exclude_globs,
        output_language: scope.output_language,
      },
    })
  })

  app.patch('/v1/admin/projects/:id/codebase/settings', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const body = (await c.req.json().catch(() => null)) as {
      scope_paths?: string[] | null
      exclude_globs?: string[] | null
      output_language?: string
    } | null

    const db = getServiceClient()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body && 'scope_paths' in body) patch.codebase_index_scope_paths = body.scope_paths
    if (body && 'exclude_globs' in body) patch.codebase_index_exclude_globs = body.exclude_globs
    if (body?.output_language?.trim()) patch.codebase_output_language = body.output_language.trim()

    const { error } = await db.from('project_settings').upsert(
      { project_id: projectId, ...patch },
      { onConflict: 'project_id' },
    )
    if (error) return dbError(c, error)

    const scope = await getProjectCodebaseScope(db, projectId)
    return c.json({
      ok: true,
      data: {
        scope_paths: scope.scope_paths,
        exclude_globs: scope.exclude_globs,
        output_language: scope.output_language,
      },
    })
  })

  // ── Wiki / knowledge sources ─────────────────────────────────────────────
  app.get('/v1/admin/projects/:id/codebase/wiki/sources', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const db = getServiceClient()
    const { data, error } = await db
      .from('project_codebase_wiki_sources')
      .select('id, kind, root_path, label, status, error, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { sources: data ?? [] } })
  })

  app.post('/v1/admin/projects/:id/codebase/wiki/sources', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const body = (await c.req.json().catch(() => null)) as {
      kind?: 'repo_subpath' | 'upload' | 'url'
      root_path?: string
      label?: string
    } | null
    if (!body?.kind || !body.root_path?.trim()) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'kind and root_path required' } }, 400)
    }

    const db = getServiceClient()
    const { data, error } = await db
      .from('project_codebase_wiki_sources')
      .insert({
        project_id: projectId,
        kind: body.kind,
        root_path: body.root_path.trim(),
        label: body.label?.trim() ?? null,
        status: 'pending',
      })
      .select('id, kind, root_path, label, status')
      .single()
    if (error) return dbError(c, error)

    const { jobId } = await enqueueCodebaseAnalyzeJob(db, {
      projectId,
      requestedBy: userId,
      trigger: 'wiki_ingest',
      changedPaths: [body.root_path.trim()],
    })

    return c.json({ ok: true, data: { source: data, analyze_job_id: jobId } })
  })

  app.get('/v1/admin/projects/:id/codebase/knowledge/graph', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden
    const db = getServiceClient()
    const { data, error } = await db
      .from('project_codebase_knowledge_graph')
      .select('id, source_id, graph, index_fingerprint, updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(5)
    if (error) return dbError(c, error)
    return c.json({ ok: true, data: { graphs: data ?? [] } })
  })

  // ── GET /codebase/chat/threads ───────────────────────────────────────────
  app.get('/v1/admin/projects/:id/codebase/chat/threads', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const db = getServiceClient()
    const limit = Math.min(Number(c.req.query('limit') ?? 30), 50)
    const { data: threads, error } = await db
      .from('codebase_chat_threads')
      .select('id, title, created_at, updated_at')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) return dbError(c, error)

    const threadIds = (threads ?? []).map((t) => t.id)
    const previews = new Map<string, string>()
    if (threadIds.length > 0) {
      const { data: msgs } = await db
        .from('codebase_chat_messages')
        .select('thread_id, content, role, created_at')
        .in('thread_id', threadIds)
        .order('created_at', { ascending: false })
      for (const m of msgs ?? []) {
        if (!previews.has(m.thread_id) && m.role === 'user') {
          previews.set(m.thread_id, String(m.content).slice(0, 120))
        }
      }
    }

    return c.json({
      ok: true,
      data: {
        threads: (threads ?? []).map((t) => ({
          ...t,
          preview: previews.get(t.id) ?? t.title ?? null,
        })),
      },
    })
  })

  // ── GET /codebase/chat/threads/:threadId/messages ────────────────────────
  app.get('/v1/admin/projects/:id/codebase/chat/threads/:threadId/messages', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const threadId = c.req.param('threadId')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const db = getServiceClient()
    const { data: thread, error: threadErr } = await db
      .from('codebase_chat_threads')
      .select('id, title, created_at, updated_at')
      .eq('id', threadId)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle()

    if (threadErr) return dbError(c, threadErr)
    if (!thread) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Thread not found' } }, 404)
    }

    const { data: messages, error: msgErr } = await db
      .from('codebase_chat_messages')
      .select(
        'id, role, content, citations, model, input_tokens, output_tokens, cost_usd, latency_ms, created_at',
      )
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })

    if (msgErr) return dbError(c, msgErr)

    return c.json({
      ok: true,
      data: {
        thread,
        messages: messages ?? [],
      },
    })
  })

  // ── PATCH /codebase/chat/threads/:threadId ───────────────────────────────
  app.patch('/v1/admin/projects/:id/codebase/chat/threads/:threadId', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const threadId = c.req.param('threadId')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const body = (await c.req.json().catch(() => null)) as { title?: string } | null
    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''
    if (!title) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'title required' } }, 400)
    }

    const db = getServiceClient()
    const { data: thread, error: findErr } = await db
      .from('codebase_chat_threads')
      .select('id')
      .eq('id', threadId)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle()

    if (findErr) return dbError(c, findErr)
    if (!thread) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Thread not found' } }, 404)
    }

    const { error: updErr } = await db
      .from('codebase_chat_threads')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', threadId)

    if (updErr) return dbError(c, updErr)
    return c.json({ ok: true, data: { id: threadId, title } })
  })

  // ── DELETE /codebase/chat/threads/:threadId ──────────────────────────────
  app.delete('/v1/admin/projects/:id/codebase/chat/threads/:threadId', writeAuth, async (c) => {
    const projectId = c.req.param('id')!
    const threadId = c.req.param('threadId')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const db = getServiceClient()
    const { data: thread, error: findErr } = await db
      .from('codebase_chat_threads')
      .select('id')
      .eq('id', threadId)
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle()

    if (findErr) return dbError(c, findErr)
    if (!thread) {
      return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Thread not found' } }, 404)
    }

    const { error: delErr } = await db.from('codebase_chat_threads').delete().eq('id', threadId)
    if (delErr) return dbError(c, delErr)
    return c.json({ ok: true, data: { id: threadId, deleted: true } })
  })

  // ── GET /codebase/impact ─────────────────────────────────────────────────
  app.get('/v1/admin/projects/:id/codebase/impact', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const pathsParam = c.req.query('paths') ?? ''
    const ref = c.req.query('ref') ?? undefined
    const compare = c.req.query('compare') ?? undefined
    const fixId = c.req.query('fix_id') ?? undefined

    const hasAuto =
      ref != null ||
      compare != null ||
      fixId != null ||
      (pathsParam.trim() === '' && c.req.query('source') === 'last_push')

    const resolved = await resolveImpactChangedPaths(getServiceClient(), projectId, {
      pathsParam: pathsParam.trim() ? pathsParam : undefined,
      ref: hasAuto && !compare && !fixId && !pathsParam.trim() ? (ref ?? 'last_push') : ref,
      compare,
      fixId,
    })

    if (!resolved.ok) {
      const status =
        resolved.code === 'NOT_FOUND' ? 404 :
        resolved.code === 'BAD_REQUEST' ? 400 : 400
      return c.json({ ok: false, error: { code: resolved.code, message: resolved.message } }, status)
    }

    if (resolved.data.changed_paths.length === 0) {
      return c.json({
        ok: true,
        data: {
          changed_paths: [],
          source: resolved.data.source,
          meta: resolved.data.meta ?? null,
          affected_node_ids: [],
          affected_file_paths: [],
        },
      })
    }

    const db = getServiceClient()
    const { nodes, edges } = await loadExploreGraph(db, projectId)
    const impact = computeImportImpact(resolved.data.changed_paths, nodes, edges)

    return c.json({
      ok: true,
      data: {
        changed_paths: resolved.data.changed_paths,
        source: resolved.data.source,
        meta: resolved.data.meta ?? null,
        ...impact,
      },
    })
  })
}

function inferDomainSource(domains: DomainView[]): 'llm' | 'fallback' {
  if (domains.length === 0) return 'fallback'
  const layerIds = new Set(['ui', 'lib', 'backend', 'test', 'config', 'other'])
  if (domains.every((d) => layerIds.has(d.id))) return 'fallback'
  return 'llm'
}

function fallbackDomainsFromLayers(nodes: ExploreGraphNode[]): DomainView[] {
  const byLayer = new Map<string, string[]>()
  for (const n of nodes) {
    const l = n.metadata.layer
    if (!byLayer.has(l)) byLayer.set(l, [])
    byLayer.get(l)!.push(n.metadata.file_path)
  }
  return [...byLayer.entries()].map(([layer, paths]) => ({
    id: layer,
    name: layer.charAt(0).toUpperCase() + layer.slice(1),
    description: `${paths.length} indexed files in the ${layer} layer`,
    flows: [
      {
        id: `${layer}-main`,
        name: 'Main flow',
        description: `Primary ${layer} surface`,
        steps: paths.slice(0, 5).map((p, i) => ({
          id: `${layer}-step-${i}`,
          name: p.split('/').pop() ?? p,
          description: p,
          file_paths: [p],
        })),
      },
    ],
  }))
}
