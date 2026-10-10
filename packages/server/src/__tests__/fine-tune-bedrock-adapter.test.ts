/**
 * The Bedrock fine-tune adapter returned the jobArn from submit() but never
 * stored it, so poll() always threw "did submit() run?" and jobs stuck; and
 * predict() called InvokeModel on the control-plane host
 * (bedrock.<region>) instead of bedrock-runtime.<region>.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({ reportError: vi.fn(), reportMessage: vi.fn() }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({ resolveLlmKey: vi.fn() }))

const envVars: Record<string, string> = {
  MUSHI_BEDROCK_FINETUNE_ENABLED: '1',
  AWS_REGION: 'us-west-2',
  AWS_ACCESS_KEY_ID: 'AKIATEST',
  AWS_SECRET_ACCESS_KEY: 'secret',
  BEDROCK_ROLE_ARN: 'arn:aws:iam::1:role/r',
  BEDROCK_OUTPUT_S3_URI: 's3://bucket/out/',
}
const fetchMock = vi.fn()

beforeEach(() => {
  ;(globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => envVars[k] } }
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const job = {
  id: 'job-12345678', project_id: 'p1', base_model: 'bedrock:anthropic.claude-3-haiku-20240307-v1:0',
  export_storage_path: 'bucket/train.jsonl', metrics: { samples: 10 }, fine_tuned_model_id: 'arn:aws:bedrock:us-west-2:1:custom-model/x',
}

describe('bedrock fine-tune adapter', () => {
  it('submit() stores the jobArn where poll() reads it', async () => {
    const { getAdapter } = await import('../../supabase/functions/_shared/fine-tune-vendor.ts')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ jobArn: 'arn:job/1' }), { status: 200 }))
    const updates: unknown[] = []
    const db = { from: () => ({ update: (p: unknown) => { updates.push(p); return { eq: async () => ({ error: null }) } } }) }
    const out = await getAdapter('bedrock').submit(db as never, job as never)
    expect(out.vendorJobId).toBe('arn:job/1')
    expect(updates[0]).toMatchObject({ status: 'training', metrics: { samples: 10, vendor: 'bedrock', vendor_job_id: 'arn:job/1' } })
  })

  it('predict() calls InvokeModel on the bedrock-runtime host', async () => {
    const { getAdapter } = await import('../../supabase/functions/_shared/fine-tune-vendor.ts')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ completion: '{"category":"bug"}' }), { status: 200 }))
    await getAdapter('bedrock').predict({} as never, job as never, { description: 'd' } as never)
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.host).toBe('bedrock-runtime.us-west-2.amazonaws.com')
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ host: 'bedrock-runtime.us-west-2.amazonaws.com' })
  })
})
