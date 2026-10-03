// =============================================================================
// Claude calls through the official Anthropic SDK, returning AI SDK v4-shaped
// results (`object` / `text`, `usage.promptTokens`, `experimental_providerMetadata`)
// so call sites, telemetry, and `withAnthropicOrOpenAi` keep working unchanged.
//
// Use these instead of `generateObject` / `generateText` / `streamText` /
// `streamObject` + `createAnthropic` for any Claude call that may run on
// Sonnet 5.5 (or another 5.x model): AI SDK v4 sends `temperature: 0` and
// forces `tool_choice` for JSON, and both are a 400 there. Request shaping and
// the reasons behind it live in `claude-request.ts`. The OpenAI fallback path
// stays on the AI SDK.
//
// Failure contract (what `llm-failover.ts` relies on):
//   • HTTP errors surface as the SDK's `APIError` with a numeric `status`, so
//     `classifyLlmError` sees 429 / 401 / 5xx exactly as before.
//   • Schema-invalid or truncated output throws ai@4 `NoObjectGeneratedError`,
//     which `withAnthropicOrOpenAi` already hands to OpenAI.
//   • `stop_reason: "refusal"` throws `ClaudeRefusalError` (see that class).
// =============================================================================

import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0'
import { NoObjectGeneratedError, zodSchema } from 'npm:ai@4'
import { parsePartialJson } from 'npm:@ai-sdk/ui-utils@1'
import type { ZodType } from 'npm:zod@3'
import {
  buildClaudeRequest,
  ClaudeRefusalError,
  responseText,
  toClaudeOutputSchema,
  toLegacyUsage,
  type ClaudeEffort,
  type ClaudeUsageLike,
  type LegacyMessage,
} from './claude-request.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('claude-messages')

/** Room for adaptive thinking, which counts toward `max_tokens`. */
const DEFAULT_MAX_TOKENS = 16_000
const DEFAULT_TIMEOUT_MS = 120_000

export interface ClaudeCallOptions {
  apiKey: string
  model: string
  system?: string
  prompt?: string
  messages?: LegacyMessage[]
  maxTokens?: number
  temperature?: number
  effort?: ClaudeEffort
  /** Per-call HTTP timeout; the SDK's own retries are off (failover owns retries). */
  timeoutMs?: number
  /** Caller deadline (e.g. a cron's run budget); aborts the request when it fires. */
  abortSignal?: AbortSignal
}

interface FinalMessageLike {
  id?: string
  model: string
  stop_reason: string | null
  stop_details?: { category?: string | null } | null
  content: ReadonlyArray<{ type: string; text?: string }>
  usage: ClaudeUsageLike
}

function client(opts: ClaudeCallOptions): Anthropic {
  return new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS })
}

/** Per-request SDK options: only the caller's abort signal, when it has one. */
function requestOptions(opts: ClaudeCallOptions): { signal: AbortSignal } | undefined {
  return opts.abortSignal ? { signal: opts.abortSignal } : undefined
}

function requestFor(opts: ClaudeCallOptions, outputSchema?: Record<string, unknown>) {
  const { body, betas } = buildClaudeRequest({
    model: opts.model,
    maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: opts.system,
    prompt: opts.prompt,
    messages: opts.messages,
    temperature: opts.temperature,
    effort: opts.effort,
    outputSchema,
  })
  return betas.length > 0 ? { ...body, betas } : body
}

function legacyResult(message: FinalMessageLike) {
  const { usage, providerMetadata } = toLegacyUsage(message.usage)
  return {
    usage,
    providerMetadata,
    experimental_providerMetadata: providerMetadata,
    finishReason: message.stop_reason,
    response: { id: message.id ?? '', modelId: message.model, timestamp: new Date() },
  }
}

/**
 * Refusals are the one non-HTTP failure that must be explicit, never silent.
 * Also records when a server-side fallback served the turn (`response.modelId`
 * then names the fallback model, e.g. `claude-sonnet-5`).
 */
function assertNotRefused(message: FinalMessageLike, requestedModel: string): void {
  if (message.stop_reason !== 'refusal') {
    if (!message.model.startsWith(requestedModel)) {
      log.info('Claude server-side fallback served the request', { requestedModel, servedModel: message.model })
    }
    return
  }
  const category = message.stop_details?.category ?? null
  log.warn('Claude refused the request', { requestedModel, servedModel: message.model, category })
  throw new ClaudeRefusalError(message.model, category)
}

function parseObject<T>(schema: ZodType<T>, message: FinalMessageLike): T {
  const text = responseText(message.content)
  const meta = legacyResult(message)
  const fail = (reason: string, cause?: Error): never => {
    throw new NoObjectGeneratedError({
      message: `No object generated: ${reason}.`,
      cause,
      text,
      response: meta.response,
      usage: meta.usage,
      finishReason: message.stop_reason === 'max_tokens' ? 'length' : 'stop',
    })
  }
  if (message.stop_reason === 'max_tokens') fail('the response hit max_tokens before the object was complete')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    fail('the response was not valid JSON', err as Error)
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) fail('the response did not match the schema', parsed.error)
  return (parsed as { data: T }).data
}

function outputSchemaFor<T>(schema: ZodType<T>): Record<string, unknown> {
  return toClaudeOutputSchema(zodSchema(schema).jsonSchema)
}

/** Structured output (`generateObject` replacement). */
export async function claudeGenerateObject<T>(opts: ClaudeCallOptions & { schema: ZodType<T> }) {
  const body = requestFor(opts, outputSchemaFor(opts.schema))
  const message = (await client(opts).beta.messages.create(body as never, requestOptions(opts))) as unknown as FinalMessageLike
  assertNotRefused(message, opts.model)
  return { object: parseObject(opts.schema, message), ...legacyResult(message) }
}

/** Plain text (`generateText` replacement). */
export async function claudeGenerateText(opts: ClaudeCallOptions) {
  const body = requestFor(opts)
  const message = (await client(opts).beta.messages.create(body as never, requestOptions(opts))) as unknown as FinalMessageLike
  assertNotRefused(message, opts.model)
  return { text: responseText(message.content), ...legacyResult(message) }
}

type LegacyMeta = ReturnType<typeof legacyResult>

/**
 * Deno terminates the isolate on an unhandled rejection. A caller that stops
 * at the stream's error never awaits `usage` / `object` / metadata, so every
 * promise these helpers hand out is marked handled; awaiting it still throws.
 */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = quiet(new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  }))
  return { promise, resolve, reject }
}

/**
 * Stream text deltas, then settle `usage` / provider metadata from the final
 * message. Iterating `textStream` drives the request; it throws (after any
 * deltas already yielded) on an HTTP error or a refusal.
 */
function streamDeltas(opts: ClaudeCallOptions, outputSchema: Record<string, unknown> | undefined) {
  const final = deferred<FinalMessageLike>()
  async function* deltas(): AsyncGenerator<string> {
    try {
      const stream = client(opts).beta.messages.stream(requestFor(opts, outputSchema) as never, requestOptions(opts))
      for await (const event of stream as AsyncIterable<{ type: string; delta?: { type: string; text?: string } }>) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield event.delta.text
        }
      }
      const message = (await stream.finalMessage()) as unknown as FinalMessageLike
      assertNotRefused(message, opts.model)
      final.resolve(message)
    } catch (err) {
      final.reject(err)
      throw err
    }
  }
  return { deltas: deltas(), final: final.promise }
}

/** Streaming text (`streamText` replacement). */
export function claudeStreamText(opts: ClaudeCallOptions) {
  const { deltas, final } = streamDeltas(opts, undefined)
  const meta: Promise<LegacyMeta> = quiet(final.then(legacyResult))
  return {
    textStream: deltas,
    usage: quiet(meta.then((m) => m.usage)),
    experimental_providerMetadata: quiet(meta.then((m) => m.providerMetadata)),
    response: quiet(meta.then((m) => m.response)),
  }
}

/**
 * Streaming structured output (`streamObject` replacement). `partialObjectStream`
 * yields each new partial parse of the JSON so far; `object` settles with the
 * Zod-validated final object once the stream has been consumed.
 */
export function claudeStreamObject<T>(opts: ClaudeCallOptions & { schema: ZodType<T> }) {
  const { deltas, final } = streamDeltas(opts, outputSchemaFor(opts.schema))
  async function* partials(): AsyncGenerator<unknown> {
    let text = ''
    let last = ''
    for await (const delta of deltas) {
      text += delta
      const { value } = parsePartialJson(text)
      if (value === undefined || value === null) continue
      const snapshot = JSON.stringify(value)
      if (snapshot === last) continue
      last = snapshot
      yield value
    }
  }
  const meta: Promise<LegacyMeta> = quiet(final.then(legacyResult))
  return {
    partialObjectStream: partials(),
    object: quiet(final.then((message) => parseObject(opts.schema, message))),
    usage: quiet(meta.then((m) => m.usage)),
    providerMetadata: quiet(meta.then((m) => m.providerMetadata)),
    response: quiet(meta.then((m) => m.response)),
  }
}
