// =============================================================================
// Claude Messages API request shaping — pure, dependency-free.
//
// WHY THIS EXISTS (2026-10-02, Sonnet 5.5 migration)
//   AI SDK v4 cannot talk to Claude Sonnet 5.5:
//     • `ai@4` `prepareCallSettings` sends `temperature: 0` on every call
//       (ai@4.3.19 dist/index.mjs:1619). Sonnet 5.5 rejects any non-default
//       sampling value with a 400.
//     • `@ai-sdk/anthropic@1` implements `generateObject` by FORCING a tool
//       call (`tool_choice: {type:'tool'}`). Sonnet 5.5 rejects forced
//       tool_choice with a 400.
//   `claude-messages.ts` calls the Messages API through the official SDK and
//   uses native structured outputs (`output_config.format`) instead. This file
//   holds the parts of that path that are pure decisions — which knobs a model
//   accepts, how the JSON Schema is narrowed, how v4-style messages map onto
//   the Messages API — so they are unit-testable from vitest without the SDK.
// =============================================================================

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Beta header for `fallbacks: "default"` (server-side refusal fallback). */
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export interface ClaudeModelTraits {
  /** `temperature` / `top_p` / `top_k` accepted at non-default values. */
  acceptsSampling: boolean
  /** Effort levels the model accepts in `output_config.effort`; empty = none. */
  effortLevels: readonly ClaudeEffort[]
  /** Accepts `fallbacks: "default"` under SERVER_SIDE_FALLBACK_BETA. */
  serverSideFallback: boolean
}

const ALL_EFFORT: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Strip an optional `vendor/` prefix and lowercase. */
function bareModelId(model: string): string {
  const key = model.trim().toLowerCase()
  return key.includes('/') ? key.split('/').slice(-1)[0] : key
}

/**
 * Request-surface traits per Claude model, from the Claude API model table
 * (cached 2026-09-25). Unknown future ids get the 5.x surface: no sampling
 * knobs and every effort level — the conservative choice, because sending a
 * sampling knob to a model that rejects it is a hard 400 while omitting it on
 * a model that accepts it only costs determinism.
 */
export function claudeModelTraits(model: string): ClaudeModelTraits {
  const id = bareModelId(model)
  // Fable 5.1 / Opus 5.5 / Opus 5 / Sonnet 5.5 accept the "default" fallback form.
  if (/^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)\b/.test(id)) {
    return { acceptsSampling: false, effortLevels: ALL_EFFORT, serverSideFallback: true }
  }
  // Sonnet 5, Fable 5, Opus 4.7 / 4.8: sampling removed, effort supported.
  if (/^claude-(sonnet-5|fable-5|opus-4-[7-9])\b/.test(id)) {
    return { acceptsSampling: false, effortLevels: ALL_EFFORT, serverSideFallback: false }
  }
  // Opus / Sonnet 4.6 and older, Haiku 4.5: sampling allowed. Effort is
  // withheld even where the API takes it (4.5 / 4.6), so a per-project
  // override onto one of these models sends exactly the request it sent
  // before the migration (temperature 0, default effort).
  if (/^claude-(haiku|sonnet|opus)-[34]\b|^claude-3/.test(id)) {
    return { acceptsSampling: true, effortLevels: [], serverSideFallback: false }
  }
  return { acceptsSampling: false, effortLevels: ALL_EFFORT, serverSideFallback: false }
}

/**
 * Map a stored per-project model id (`project_settings.stage2_model`,
 * `judge_model`, …) onto one the current pipeline can call:
 *   • null / empty → the platform default for that stage;
 *   • Claude 3.x and Sonnet/Opus 4.0–4.5 (retired or without native
 *     structured-output parity) → the platform default;
 *   • a dated Haiku 4.5 snapshot → the `claude-haiku-4-5` alias;
 *   • anything else (current ids, future ids, non-Claude ids) → unchanged,
 *     so an operator's explicit choice keeps working.
 */
export function resolveClaudeModel(stored: string | null | undefined, platformDefault: string): string {
  const raw = (stored ?? '').trim()
  if (!raw) return platformDefault
  const id = bareModelId(raw)
  if (/^claude-haiku-4-5-\d{8}$/.test(id)) return 'claude-haiku-4-5'
  if (/^claude-3/.test(id)) return platformDefault
  if (/^claude-(sonnet|opus)-4(-[0-5])?(-\d{8})?$/.test(id)) return platformDefault
  return raw
}

// -----------------------------------------------------------------------------
// JSON Schema → structured-outputs subset
// -----------------------------------------------------------------------------

const SUPPORTED_STRING_FORMATS = new Set([
  'date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid',
])

type JsonObject = Record<string, unknown>

/**
 * Narrow a JSON Schema (as emitted by zod-to-json-schema) to the subset Claude
 * structured outputs accept. Unsupported constraints (string lengths, numeric
 * bounds, array bounds other than minItems 0/1, unknown formats) move into the
 * description so the model still sees them; the caller re-validates the
 * parsed object with the original Zod schema, which enforces them for real.
 *
 * Differs from the SDK's `transformJSONSchema` in one deliberate way: `enum`
 * and `const` are KEPT as constraints (the SDK helper demotes them to prose),
 * because an off-enum value would otherwise fail Zod validation after the
 * call had already been paid for.
 */
export function toClaudeOutputSchema(schema: unknown): JsonObject {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Structured-output schema must be a JSON object')
  }
  return narrow(structuredClone(schema) as JsonObject)
}

function take(obj: JsonObject, key: string): unknown {
  const value = obj[key]
  delete obj[key]
  return value
}

function narrow(src: JsonObject): JsonObject {
  const out: JsonObject = {}
  delete src.$schema

  for (const defsKey of ['$defs', 'definitions']) {
    const defs = take(src, defsKey)
    if (defs && typeof defs === 'object') {
      out[defsKey] = Object.fromEntries(
        Object.entries(defs as JsonObject).map(([name, def]) => [name, narrow(def as JsonObject)]),
      )
    }
  }
  const ref = take(src, '$ref')
  if (typeof ref === 'string') {
    out.$ref = ref
    return out
  }

  const anyOf = take(src, 'anyOf') ?? take(src, 'oneOf')
  const allOf = take(src, 'allOf')
  if (Array.isArray(anyOf)) out.anyOf = anyOf.map((s) => narrow(s as JsonObject))
  if (Array.isArray(allOf)) out.allOf = allOf.map((s) => narrow(s as JsonObject))

  const type = take(src, 'type')
  if (type !== undefined) out.type = type
  for (const key of ['description', 'title', 'enum', 'const']) {
    const value = take(src, key)
    if (value !== undefined) out[key] = value
  }

  const types = Array.isArray(type) ? type : [type]
  if (types.includes('object')) {
    const props = (take(src, 'properties') ?? {}) as JsonObject
    out.properties = Object.fromEntries(
      Object.entries(props).map(([key, prop]) => [key, narrow(prop as JsonObject)]),
    )
    const required = take(src, 'required')
    if (Array.isArray(required)) out.required = required
    delete src.additionalProperties
    out.additionalProperties = false
  }
  if (types.includes('array')) {
    const items = take(src, 'items')
    if (items && typeof items === 'object' && !Array.isArray(items)) out.items = narrow(items as JsonObject)
    const minItems = src.minItems
    if (minItems === 0 || minItems === 1) {
      out.minItems = minItems
      delete src.minItems
    }
  }
  if (types.includes('string') && typeof src.format === 'string' && SUPPORTED_STRING_FORMATS.has(src.format)) {
    out.format = take(src, 'format')
  }

  const leftovers = Object.entries(src)
  if (leftovers.length > 0) {
    const note = `{${leftovers.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`
    out.description = typeof out.description === 'string' ? `${out.description}\n\n${note}` : note
  }
  return out
}

// -----------------------------------------------------------------------------
// AI-SDK-v4-style messages → Messages API
// -----------------------------------------------------------------------------

/** The subset of AI SDK v4 `CoreMessage` the migrated call sites send. */
export interface LegacyMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LegacyPart[]
  experimental_providerMetadata?: { anthropic?: { cacheControl?: { type: 'ephemeral' } } }
}

export type LegacyPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string | URL }

type CacheControl = { type: 'ephemeral' }

export interface ClaudeTextBlock {
  type: 'text'
  text: string
  cache_control?: CacheControl
}

export type ClaudeContentBlock =
  | ClaudeTextBlock
  | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string } }

export interface ClaudeMessageParam {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

function cacheControlOf(message: LegacyMessage): CacheControl | undefined {
  return message.experimental_providerMetadata?.anthropic?.cacheControl
}

function toContentBlock(part: LegacyPart): ClaudeContentBlock {
  if (part.type === 'text') return { type: 'text', text: part.text }
  const image = String(part.image)
  const dataUrl = /^data:([^;]+);base64,(.*)$/s.exec(image)
  if (dataUrl) return { type: 'image', source: { type: 'base64', media_type: dataUrl[1], data: dataUrl[2] } }
  return { type: 'image', source: { type: 'url', url: image } }
}

/**
 * Split v4 messages into the top-level `system` array and the turn list.
 * System-role entries become system text blocks (a `role: 'system'` entry as
 * `messages[0]` is a 400 on Sonnet 5.5), and the v4 per-message
 * `cacheControl` marker becomes `cache_control` on that block so prompt
 * caching keeps working after the migration.
 */
export function toClaudeMessages(input: {
  system?: string
  prompt?: string
  messages?: LegacyMessage[]
}): { system: ClaudeTextBlock[]; messages: ClaudeMessageParam[] } {
  const system: ClaudeTextBlock[] = []
  const messages: ClaudeMessageParam[] = []
  if (input.system) system.push({ type: 'text', text: input.system })
  for (const message of input.messages ?? []) {
    const cache = cacheControlOf(message)
    if (message.role === 'system') {
      const text = typeof message.content === 'string'
        ? message.content
        : message.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
      system.push(cache ? { type: 'text', text, cache_control: cache } : { type: 'text', text })
      continue
    }
    if (typeof message.content === 'string') {
      messages.push({
        role: message.role,
        content: cache ? [{ type: 'text', text: message.content, cache_control: cache }] : message.content,
      })
    } else {
      messages.push({ role: message.role, content: message.content.map(toContentBlock) })
    }
  }
  if (input.prompt) messages.push({ role: 'user', content: input.prompt })
  if (messages.length === 0) throw new Error('Claude request needs at least one user message')
  return { system, messages }
}

// -----------------------------------------------------------------------------
// Request body
// -----------------------------------------------------------------------------

export interface ClaudeRequestOptions {
  model: string
  maxTokens: number
  system?: string
  prompt?: string
  messages?: LegacyMessage[]
  /** Honoured only on models that accept sampling knobs. */
  temperature?: number
  /** Sent only on models that accept it; dropped otherwise. */
  effort?: ClaudeEffort
  /** Narrowed JSON Schema for `output_config.format`. */
  outputSchema?: JsonObject
}

export interface ClaudeRequest {
  body: JsonObject
  betas: string[]
}

/**
 * Build the Messages API body for one call. Never sends `thinking` (omitted =
 * adaptive on the 5.x family, off on older models) or `tool_choice`. On models
 * that accept sampling knobs, keeps the AI SDK v4 default of `temperature: 0`
 * so a per-project override onto Sonnet 4.6 behaves as it did before.
 */
export function buildClaudeRequest(opts: ClaudeRequestOptions): ClaudeRequest {
  const traits = claudeModelTraits(opts.model)
  const { system, messages } = toClaudeMessages(opts)
  const body: JsonObject = { model: opts.model, max_tokens: opts.maxTokens, messages }
  if (system.length > 0) body.system = system
  if (traits.acceptsSampling) body.temperature = opts.temperature ?? 0

  const outputConfig: JsonObject = {}
  if (opts.effort && traits.effortLevels.includes(opts.effort)) outputConfig.effort = opts.effort
  if (opts.outputSchema) outputConfig.format = { type: 'json_schema', schema: opts.outputSchema }
  if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig

  const betas: string[] = []
  if (traits.serverSideFallback) {
    body.fallbacks = 'default'
    betas.push(SERVER_SIDE_FALLBACK_BETA)
  }
  return { body, betas }
}

// -----------------------------------------------------------------------------
// Responses
// -----------------------------------------------------------------------------

/**
 * Thrown when Claude (or its whole server-side fallback chain) declines with
 * `stop_reason: "refusal"`. Not transient and not a key fault: the failover
 * layer must neither retry it on the same key nor mark the key bad, and
 * `withAnthropicOrOpenAi` hands the call to OpenAI.
 *
 * The message deliberately carries no digits and none of the words
 * `classifyLlmError` keys on (quota, timeout, unauthorized, …), so the
 * string-based classifier cannot misread it as a rate limit or outage.
 */
export class ClaudeRefusalError extends Error {
  readonly category: string | null
  readonly model: string
  constructor(model: string, category: string | null) {
    super(`Claude declined the request (refusal category: ${category ?? 'unspecified'})`)
    this.name = 'ClaudeRefusalError'
    this.category = category
    this.model = model
  }
}

export function isClaudeRefusal(err: unknown): err is ClaudeRefusalError {
  return err instanceof ClaudeRefusalError ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'ClaudeRefusalError')
}

export interface ClaudeUsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/**
 * Map Messages API usage onto the AI SDK v4 result shape the call sites and
 * `extractAnthropicCacheUsage` already read, with the same semantics
 * `@ai-sdk/anthropic@1` used (`promptTokens` = uncached `input_tokens`).
 */
export function toLegacyUsage(usage: ClaudeUsageLike | null | undefined) {
  const promptTokens = usage?.input_tokens ?? 0
  const completionTokens = usage?.output_tokens ?? 0
  return {
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    providerMetadata: {
      anthropic: {
        cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? null,
        cacheReadInputTokens: usage?.cache_read_input_tokens ?? null,
      },
    },
  }
}

/** Concatenate the text blocks of a response; thinking blocks are skipped. */
export function responseText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
}
