/**
 * FILE: packages/agents/src/browser/index.ts
 * PURPOSE: Public surface of the browser-provider abstraction — export
 *          providers, the registry, and the resolver for qa-story-runner.
 *
 * USAGE:
 *   import { resolveBrowserProvider } from '@mushi-mushi/agents/browser'
 *   const provider = resolveBrowserProvider('browserbase')
 *   const result = await provider.run(story, { apiKey: '...' })
 */

export type {
  BrowserProvider,
  BrowserRunResult,
  BrowserRunContext,
  QaStory,
  EvidenceArtefact,
  AssertionFailure,
  RunStatus,
  KnownBrowserProvider,
} from './types'
export { KNOWN_BROWSER_PROVIDERS, BrowserProviderError } from './types'

import { LocalPlaywrightProvider } from './local-playwright'
import { BrowserbaseProvider } from './browserbase'
import { FirecrawlActionsProvider } from './firecrawl-actions'
import type { BrowserProvider, KnownBrowserProvider } from './types'

const REGISTRY = new Map<string, BrowserProvider>([
  [LocalPlaywrightProvider.name, LocalPlaywrightProvider],
  [BrowserbaseProvider.name, BrowserbaseProvider],
  [FirecrawlActionsProvider.name, FirecrawlActionsProvider],
])

/** Register a third-party browser provider at runtime. */
export function registerBrowserProvider(provider: BrowserProvider): void {
  REGISTRY.set(provider.name, provider)
}

/**
 * Resolve a browser provider by name.
 * Falls back to the `local` provider when the requested name is unknown
 * so stories always have a runnable fallback even if BYOK isn't configured.
 */
export function resolveBrowserProvider(name: KnownBrowserProvider | (string & {})): BrowserProvider {
  return REGISTRY.get(name) ?? LocalPlaywrightProvider
}

export { LocalPlaywrightProvider, BrowserbaseProvider, FirecrawlActionsProvider }
