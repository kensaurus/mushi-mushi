/**
 * FILE: packages/server/supabase/functions/_shared/fine-tune-base-model.ts
 * PURPOSE: Map a fine-tuning job's base_model to its vendor, and decide at
 *          create time whether a job for that model can ever train. Pure (no
 *          env reads), so api routes can import it statically; the adapters
 *          that need credentials stay in fine-tune-vendor.ts.
 */

/** Production vendors. `stub` is test-only; getAdapter() refuses it unless
 *  MUSHI_ALLOW_STUB_FINE_TUNE=1 is set.  */
export type VendorName = 'openai' | 'anthropic' | 'bedrock' | 'stub'

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

/**
 * null when a job may be created for `baseModel`, else why not. Checked at
 * create time so the console cannot register a job that is certain to fail
 * at submit (unknown prefix, or Anthropic direct, which has no public
 * fine-tuning API). Bedrock stays allowed: it only needs operator setup.
 */
export function fineTuneBaseModelError(baseModel: unknown): string | null {
  if (typeof baseModel !== 'string' || !baseModel.trim()) return 'Pick a vendor and base model.'
  let vendor: VendorName
  try {
    vendor = resolveVendor(baseModel)
  } catch {
    return 'Unknown base model. Use an OpenAI (openai:…) or Bedrock (bedrock:…) model.'
  }
  if (vendor === 'anthropic') {
    return 'Anthropic has no public fine-tuning API. To fine-tune Claude, pick Bedrock (Claude 3 Haiku).'
  }
  if (vendor === 'stub') return 'The stub vendor is for tests only.'
  return null
}
