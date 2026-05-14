/**
 * FILE: packages/agents/src/browser/types.ts
 * PURPOSE: Provider-agnostic interface for browser automation providers used
 *          by the QA Coverage suite (qa-story-runner edge function).
 *
 * OVERVIEW:
 * - BrowserProvider: the contract each adapter must fulfil — accepts a
 *   QaStory + execution context and returns a BrowserRunResult.
 * - BrowserRunResult: structured output containing status, latency,
 *   collected evidence artefacts, assertion failures, and an optional
 *   provider session URL (e.g. Browserbase replay link).
 * - QaStory: minimal story shape the runner passes in — mirrors qa_stories
 *   columns without the full DB row type so providers stay portable.
 * - KNOWN_BROWSER_PROVIDERS / KnownBrowserProvider: closed list of
 *   first-party adapters, open union for third-party ones.
 *
 * NOTES:
 * - Mirrors packages/agents/src/sandbox/types.ts shape so contributors
 *   who know the sandbox abstraction immediately understand this one.
 * - Evidence artefacts are returned as Buffers — the runner is responsible
 *   for uploading them to Supabase Storage and writing qa_story_evidence rows.
 * - BYOK keys are resolved by the caller before passing BrowserRunContext;
 *   providers never touch the key store directly.
 */

export interface QaStory {
  id: string
  projectId: string
  name: string
  prompt?: string | null
  script?: string | null
  scriptLang: 'playwright-ts' | 'stagehand' | 'firecrawl-actions'
  browserProvider: string
  captureVideo: boolean
  byokProvider?: string | null
}

export interface BrowserRunContext {
  /** Resolved API key for the provider (e.g. Browserbase API key). */
  apiKey?: string
  /** Target URL the story should run against. Defaults to project's base URL. */
  baseUrl?: string
  /** Wall-clock timeout in milliseconds. */
  timeoutMs?: number
  /** Extra headers to inject into every request (e.g. auth cookies). */
  headers?: Record<string, string>
}

export interface EvidenceArtefact {
  /** Evidence type — maps to qa_story_evidence.kind. */
  kind: 'screenshot' | 'console' | 'network' | 'video' | 'trace' | 'dom' | 'har'
  /** Raw bytes ready for upload to Supabase Storage. */
  data: Uint8Array | Buffer
  /** MIME type, e.g. `image/png`, `text/plain`, `application/json`. */
  mime: string
  /** Optional human label for the step this evidence was captured at. */
  stepLabel?: string
}

export interface AssertionFailure {
  step: string
  expected: string | null
  actual: string | null
}

export type RunStatus = 'passed' | 'failed' | 'error' | 'timeout' | 'skipped'

export interface BrowserRunResult {
  status: RunStatus
  latencyMs: number
  evidence: EvidenceArtefact[]
  assertionFailures: AssertionFailure[]
  /** Provider-specific session URL for replay (e.g. Browserbase session URL). */
  providerSessionUrl?: string
  /** Short LLM-friendly summary of what happened. */
  summary?: string
  errorMessage?: string
}

/**
 * Contract every browser automation adapter must implement.
 */
export interface BrowserProvider {
  /**
   * Stable adapter identifier persisted to qa_story_runs.provider.
   * First-party: one of KNOWN_BROWSER_PROVIDERS.
   * Third-party: any lowercase-kebab string.
   */
  readonly name: KnownBrowserProvider | (string & {})
  /**
   * Execute the story script and return structured results + evidence.
   * Implementations MUST NOT throw; surface errors as status='error'.
   */
  run(story: QaStory, ctx: BrowserRunContext): Promise<BrowserRunResult>
}

export const KNOWN_BROWSER_PROVIDERS = ['local', 'browserbase', 'firecrawl_actions'] as const
export type KnownBrowserProvider = (typeof KNOWN_BROWSER_PROVIDERS)[number]

export class BrowserProviderError extends Error {
  constructor(
    message: string,
    public readonly code: 'PROVIDER_UNAVAILABLE' | 'SCRIPT_ERROR' | 'TIMEOUT' | 'ASSERTION_FAILED' | 'INTERNAL',
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'BrowserProviderError'
  }
}
