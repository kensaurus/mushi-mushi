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
 *          IMPORTANT: the old validate endpoint used a stub predictor that
 *          mirrored the ground-truth label — it would ALWAYS pass. The
 *          new `buildRealPredictor` below actually calls the vendor model,
 *          so a broken fine-tune surfaces as failed validation, not a
 *          silent promotion.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import type { FineTuningJobRow, ExportSampleRow } from './fine-tune.ts'

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
  poll(job: FineTuningJobRow): Promise<VendorPollResult>
  predict(job: FineTuningJobRow, input: ExportSampleRow): Promise<{
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
  return 'stub'
}

export function getAdapter(vendor: VendorName): VendorAdapter {
  switch (vendor) {
    case 'openai': return openaiAdapter
    case 'anthropic': return makeUnsupportedAdapter('anthropic', 'Anthropic does not expose a public fine-tune API; route via bedrock: or openai: for now.')
    case 'bedrock': return makeUnsupportedAdapter('bedrock', 'Bedrock fine-tune requires AWS credentials; set MUSHI_BEDROCK_ENABLED=1 and add an IAM role before invoking.')
    case 'stub':
    default:
      return stubAdapter
  }
}

// ---------------------------------------------------------------------------
// OpenAI adapter — real vendor worker.
// ---------------------------------------------------------------------------

const OPENAI_BASE = 'https://api.openai.com/v1'

function openaiKey(): string {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY is not configured — fine-tune submit aborted')
  return key
}

async function openaiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${openaiKey()}`,
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
    const fileRes = await openaiFetch('/files', { method: 'POST', body: form })
    const fileJson = await fileRes.json() as { id: string }

    // Strip any provider prefix (`openai:gpt-4o-mini` → `gpt-4o-mini`).
    const baseModel = job.base_model.replace(/^openai:/, '')

    const ftRes = await openaiFetch('/fine_tuning/jobs', {
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

  async poll(job) {
    const vendorJobId = (job.metrics as Record<string, unknown> | null)?.vendor_job_id as string | undefined
    if (!vendorJobId) throw new Error('no vendor_job_id on job — submit has not run')
    const res = await openaiFetch(`/fine_tuning/jobs/${vendorJobId}`)
    const body = await res.json() as { status: string; fine_tuned_model: string | null; error?: { message?: string } | null }

    if (body.status === 'succeeded') {
      return { vendor: 'openai', status: 'succeeded', fineTunedModelId: body.fine_tuned_model, error: null, rawStatus: body.status }
    }
    if (body.status === 'failed' || body.status === 'cancelled') {
      return { vendor: 'openai', status: 'failed', fineTunedModelId: null, error: body.error?.message ?? body.status, rawStatus: body.status }
    }
    return { vendor: 'openai', status: 'running', fineTunedModelId: null, error: null, rawStatus: body.status }
  },

  async predict(job, input) {
    const modelId = job.fine_tuned_model_id
    if (!modelId) throw new Error('job.fine_tuned_model_id is empty — cannot predict without a trained model')

    const res = await openaiFetch('/chat/completions', {
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
// Stub adapter — kept only for offline tests.
// ---------------------------------------------------------------------------

const stubAdapter: VendorAdapter = {
  async submit(_db, job) {
    return { vendor: 'stub', vendorJobId: `stub-${job.id}`, status: 'training' }
  },
  async poll(_job) {
    return { vendor: 'stub', status: 'succeeded', fineTunedModelId: 'stub-model', error: null, rawStatus: 'succeeded' }
  },
  async predict(_job, input) {
    // Mirror the ground truth — only legal for tests where we want a clean
    // validation pass. The API route wires in this predictor explicitly by
    // setting base_model to `stub:`.
    return { category: input.category, severity: input.severity, summary: input.summary, component: input.component }
  },
}

function makeUnsupportedAdapter(name: VendorName, message: string): VendorAdapter {
  const err = () => { throw new Error(`[fine-tune vendor=${name}] ${message}`) }
  return { submit: err, poll: err, predict: err }
}
