/**
 * FILE: packages/agents/src/sandbox/policy.ts
 * PURPOSE: Translate a FixContext into a hardened SandboxConfig (V5.3 §2.10, M6).
 *          Enforces deny-by-default network, scoped git credentials, and the
 *          filesystem allowlist mandated by the whitepaper.
 */

import type { FixContext } from '../types.js'
import type { SandboxConfig } from './types.js'

const DEFAULT_ALLOWED_HOSTS = [
  'registry.npmjs.org',
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
]

export interface BuildSandboxConfigOptions {
  /** Image / template id known to the chosen provider. */
  image?: string
  /** Optional extra hosts to allowlist (e.g., a private registry). */
  extraAllowedHosts?: string[]
  /** Short-lived git token minted from the GitHub App installation. */
  gitToken?: string
  /** Hard wall-clock cap; overrides default if smaller. */
  timeoutSec?: number
}

export function buildSandboxConfig(
  context: FixContext,
  opts: BuildSandboxConfigOptions = {},
): SandboxConfig {
  const repoHost = safeRepoHost(context.config.repoUrl)
  return {
    projectId: context.projectId,
    reportId: context.reportId,
    image: opts.image ?? 'mushi-fix-base:latest',
    resources: {
      cpuCount: 2,
      memoryMb: 4096,
      diskMb: 10_240,
      timeoutSec: Math.min(opts.timeoutSec ?? 600, 600),
    },
    network: {
      denyByDefault: true,
      allowedHosts: dedupe([
        ...DEFAULT_ALLOWED_HOSTS,
        ...(repoHost ? [repoHost] : []),
        ...(opts.extraAllowedHosts ?? []),
      ]),
    },
    filesystem: {
      writable: ['/workspace'],
      readable: ['/workspace', '/usr/local/bin'],
      blocked: ['/etc', '/proc', '/sys', '/home', '/root/.ssh', '/var/run/secrets'],
    },
    credentials: {
      gitToken: opts.gitToken,
      env: opts.gitToken
        ? {
            GIT_ASKPASS: '/usr/local/bin/mushi-git-askpass',
            MUSHI_GIT_TOKEN: opts.gitToken,
          }
        : undefined,
    },
  }
}

function safeRepoHost(repoUrl: string): string | null {
  try {
    if (!repoUrl) return null
    const u = new URL(repoUrl.startsWith('git@') ? `https://${repoUrl.split('@')[1]?.replace(':', '/')}` : repoUrl)
    return u.host
  } catch {
    return null
  }
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
