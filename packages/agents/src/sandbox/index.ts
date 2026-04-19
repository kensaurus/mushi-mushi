/**
 * FILE: packages/agents/src/sandbox/index.ts
 * PURPOSE: Public surface for the sandbox sub-package (V5.3 §2.10, M6).
 *          Resolves provider name -> SandboxProvider, with safety rails.
 */

import { LocalNoopSandboxProvider } from './local-noop.js'
import { createE2BProvider } from './e2b.js'
import { createModalProvider } from './modal.js'
import { createCloudflareProvider } from './cloudflare.js'
import { SandboxError, type SandboxProvider } from './types.js'

export type SandboxProviderName = SandboxProvider['name']

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
  throw new SandboxError(
    `Sandbox provider "${opts.name}" not recognised`,
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
