// Claude Sonnet 5.5 call path (`_shared/claude-messages.ts`) against a stubbed
// `fetch`: the exact request the SDK sends, and how responses map back onto
// the AI SDK v4 result shape and the failover error contract.
//
// Lives outside `_shared/` because CI's Deno test step skips `./_shared/*`.
// Runs with no permission flags, as CI does.

import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { NoObjectGeneratedError, zodSchema } from 'npm:ai@4'
import { z } from 'npm:zod@3'
import { claudeGenerateObject, claudeStreamObject } from '../../_shared/claude-messages.ts'
import { ClaudeRefusalError, toClaudeOutputSchema } from '../../_shared/claude-request.ts'
import { stage2Schema } from '../../_shared/classify-stage2-schema.ts'
import { fixSchema } from '../../_shared/fix-schema.ts'

const schema = z.object({
  category: z.enum(['bug', 'slow']),
  summary: z.string().max(40),
})

interface Captured {
  url: string
  headers: Headers
  body: Record<string, unknown>
}

// The SDK constructor reads ANTHROPIC_* variables through
// `globalThis.process.env`, which needs --allow-env. Present an empty env
// (the edge runtime sets none of them) so the test runs with no flags.
const g = globalThis as unknown as { process: { env: unknown } }
const realProcess = g.process
const emptyEnvProcess = new Proxy(realProcess, {
  get: (target, prop) => (prop === 'env' ? {} : Reflect.get(target, prop)),
})

function stubFetch(respond: () => Response): { calls: Captured[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: Captured[] = []
  g.process = emptyEnvProcess
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = new Request(input, init)
    calls.push({ url: req.url, headers: req.headers, body: JSON.parse(await req.text()) })
    return respond()
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
      g.process = realProcess
    },
  }
}

function message(over: Record<string, unknown>): Response {
  return Response.json({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: '{"category":"bug","summary":"Pay does nothing"}' }],
    stop_reason: 'end_turn',
    stop_details: null,
    usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 },
    ...over,
  })
}

const call = () =>
  claudeGenerateObject({
    apiKey: 'test-key',
    model: 'claude-sonnet-5-5',
    schema,
    effort: 'low',
    messages: [
      { role: 'system', content: 'sys', experimental_providerMetadata: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
      { role: 'user', content: 'report' },
    ],
  })

Deno.test('Sonnet 5.5 request: structured output, effort, fallback; no sampling, tool_choice or thinking', async () => {
  const stub = stubFetch(() => message({}))
  try {
    const result = await call()
    assertEquals(result.object, { category: 'bug', summary: 'Pay does nothing' })
    assertEquals(result.usage, { promptTokens: 120, completionTokens: 30, totalTokens: 150 })
    assertEquals(result.experimental_providerMetadata.anthropic.cacheReadInputTokens, 900)
    assertEquals(result.response.modelId, 'claude-sonnet-5-5')

    const { body, headers, url } = stub.calls[0]
    assert(url.endsWith('/v1/messages?beta=true'), url)
    assert(headers.get('anthropic-beta')?.includes('server-side-fallback-2026-07-01'))
    for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'thinking']) {
      assert(!(banned in body), `${banned} must not be sent to Sonnet 5.5`)
    }
    assertEquals(body.fallbacks, 'default')
    const outputConfig = body.output_config as { effort: string; format: { type: string; schema: Record<string, unknown> } }
    assertEquals(outputConfig.effort, 'low')
    assertEquals(outputConfig.format.type, 'json_schema')
    assertEquals(outputConfig.format.schema.additionalProperties, false)
    assertEquals(body.system, [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }])
    assertEquals((body.messages as Array<{ role: string }>)[0].role, 'user')
  } finally {
    stub.restore()
  }
})

Deno.test('an aborted caller deadline stops the request before it is sent', async () => {
  const stub = stubFetch(() => message({}))
  try {
    const controller = new AbortController()
    controller.abort()
    await assertRejects(() =>
      claudeGenerateObject({ apiKey: 'test-key', model: 'claude-sonnet-5-5', schema, prompt: 'x', abortSignal: controller.signal }),
    )
    assertEquals(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})

Deno.test('refusal surfaces as ClaudeRefusalError with its category', async () => {
  const stub = stubFetch(() => message({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }))
  try {
    const err = await assertRejects(call, ClaudeRefusalError)
    assertEquals(err.category, 'cyber')
    // No digits: `classifyLlmError` must not read it as an HTTP status.
    assert(!/\d/.test(err.message), err.message)
  } finally {
    stub.restore()
  }
})

Deno.test('truncated or off-schema output throws NoObjectGeneratedError (OpenAI fallback path)', async () => {
  for (const over of [
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"category":"bu' }] },
    { content: [{ type: 'text', text: '{"category":"other","summary":"x"}' }] },
    { content: [{ type: 'text', text: 'not json' }] },
  ]) {
    const stub = stubFetch(() => message(over))
    try {
      const err = await assertRejects(call)
      assert(NoObjectGeneratedError.isInstance(err), String(err))
    } finally {
      stub.restore()
    }
  }
})

Deno.test('streamed object yields partials, then the validated object and usage', async () => {
  const events = [
    { type: 'message_start', message: { id: 'msg_2', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, usage: { input_tokens: 50, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"category":"slow",' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '"summary":"Search lags"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_details: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ]
  const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
  const stub = stubFetch(() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }))
  try {
    const stream = claudeStreamObject({ apiKey: 'test-key', model: 'claude-sonnet-5-5', schema, prompt: 'report' })
    const partials: unknown[] = []
    for await (const p of stream.partialObjectStream) partials.push(p)
    assert(partials.length >= 2, `expected progressive partials, got ${partials.length}`)
    assertEquals(await stream.object, { category: 'slow', summary: 'Search lags' })
    assertEquals((await stream.usage).completionTokens, 20)
    assertEquals(stub.calls[0].body.stream, true)
  } finally {
    stub.restore()
  }
})

Deno.test('every migrated schema narrows to the structured-outputs subset', () => {
  const unsupported = ['$schema', 'maxLength', 'minLength', 'maximum', 'minimum', 'exclusiveMinimum', 'exclusiveMaximum', 'maxItems', 'pattern']
  const schemas: Array<[string, unknown]> = [
    ['stage2', zodSchema(stage2Schema).jsonSchema],
    ['fix', zodSchema(fixSchema).jsonSchema],
  ]
  for (const [name, jsonSchema] of schemas) {
    const narrowed = toClaudeOutputSchema(jsonSchema)
    const walk = (node: unknown, path: string): void => {
      if (!node || typeof node !== 'object') return
      const obj = node as Record<string, unknown>
      for (const key of unsupported) assert(!(key in obj), `${name}${path}: ${key} left in schema`)
      if (obj.type === 'object' || (Array.isArray(obj.type) && obj.type.includes('object'))) {
        assertEquals(obj.additionalProperties, false, `${name}${path}: additionalProperties`)
      }
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) v.forEach((item, i) => walk(item, `${path}.${k}[${i}]`))
        else if (typeof v === 'object') walk(v, `${path}.${k}`)
      }
    }
    walk(narrowed, '')
  }
  // Enums survive as constraints (the SDK's own transform demotes them to prose).
  const stage2 = toClaudeOutputSchema(zodSchema(stage2Schema).jsonSchema) as { properties: { category: { enum?: string[] } } }
  assertEquals(stage2.properties.category.enum, ['bug', 'slow', 'visual', 'confusing', 'other'])
})
