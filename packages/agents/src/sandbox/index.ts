/**
 * FILE: packages/agents/src/sandbox/index.ts
 * PURPOSE: Public surface for the sandbox sub-package (V5.3 §2.10, M6).
 *          Resolves provider name -> SandboxProvider, with safety rails.
 */

import { LocalNoopSandboxProvider } from './local-noop.js'
import { createE2BProvider } from './e2b.js'
import { createModalProvider } from './modal.js'
import { createCloudflareProvider } from './cloudflare.js'
import { SandboxError, type SandboxProvider, KNOWN_SANDBOX_PROVIDERS } from './types.js'

/**
 * Re-export the known-providers list so consumers can branch on what
 * Mushi ships first-party adapters for without re-stating the list.
 */
export { KNOWN_SANDBOX_PROVIDERS }
export type { KnownSandboxProvider } from './types.js'

/**
 * Provider-name type. Was a closed string-literal union; now an open
 * string so external sandboxes (Daytona, Sealos, internal corp envs)
 * can register without forking this type. The orchestrator narrows
 * back to a real provider at `resolveSandboxProvider` call time —
 * unknown names look up the third-party registry first, then throw
 * `PROVIDER_UNAVAILABLE`.
 */
export type SandboxProviderName = SandboxProvider['name']

/**
 * Pluggable third-party adapter registry. Lets external orchestrators
 * register their own provider factory at runtime — keyed by the same
 * stable id that lands in `project_settings.sandbox_provider`. Mushi's
 * resolver consults this registry BEFORE throwing PROVIDER_UNAVAILABLE
 * so a customer with `sandbox_provider='daytona-corp'` can wire a real
 * provider without touching this package.
 */
type ThirdPartyFactory = (opts: { apiKey?: string }) => SandboxProvider
const thirdPartyRegistry = new Map<string, ThirdPartyFactory>()

export function registerSandboxProvider(name: string, factory: ThirdPartyFactory): void {
  if (KNOWN_SANDBOX_PROVIDERS.includes(name as KnownSandboxProvider)) {
    throw new Error(
      `registerSandboxProvider: "${name}" is a first-party provider and cannot be overridden`,
    )
  }
  thirdPartyRegistry.set(name, factory)
}

export function unregisterSandboxProvider(name: string): boolean {
  return thirdPartyRegistry.delete(name)
}

type KnownSandboxProvider = (typeof KNOWN_SANDBOX_PROVIDERS)[number]

export interface ResolveProviderOptions {
  /** Stable provider id, normally read from project_settings.sandbox_provider. */
  name: SandboxProviderName
  /** Optional API key for managed providers. */
  apiKey?: string
  /** When true, allow local-noop in production (CI, dry-run, demos). */
  allowLocalInProduction?: boolean
}

export function resolveSandboxProvider(opts: ResolveProviderOptions): SandboxProvider {
  if (opts.name === 'local-noop') {
    if (process.env.NODE_ENV === 'production' && !opts.allowLocalInProduction) {
      throw new SandboxError(
        'local-noop sandbox is not allowed in production; pick e2b/modal/cloudflare',
        'POLICY_VIOLATION',
      )
    }
    return LocalNoopSandboxProvider
  }
  if (opts.name === 'e2b') {
    return createE2BProvider({ apiKey: opts.apiKey })
  }
  if (opts.name === 'modal') {
    return createModalProvider({ apiKey: opts.apiKey })
  }
  if (opts.name === 'cloudflare') {
    return createCloudflareProvider({ apiKey: opts.apiKey })
  }
  // Third-party providers registered via `registerSandboxProvider`.
  const factory = thirdPartyRegistry.get(opts.name)
  if (factory) {
    return factory({ apiKey: opts.apiKey })
  }
  throw new SandboxError(
    `Sandbox provider "${opts.name}" not recognised. ` +
      `First-party: ${KNOWN_SANDBOX_PROVIDERS.join(', ')}. ` +
      `For third-party providers, call registerSandboxProvider("${opts.name}", factory) ` +
      `before dispatching a fix.`,
    'PROVIDER_UNAVAILABLE',
  )
}

export { LocalNoopSandboxProvider } from './local-noop.js'
export { createE2BProvider } from './e2b.js'
export { createModalProvider } from './modal.js'
export { createCloudflareProvider } from './cloudflare.js'
export { buildSandboxConfig } from './policy.js'
export type { BuildSandboxConfigOptions } from './policy.js'
export {
  SandboxError,
  type Sandbox,
  type SandboxAuditEvent,
  type SandboxConfig,
  type SandboxExecOptions,
  type SandboxExecResult,
  type SandboxFileWrite,
  type SandboxFsPolicy,
  type SandboxNetworkPolicy,
  type SandboxResourceLimits,
  type SandboxProvider,
} from './types.js'
