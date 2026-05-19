/**
 * FILE: packages/server/supabase/functions/_shared/otlp-exporter.ts
 * PURPOSE: Lightweight OTLP/HTTP+JSON span exporter for Deno Edge Functions.
 *
 * BACKGROUND:
 *   Mushi is a middleware aggregator. When `OTEL_EXPORTER_OTLP_ENDPOINT` is
 *   set, Mushi should forward a span record for each significant operation
 *   (report ingest, classification, fix dispatch) to the user's own OTEL
 *   collector (Jaeger, Zipkin, Grafana Tempo, Honeycomb, Datadog Agent, etc.)
 *   using the BYOK model — we never hard-code a destination.
 *
 *   We do NOT use `@opentelemetry/sdk-node` here because:
 *     1. It cannot run in Deno / Edge Workers.
 *     2. Its gzipped bundle adds ~800 KB to cold-start time.
 *     3. We only need the minimal OTLP/HTTP+JSON shape documented in
 *        https://opentelemetry.io/docs/specs/otlp/#otlphttp-request
 *
 * ACTIVATION:
 *   Set `OTEL_EXPORTER_OTLP_ENDPOINT` to your collector's base URL, e.g.:
 *     OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.us0.signalfx.com
 *   Spans are POSTed to `{endpoint}/v1/traces` (OTLP/HTTP+JSON format).
 *
 *   Optional headers (for auth):
 *     OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <token>,x-sf-token=<tok>
 *
 * USAGE:
 *   import { otlpSpan } from '../_shared/otlp-exporter.ts'
 *
 *   const span = otlpSpan('classify-report', traceparent, {
 *     'report.id': reportId,
 *     'project.id': projectId,
 *   })
 *   try {
 *     // ... do work ...
 *     span.setStatus('ok')
 *   } catch (e) {
 *     span.setStatus('error', String(e))
 *     throw e
 *   } finally {
 *     await span.end()
 *   }
 */

import { parseTraceparent, childTraceparent, newTraceparent } from './trace.ts';

// ---------------------------------------------------------------------------
// Types — minimal OTLP/HTTP+JSON proto-JSON shapes
// (https://opentelemetry.io/docs/specs/otlp/#request-response)
// ---------------------------------------------------------------------------

interface OtlpKeyValue {
  key: string;
  value: { stringValue?: string; intValue?: string; boolValue?: boolean; doubleValue?: number };
}

interface OtlpSpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number; // SpanKind: 1=INTERNAL, 2=SERVER, 3=CLIENT
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpKeyValue[];
  status: { code: number; message?: string }; // 0=UNSET 1=OK 2=ERROR
}

interface OtlpExportRequest {
  resourceSpans: Array<{
    resource: { attributes: OtlpKeyValue[] };
    scopeSpans: Array<{
      scope: { name: string; version: string };
      spans: OtlpSpanRecord[];
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Builder — SpanBuilder returned from otlpSpan()
// ---------------------------------------------------------------------------

export interface SpanBuilder {
  /** Override the span name (e.g. if computed lazily). */
  setName(name: string): void;
  /** Add or overwrite an attribute. */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Mark as OK or ERROR. Call before end(). */
  setStatus(code: 'ok' | 'error' | 'unset', message?: string): void;
  /** Finish the span. Fire-and-forget flush; never throws. */
  end(): Promise<void>;
  /** The child traceparent to propagate to downstream calls. */
  readonly traceparent: string;
}

function toNano(ms: number): string {
  return String(BigInt(Math.round(ms)) * BigInt(1_000_000));
}

function toKv(key: string, value: string | number | boolean): OtlpKeyValue {
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
}

function parseOtlpHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return out;
}

/**
 * Create an OTLP span builder for a named operation.
 *
 * @param name        Span name, e.g. `"classify-report"`.
 * @param parent      Inbound W3C traceparent (or null/undefined for a root span).
 * @param attributes  Initial key/value attributes to attach.
 */
export function otlpSpan(
  name: string,
  parent: string | null | undefined,
  attributes: Record<string, string | number | boolean> = {},
): SpanBuilder {
  const endpoint = Deno.env.get('OTEL_EXPORTER_OTLP_ENDPOINT');
  const startMs = Date.now();

  // The child traceparent for this span to propagate downstream.
  const spanTraceparent = childTraceparent(parent);
  const parts = parseTraceparent(spanTraceparent)!;

  let spanName = name;
  let statusCode: 0 | 1 | 2 = 0; // UNSET
  let statusMessage: string | undefined;
  const attrs: Record<string, string | number | boolean> = { ...attributes };

  const builder: SpanBuilder = {
    get traceparent() {
      return spanTraceparent;
    },

    setName(n: string) {
      spanName = n;
    },

    setAttribute(key: string, value: string | number | boolean) {
      attrs[key] = value;
    },

    setStatus(code: 'ok' | 'error' | 'unset', message?: string) {
      statusCode = code === 'ok' ? 1 : code === 'error' ? 2 : 0;
      statusMessage = message;
    },

    async end(): Promise<void> {
      if (!endpoint) return; // OTLP not configured — no-op

      const endMs = Date.now();
      const inboundParts = parent ? parseTraceparent(parent) : null;
      const spanRecord: OtlpSpanRecord = {
        traceId: parts.traceId,
        spanId: parts.spanId,
        ...(inboundParts ? { parentSpanId: inboundParts.spanId } : {}),
        name: spanName,
        kind: 1, // INTERNAL
        startTimeUnixNano: toNano(startMs),
        endTimeUnixNano: toNano(endMs),
        attributes: [
          toKv('service.name', 'mushi-mushi-server'),
          ...Object.entries(attrs).map(([k, v]) => toKv(k, v)),
        ],
        status: {
          code: statusCode,
          ...(statusMessage ? { message: statusMessage } : {}),
        },
      };

      const payload: OtlpExportRequest = {
        resourceSpans: [
          {
            resource: {
              attributes: [
                toKv('service.name', 'mushi-mushi-server'),
                toKv('telemetry.sdk.name', 'mushi-otlp-exporter'),
                toKv('telemetry.sdk.version', '1.0.0'),
              ],
            },
            scopeSpans: [
              {
                scope: { name: 'mushi-mushi', version: '1.0.0' },
                spans: [spanRecord],
              },
            ],
          },
        ],
      };

      try {
        const rawHeaders = Deno.env.get('OTEL_EXPORTER_OTLP_HEADERS') ?? '';
        const extraHeaders = rawHeaders ? parseOtlpHeaders(rawHeaders) : {};
        await fetch(`${endpoint.replace(/\/$/, '')}/v1/traces`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...extraHeaders,
          },
          body: JSON.stringify(payload),
          // 5-second budget; tracing should never slow the critical path
          signal: AbortSignal.timeout(5_000),
        });
      } catch {
        // Exporter errors are silently swallowed — tracing infra must never
        // crash or slow the host operation.
      }
    },
  };

  return builder;
}

/**
 * Convenience: wrap an async operation in an OTLP span, auto-setting status.
 *
 * Returns the value of `fn()` unchanged. Always flushes the span (even on
 * throw) via `finally`.
 */
export async function withOtlpSpan<T>(
  name: string,
  parent: string | null | undefined,
  attributes: Record<string, string | number | boolean>,
  fn: (span: SpanBuilder) => Promise<T>,
): Promise<T> {
  const span = otlpSpan(name, parent, attributes);
  try {
    const result = await fn(span);
    if (span.traceparent) span.setStatus('ok');
    return result;
  } catch (err) {
    span.setStatus('error', err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await span.end();
  }
}

// ---------------------------------------------------------------------------
// GenAI helpers — emit OpenTelemetry GenAI semantic-convention attributes
// (https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/) so the
// user's APM (Honeycomb / Datadog / Tempo / SignalFx) can graph cost,
// latency, and token usage per model out of the box, without us shipping
// a custom dashboard.
//
// Cost attribute name: `gen_ai.usage.cost_usd` is NOT (yet) part of the
// official semconv — it's still in development, and most APMs treat it as
// a custom attribute keyed off `gen_ai.*` prefix. Naming it under the
// `gen_ai.usage.*` namespace keeps it discoverable alongside the official
// `gen_ai.usage.input_tokens` / `output_tokens` counters when the spec
// stabilises.
// ---------------------------------------------------------------------------

/** Provider hint for the GenAI semconv `gen_ai.provider.name` attribute. */
export type GenAiProvider = 'anthropic' | 'openai' | 'gcp.gen_ai' | 'gcp.vertex_ai' | 'unknown';

export interface GenAiUsageAttrs {
  /** GenAI operation kind — required by the semconv. */
  operationName: 'chat' | 'generate_content' | 'text_completion' | 'embeddings';
  /** Provider name — required by the semconv. Inferred from the model id when unknown. */
  provider?: GenAiProvider;
  /** The model id sent in the request (e.g. `claude-sonnet-4-6`). */
  requestModel?: string;
  /** The model id reported back in the response (may differ for fallbacks). */
  responseModel?: string;
  /** Input prompt token count. */
  inputTokens?: number | null;
  /** Output completion token count. */
  outputTokens?: number | null;
  /** Tokens served from the provider-managed prompt cache. */
  cacheReadInputTokens?: number | null;
  /** Tokens written to the provider-managed prompt cache (Anthropic only today). */
  cacheCreationInputTokens?: number | null;
  /** Output tokens spent on extended-thinking / chain-of-thought. */
  reasoningOutputTokens?: number | null;
  /** Computed USD cost — added as a custom attribute under the `gen_ai.usage.*` prefix. */
  costUsd?: number | null;
  /** Streaming mode (if applicable). */
  streaming?: boolean;
}

/**
 * Infer the provider name from a model id. Best-effort — falls back to
 * 'unknown' so we still satisfy the required attribute without lying.
 */
function inferProvider(model: string | undefined): GenAiProvider {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('gpt-') || m.startsWith('text-embedding-')) return 'openai';
  if (m.startsWith('gemini-')) return 'gcp.gen_ai';
  return 'unknown';
}

/**
 * Set OpenTelemetry GenAI semantic-convention attributes on an existing
 * SpanBuilder. Call this immediately after the LLM round-trip completes,
 * before `span.end()`, so the exporter ships a span the user's APM can
 * graph as a GenAI inference call.
 *
 * Only sets attributes for non-null fields — partial usage data still
 * produces a useful span, just without the missing dimensions.
 */
export function setGenAiAttributes(span: SpanBuilder, attrs: GenAiUsageAttrs): void {
  span.setAttribute('gen_ai.operation.name', attrs.operationName);
  span.setAttribute('gen_ai.provider.name', attrs.provider ?? inferProvider(attrs.requestModel));
  if (attrs.requestModel) span.setAttribute('gen_ai.request.model', attrs.requestModel);
  if (attrs.responseModel) span.setAttribute('gen_ai.response.model', attrs.responseModel);
  if (typeof attrs.streaming === 'boolean')
    span.setAttribute('gen_ai.request.stream', attrs.streaming);
  if (typeof attrs.inputTokens === 'number' && attrs.inputTokens >= 0) {
    span.setAttribute('gen_ai.usage.input_tokens', attrs.inputTokens);
  }
  if (typeof attrs.outputTokens === 'number' && attrs.outputTokens >= 0) {
    span.setAttribute('gen_ai.usage.output_tokens', attrs.outputTokens);
  }
  if (typeof attrs.reasoningOutputTokens === 'number' && attrs.reasoningOutputTokens > 0) {
    span.setAttribute('gen_ai.usage.reasoning.output_tokens', attrs.reasoningOutputTokens);
  }
  if (typeof attrs.cacheReadInputTokens === 'number' && attrs.cacheReadInputTokens > 0) {
    span.setAttribute('gen_ai.usage.cache_read.input_tokens', attrs.cacheReadInputTokens);
  }
  if (typeof attrs.cacheCreationInputTokens === 'number' && attrs.cacheCreationInputTokens > 0) {
    span.setAttribute('gen_ai.usage.cache_creation.input_tokens', attrs.cacheCreationInputTokens);
  }
  if (typeof attrs.costUsd === 'number' && Number.isFinite(attrs.costUsd) && attrs.costUsd >= 0) {
    // Custom attribute; see header comment. Naming under gen_ai.usage.*
    // keeps it grouped with the official token counters.
    span.setAttribute('gen_ai.usage.cost_usd', attrs.costUsd);
  }
}
