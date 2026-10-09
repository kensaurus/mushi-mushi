/**
 * FILE: packages/server/supabase/functions/_shared/store-ops-live.ts
 * PURPOSE: The live I/O behind runStoreReview: read-only GitHub reads at the
 *          head SHA, public store pages through publicFetch, and the claim
 *          extraction through the project's own AI key (BYOK: Anthropic
 *          first, OpenAI fallback). The listing text is wrapped as untrusted
 *          data in the prompt and the answer is schema-validated.
 */

import { openAiProvider } from './openai-compat.ts'
import { getDefaultHead, listTree, readBlobsGraphql, readRepoBytes, resolveRecipeRepo, type RecipeRepo } from './recipe-github.ts'
import { publicFetch } from './safe-fetch.ts'
import { withAnthropicOrOpenAi } from './llm-failover.ts'
import { claudeGenerateObject } from './claude-messages.ts'
import { generateValidatedObject } from './structured-output.ts'
import { STORE_REVIEW_EFFORT, STORE_REVIEW_FALLBACK, STORE_REVIEW_MODEL } from './models.ts'
import { buildClaimExtractionPrompt, claimExtractionSchema, type ExtractedClaim } from './store-review.ts'
import { logLlmInvocation } from './telemetry.ts'
import type { StoreOpsDeps } from './store-ops.ts'

async function gh(repo: RecipeRepo, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`https://api.github.com/repos/${repo.ref.owner}/${repo.ref.repo}${path}`, {
    headers: { Authorization: `Bearer ${repo.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

export const liveStoreOpsDeps: StoreOpsDeps = {
  resolveRepo: resolveRecipeRepo,
  getDefaultHead,
  listTree,
  readBlobs: readBlobsGraphql,
  readBytes: readRepoBytes,
  async lastChanged(repo, path) {
    const r = await gh(repo, `/commits?path=${encodeURIComponent(path)}&per_page=1`)
    return r.status === 200 && Array.isArray(r.body) ? ((r.body[0] as { commit?: { committer?: { date?: string } } } | undefined)?.commit?.committer?.date ?? null) : null
  },
  async repoInfo(repo) {
    const r = await gh(repo, '')
    if (r.status !== 200) return { public: null, license: null }
    const b = r.body as { private?: boolean; license?: { spdx_id?: string } | null } | null
    const spdx = b?.license?.spdx_id
    return { public: b?.private === false, license: spdx && spdx !== 'NOASSERTION' ? spdx : null }
  },
  fetcher: (url) => publicFetch(url),
  async extractClaims(db, projectId, listingText) {
    const { system, user } = buildClaimExtractionPrompt({ listingText })
    const started = Date.now()
    const { result, usedProvider } = await withAnthropicOrOpenAi(
      db as never,
      projectId,
      (key) => claudeGenerateObject({ apiKey: key.key, model: STORE_REVIEW_MODEL, schema: claimExtractionSchema, effort: STORE_REVIEW_EFFORT, system, messages: [{ role: 'user', content: user }], maxTokens: 4000 }),
      (key) => {
        const openai = openAiProvider({ apiKey: key.key, baseURL: key.baseUrl })
        return generateValidatedObject(claimExtractionSchema, { model: openai(STORE_REVIEW_FALLBACK), system, messages: [{ role: 'user', content: user }], maxTokens: 2000 })
      },
    )
    void logLlmInvocation(db as never, {
      projectId,
      functionName: 'api',
      stage: 'store-review-claims',
      primaryModel: STORE_REVIEW_MODEL,
      usedModel: usedProvider === 'openai' ? STORE_REVIEW_FALLBACK : STORE_REVIEW_MODEL,
      fallbackUsed: usedProvider === 'openai',
      fallbackReason: null,
      status: 'success',
      latencyMs: Date.now() - started,
      inputTokens: result.usage?.promptTokens,
      outputTokens: result.usage?.completionTokens,
    })
    return (result.object as { claims?: ExtractedClaim[] }).claims ?? null
  },
  async uploadPaths(db, projectId) {
    const { data, error } = await db.from('project_codebase_files').select('file_path').eq('project_id', projectId)
      .or('content_preview.ilike.%storage.from(%,content_preview.ilike.%.upload(%,content_preview.ilike.%FormData%').limit(20)
    if (error) throw new Error(`could not read the indexed code: ${error.message}`)
    return ((data ?? []) as Array<{ file_path: string }>).map((r) => r.file_path)
  },
  now: () => new Date(),
}
