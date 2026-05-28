/**
 * FILE: packages/server/supabase/functions/_shared/fine-tune-vendor.ts
 * PURPOSE: Vendor adapters for the fine-tune pipeline (V5.3 §2.15, B4).
 *
 *          The vendor-agnostic pipeline (export → validate → promote) lives
 *          in `_shared/fine-tune.ts`. This file wires in the one step that
 *          *is* vendor-specific: shipping the exported JSONL off to a
 *          training service and polling it to completion.
 *
 *          Wave S5 ships the OpenAI adapter (the only first-party fine-tune
 *          API with a stable public surface at time of writing). Anthropic
 *          fine-tune is gated behind AWS Bedrock / GCP Vertex — we stub
 *          those so the `VendorName` union is exhaustive and callers get
 *          a clean "not enabled" error rather than a runtime crash.
 *
 *          P2.3 decision: delete `stubAdapter` from the production code path.
 *          The `stub` vendor name is preserved for test isolation only
 *          (offline CI that cannot reach the OpenAI API). Any `base_model`
 *          that does not match a real vendor prefix now throws a clear error
 *          instead of silently succeeding with fake predictions.
 *
 *          BYOK model: the caller sets OPENAI_API_KEY in their own
 *          environment. Mushi never manages vendor credentials.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { FineTuningJobRow, ExportSampleRow } from './fine-tune.ts'
import { resolveLlmKey } from './byok.ts'

/** Production vendors. `stub` is test-only; getAdapter() refuses it unless
 *  MUSHI_ALLOW_STUB_FINE_TUNE=1 is set.  */
export type VendorName = 'openai' | 'anthropic' | 'bedrock' | 'stub'

export interface VendorSubmitResult {
  vendor: VendorName
  vendorJobId: string
  status: string
}

export interface VendorPollResult {
  vendor: VendorName
  status: 'running' | 'succeeded' | 'failed'
  fineTunedModelId: string | null
  error: string | null
  rawStatus: string
}

export interface VendorAdapter {
  submit(db: SupabaseClient, job: FineTuningJobRow): Promise<VendorSubmitResult>
  poll(db: SupabaseClient, job: FineTuningJobRow): Promise<VendorPollResult>
  predict(db: SupabaseClient, job: FineTuningJobRow, input: ExportSampleRow): Promise<{
    category: string
    severity: string | null
    summary: string | null
    component: string | null
  }>
}

export function resolveVendor(baseModel: string): VendorName {
  const lc = baseModel.toLowerCase()
  if (lc.startsWith('gpt-') || lc.startsWith('openai:') || lc.includes('ft:gpt-')) return 'openai'
  if (lc.startsWith('claude-') || lc.startsWith('anthropic:')) return 'anthropic'
  if (lc.startsWith('bedrock:')) return 'bedrock'
  // Test-only escape hatch: base_model='stub:...' maps to the stub adapter,
  // but getAdapter() will still throw unless MUSHI_ALLOW_STUB_FINE_TUNE=1.
  if (lc.startsWith('stub:') || lc === 'stub') return 'stub'
  // Unknown base_model — throw early with an actionable error.
  throw new Error(
    `[fine-tune] Cannot resolve vendor for base_model="${baseModel}". ` +
    'Use a known prefix: openai:gpt-4o-mini, openai:gpt-3.5-turbo-0125, ' +
    'bedrock:<model-id>, claude-<model-id>, etc. ' +
    'Mushi never falls back to stub in production.',
  )
}

export function getAdapter(vendor: VendorName): VendorAdapter {
  switch (vendor) {
    case 'openai': return openaiAdapter
    case 'anthropic': return makeUnsupportedAdapter(
      'anthropic',
      'Anthropic\'s direct fine-tuning API is not publicly available (May 2026). ' +
      'To fine-tune a Claude model use Amazon Bedrock (base_model="bedrock:anthropic.claude-3-haiku-20240307-v1:0") — ' +
      'Bedrock fine-tuning for Claude 3 Haiku is GA. ' +
      'If you need direct Anthropic fine-tuning, contact your Anthropic account team. ' +
      'See: https://anthropic.com/news/fine-tune-claude-3-haiku',
    )
    case 'bedrock': {
      if (Deno.env.get('MUSHI_BEDROCK_FINETUNE_ENABLED') !== '1') {
        return makeUnsupportedAdapter(
          'bedrock',
          'AWS Bedrock fine-tuning is not yet activated for this deployment. ' +
          'Bedrock fine-tuning (CreateModelCustomizationJob) is GA and supports Claude 3 Haiku. ' +
          'To enable: (1) set MUSHI_BEDROCK_FINETUNE_ENABLED=1, ' +
          '(2) configure AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (or IAM role) in project BYOK settings, ' +
          '(3) set BEDROCK_OUTPUT_S3_URI to an S3 bucket path for training outputs. ' +
          'See: https://docs.aws.amazon.com/bedrock/latest/userguide/model-customization-submit.html',
        )
      }
      return bedrockAdapter
    }
    case 'stub':
    default:
      // Guard the stub so it never silently powers a real fine-tune job.
      // In production the caller would have resolved a real vendor from
      // `resolveVendor(baseModel)` — `stub` only appears when base_model
      // starts with `stub:`. Allowing it in production would silently
      // "succeed" and promote a model that was never actually trained.
      if (Deno.env.get('MUSHI_ALLOW_STUB_FINE_TUNE') !== '1') {
        throw new Error(
          '[fine-tune] stub adapter is disabled in production. ' +
          'Use a real base_model (openai:gpt-4o-mini, openai:gpt-3.5-turbo-0125, etc.) ' +
          'and set the corresponding BYOK env var (OPENAI_API_KEY / BEDROCK_* / VERTEX_*). ' +
          'Set MUSHI_ALLOW_STUB_FINE_TUNE=1 only in test environments.',
        )
      }
      return stubAdapter
  }
}

// ---------------------------------------------------------------------------
// OpenAI adapter — real vendor worker.
// ---------------------------------------------------------------------------

const OPENAI_BASE = 'https://api.openai.com/v1'

async function resolveOpenAIKey(db: SupabaseClient, projectId: string): Promise<string> {
  // Prefer per-project BYOK key; fall back to env for self-hosted / dev.
  // `resolveLlmKey` returns `{ key, source, hint, baseUrl? } | null` — we
  // care about the raw token here, but the `source` is implicit (audit log
  // happens upstream in the route that initiates the fine-tune).
  const resolved = await resolveLlmKey(db, projectId, 'openai').catch(() => null)
  if (resolved?.key) return resolved.key
  // Deno-only: callers are Edge Functions. The legacy `process.env` branch
  // would never resolve at runtime (no Node global) and was a latent bug.
  const env = Deno.env.get('OPENAI_API_KEY') ?? ''
  if (!env) {
    throw new Error(
      'No OpenAI API key available — configure BYOK in Settings or set OPENAI_API_KEY env var',
    )
  }
  return env
}

async function openaiFetch(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${key}`,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI ${path} ${res.status}: ${body.slice(0, 500)}`)
  }
  return res
}

const openaiAdapter: VendorAdapter = {
  async submit(db, job) {
    if (!job.export_storage_path) throw new Error('job has no export_storage_path — run export step first')

    const apiKey = await resolveOpenAIKey(db, job.project_id)

    // Pull the JSONL back out of Supabase storage and stream it to OpenAI's
    // /files endpoint. Edge Functions have strict memory limits (~128 MB),
    // so fine-tune datasets bigger than that must be uploaded out-of-band —
    // we surface a clean error rather than OOM silently.
    const { data: dl, error: dlErr } = await db.storage.from('mushi-private').download(job.export_storage_path)
    if (dlErr || !dl) throw new Error(`download of ${job.export_storage_path} failed: ${dlErr?.message}`)
    if (dl.size > 80 * 1024 * 1024) {
      throw new Error(`export (${dl.size} bytes) exceeds Edge Function upload budget; rebuild as a multi-shard export`)
    }

    const form = new FormData()
    form.append('purpose', 'fine-tune')
    form.append('file', dl, `${job.id}.jsonl`)
    const fileRes = await openaiFetch(apiKey, '/files', { method: 'POST', body: form })
    const fileJson = await fileRes.json() as { id: string }

    // Strip any provider prefix (`openai:gpt-4o-mini` → `gpt-4o-mini`).
    const baseModel = job.base_model.replace(/^openai:/, '')

    const ftRes = await openaiFetch(apiKey, '/fine_tuning/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        training_file: fileJson.id,
        model: baseModel,
        suffix: `mushi-${job.project_id.slice(0, 8)}`,
      }),
    })
    const ftJson = await ftRes.json() as { id: string; status: string }

    await db.from('fine_tuning_jobs').update({
      status: 'training',
      metrics: { ...(job.metrics ?? {}), vendor: 'openai', vendor_job_id: ftJson.id, vendor_file_id: fileJson.id },
      started_at: new Date().toISOString(),
    }).eq('id', job.id)

    return { vendor: 'openai', vendorJobId: ftJson.id, status: ftJson.status }
  },

  async poll(db, job) {
    const vendorJobId = (job.metrics as Record<string, unknown> | null)?.vendor_job_id as string | undefined
    if (!vendorJobId) throw new Error('no vendor_job_id on job — submit has not run')
    const apiKey = await resolveOpenAIKey(db, job.project_id)
    const res = await openaiFetch(apiKey, `/fine_tuning/jobs/${vendorJobId}`)
    const body = await res.json() as { status: string; fine_tuned_model: string | null; error?: { message?: string } | null }

    if (body.status === 'succeeded') {
      return { vendor: 'openai', status: 'succeeded', fineTunedModelId: body.fine_tuned_model, error: null, rawStatus: body.status }
    }
    if (body.status === 'failed' || body.status === 'cancelled') {
      return { vendor: 'openai', status: 'failed', fineTunedModelId: null, error: body.error?.message ?? body.status, rawStatus: body.status }
    }
    return { vendor: 'openai', status: 'running', fineTunedModelId: null, error: null, rawStatus: body.status }
  },

  async predict(db, job, input) {
    const modelId = job.fine_tuned_model_id
    if (!modelId) throw new Error('job.fine_tuned_model_id is empty — cannot predict without a trained model')

    const apiKey = await resolveOpenAIKey(db, job.project_id)
    const res = await openaiFetch(apiKey, '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'user',
            content: `Classify the following user-reported issue.\n\nDescription: ${input.description}\nUser category: ${input.user_category}\nUser intent: ${input.user_intent ?? 'unspecified'}`,
          },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    })
    const body = await res.json() as { choices: Array<{ message: { content: string } }> }
    const content = body.choices?.[0]?.message?.content ?? '{}'

    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      return {
        category: String(parsed.category ?? 'unknown'),
        severity: parsed.severity ? String(parsed.severity) : null,
        summary: parsed.summary ? String(parsed.summary) : null,
        component: parsed.component ? String(parsed.component) : null,
      }
    } catch {
      return { category: 'unknown', severity: null, summary: null, component: null }
    }
  },
}

// ---------------------------------------------------------------------------
// Stub adapter — kept only for offline tests (MUSHI_ALLOW_STUB_FINE_TUNE=1).
//
// NEVER use this in production. The stub mirrors ground-truth labels —
// validation will always pass and the "model" never actually trains.
// getAdapter() throws before returning this unless the env var is set.
// ---------------------------------------------------------------------------

const stubAdapter: VendorAdapter = {
  async submit(_db, job) {
    return { vendor: 'stub', vendorJobId: `stub-${job.id}`, status: 'training' }
  },
  async poll(_db, _job) {
    return { vendor: 'stub', status: 'succeeded', fineTunedModelId: 'stub-model', error: null, rawStatus: 'succeeded' }
  },
  async predict(_db, _job, input) {
    return { category: input.category, severity: input.severity, summary: input.summary, component: input.component }
  },
}

function makeUnsupportedAdapter(name: VendorName, message: string): VendorAdapter {
  const err = () => { throw new Error(`[fine-tune vendor=${name}] ${message}`) }
  return { submit: err, poll: err, predict: err }
}

// ---------------------------------------------------------------------------
// Bedrock adapter — GA as of Nov 2024 (Claude 3 Haiku fine-tuning).
//
// Gated behind MUSHI_BEDROCK_FINETUNE_ENABLED=1 because it requires:
//   - AWS credentials (ACCESS_KEY_ID + SECRET_ACCESS_KEY or IAM role)
//   - An S3 bucket for training data upload and output (BEDROCK_OUTPUT_S3_URI)
//   - An IAM role that Bedrock can assume (BEDROCK_ROLE_ARN)
//
// Uses the Bedrock REST API directly (no AWS SDK dependency in Deno) via
// SigV4 signing. Supports customizationType: FINE_TUNING.
// ---------------------------------------------------------------------------

const BEDROCK_REGION = Deno.env.get('AWS_REGION') ?? Deno.env.get('BEDROCK_REGION') ?? 'us-east-1'
const BEDROCK_ENDPOINT = `https://bedrock.${BEDROCK_REGION}.amazonaws.com`

async function bedrockFetch(
  path: string,
  method: string,
  body?: unknown,
): Promise<Response> {
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID') ?? ''
  const secretKey = Deno.env.get('AWS_SECRET_ACCESS_KEY') ?? ''
  const sessionToken = Deno.env.get('AWS_SESSION_TOKEN')

  if (!accessKeyId || !secretKey) {
    throw new Error(
      '[bedrock] AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set. ' +
      'For self-hosted deployments, add them to your project BYOK settings or environment.',
    )
  }

  const url = `${BEDROCK_ENDPOINT}${path}`
  const bodyStr = body ? JSON.stringify(body) : ''
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)
  const service = 'bedrock'

  // SigV4 signing (minimal implementation for Deno edge functions).
  const encoder = new TextEncoder()
  const hash = async (data: string | Uint8Array) => {
    const buf = await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data)
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
  }
  const hmac = async (key: Uint8Array | string, data: string) => {
    const k = typeof key === 'string' ? encoder.encode(key) : key
    const cryptoKey = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
    return new Uint8Array(sig)
  }

  const payloadHash = await hash(bodyStr)
  const headers: Record<string, string> = {
    host: new URL(BEDROCK_ENDPOINT).host,
    'x-amz-date': amzDate,
    'content-type': 'application/json',
    'x-amz-content-sha256': payloadHash,
  }
  if (sessionToken) headers['x-amz-security-token'] = sessionToken

  const signedHeaders = Object.keys(headers).sort().join(';')
  const canonicalHeaders = Object.keys(headers).sort().map(k => `${k}:${headers[k]}`).join('\n') + '\n'
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credScope = `${dateStamp}/${BEDROCK_REGION}/${service}/aws4_request`
  const strToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await hash(canonicalRequest)].join('\n')

  const signingKey = await (async () => {
    let k = await hmac(`AWS4${secretKey}`, dateStamp)
    k = await hmac(k, BEDROCK_REGION)
    k = await hmac(k, service)
    k = await hmac(k, 'aws4_request')
    return k
  })()
  const sigBytes = await hmac(signingKey, strToSign)
  const signature = Array.from(sigBytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const authHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(url, {
    method,
    headers: { ...headers, authorization: authHeader },
    body: bodyStr || undefined,
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Bedrock ${method} ${path} ${res.status}: ${txt.slice(0, 400)}`)
  }
  return res
}

const bedrockAdapter: VendorAdapter = {
  async submit(_db, job) {
    const roleArn = Deno.env.get('BEDROCK_ROLE_ARN')
    const outputS3 = Deno.env.get('BEDROCK_OUTPUT_S3_URI')
    if (!roleArn) throw new Error('[bedrock] BEDROCK_ROLE_ARN not set — Bedrock needs an IAM role to access your S3 data')
    if (!outputS3) throw new Error('[bedrock] BEDROCK_OUTPUT_S3_URI not set — specify an s3://bucket/prefix/ for model outputs')

    const jobName = `mushi-ft-${job.id.slice(0, 8)}-${Date.now()}`
    const res = await bedrockFetch('/model-customization-jobs', 'POST', {
      jobName,
      customModelName: `mushi-${job.id.slice(0, 8)}`,
      roleArn,
      baseModelIdentifier: job.base_model.replace(/^bedrock:/, ''),
      customizationType: 'FINE_TUNING',
      trainingDataConfig: {
        s3Uri: job.export_storage_path
          ? `s3://${job.export_storage_path}`
          : (() => { throw new Error('[bedrock] job has no export_storage_path — run export step first') })(),
      },
      outputDataConfig: { s3Uri: outputS3 },
      hyperParameters: { epochCount: '1', batchSize: '8', learningRateMultiplier: '1.0' },
    })
    const json = await res.json() as { jobArn?: string }
    const jobArn = json.jobArn ?? ''
    return { vendor: 'bedrock', vendorJobId: jobArn, status: 'training' }
  },

  async poll(_db, job) {
    if (!job.vendor_job_id) throw new Error('[bedrock] vendor_job_id (jobArn) not set')
    const jobArnEncoded = encodeURIComponent(job.vendor_job_id)
    const res = await bedrockFetch(`/model-customization-jobs/${jobArnEncoded}`, 'GET')
    const json = await res.json() as { status?: string; outputModelArn?: string; failureMessage?: string }
    const rawStatus = json.status ?? 'Unknown'
    const succeeded = rawStatus === 'Completed'
    const failed = rawStatus === 'Failed' || rawStatus === 'Stopped'
    return {
      vendor: 'bedrock',
      status: succeeded ? 'succeeded' : failed ? 'failed' : 'training',
      fineTunedModelId: json.outputModelArn ?? null,
      error: json.failureMessage ?? null,
      rawStatus,
    }
  },

  async predict(_db, job, input) {
    if (!job.fine_tuned_model_id) throw new Error('[bedrock] fine_tuned_model_id not set — poll until succeeded')
    const modelId = encodeURIComponent(job.fine_tuned_model_id)
    const res = await bedrockFetch(`/model/${modelId}/invoke`, 'POST', {
      prompt: `\n\nHuman: ${input.userMessage ?? 'classify'}\n\nAssistant:`,
      max_tokens_to_sample: 256,
    })
    const json = await res.json() as { completion?: string }
    try {
      const parsed = JSON.parse(json.completion ?? '{}')
      return { category: parsed.category, severity: parsed.severity, summary: parsed.summary, component: parsed.component }
    } catch {
      return { category: 'unknown', severity: null, summary: json.completion?.slice(0, 200) ?? null, component: null }
    }
  },
}
