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
  type DomainView,
  type ExploreGraphNode,
} from '../../_shared/codebase-understand.ts'
import { dbError, userCanAccessProject } from '../shared.ts'

const routeLog = log.child('codebase-understand')

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

      await db.from('codebase_chat_threads').upsert(
        { id: threadId, project_id: projectId, user_id: userId, updated_at: new Date().toISOString() },
        { onConflict: 'id' },
      )
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

        await db.from('codebase_chat_threads').upsert(
          { id: threadId, project_id: projectId, user_id: userId, updated_at: new Date().toISOString() },
          { onConflict: 'id' },
        )
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
            { threadId, model: usedModel, citations, latencyMs, costUsd, inputTokens, outputTokens },
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
        return c.json({ ok: true, data: { domains: cached.domains, cached: true, updated_at: cached.updated_at } })
      }
    }

    const { nodes } = await loadExploreGraph(db, projectId)
    const fileList = nodes
      .slice(0, 80)
      .map((n) => `- ${n.metadata.file_path} (${n.metadata.layer})`)
      .join('\n')

    let domains: DomainView[] = []

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

    return c.json({ ok: true, data: { domains, cached: false, updated_at: new Date().toISOString() } })
  })

  // ── GET /codebase/impact ─────────────────────────────────────────────────
  app.get('/v1/admin/projects/:id/codebase/impact', readAuth, async (c) => {
    const projectId = c.req.param('id')!
    const userId = c.get('userId') as string
    const forbidden = await assertProjectAccess(c, projectId, userId)
    if (forbidden) return forbidden

    const pathsParam = c.req.query('paths') ?? ''
    const changedPaths = pathsParam
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (changedPaths.length === 0) {
      return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'paths query required' } }, 400)
    }

    const db = getServiceClient()
    const { nodes, edges } = await loadExploreGraph(db, projectId)
    const impact = computeImportImpact(changedPaths, nodes, edges)

    return c.json({ ok: true, data: { changed_paths: changedPaths, ...impact } })
  })
}

type ExploreLayer = 'ui' | 'lib' | 'backend' | 'test' | 'config' | 'other'

function detectExploreLayer(filePath: string): ExploreLayer {
  const p = filePath.toLowerCase().replace(/\\/g, '/')
  if (/(^|\/)(tests?|__tests?__|spec|e2e|cypress|playwright)\//.test(p) || /\.(test|spec)\.[jt]sx?$/.test(p)) return 'test'
  if (/(^|\/)(server|api|edge-function|supabase\/functions|backend|routes?)\//.test(p)) return 'backend'
  if (/(^|\/)(app|pages?|screens?|views?|components?|layouts?|ui)\//u.test(p) || /\.(tsx|jsx)$/u.test(p)) return 'ui'
  if (/(^|\/)(lib|libs?|utils?|helpers?|hooks?|contexts?|shared|common|core)\//u.test(p)) return 'lib'
  if (/(^|\/)(config|configs?|tooling|scripts?|deploy|\.github|build)\//u.test(p) || /\.(json|yaml|yml|toml|mjs|cjs)$/u.test(p)) return 'config'
  return 'other'
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
