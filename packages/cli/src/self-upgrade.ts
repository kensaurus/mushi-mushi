/**
 * FILE: packages/cli/src/self-upgrade.ts
 * PURPOSE: `mushi upgrade --self` — upgrade the globally-installed `mushi`
 *          CLI itself, as opposed to `mushi upgrade` which bumps the
 *          `@mushi-mushi/*` SDK packages in the current project.
 *
 * Matches the self-update UX of `sentry-cli`, `supabase`, and `gh`: detect how
 * the binary was installed, print the exact command, and (unless --dry-run)
 * run it. Never blocks — a registry hiccup or an unknown install method degrades
 * to a printed manual command.
 */

import { execSync } from 'node:child_process'
import { checkFreshness } from './freshness.js'
import { MUSHI_CLI_VERSION } from './version.js'
import type { PackageManager } from './detect.js'

const CLI_PACKAGE = '@mushi-mushi/cli'

/** Strict semver guard before interpolating a registry version into a shell command. */
const SAFE_NPM_VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/

export type InstallMethod = PackageManager | 'npx' | 'unknown'

/**
 * Best-effort detection of how the running `mushi` binary was installed.
 *
 * Heuristics, in priority order:
 *   1. `npm_config_user_agent` (set when invoked through a package manager) —
 *      most reliable for `npx mushi` / `pnpm dlx` transient runs.
 *   2. The absolute path of the running module — global installs live under a
 *      pm-specific prefix (`/pnpm/`, `/.bun/`, `node_modules/.bin`).
 *   3. Fall back to `npm` (the overwhelmingly common global install path).
 */
export function detectInstallMethod(
  argv1 = process.argv[1] ?? '',
  userAgent = process.env['npm_config_user_agent'] ?? '',
): InstallMethod {
  // Transient runners set the user agent AND leave a `_npx`/`dlx` path marker.
  const path = argv1.replace(/\\/g, '/').toLowerCase()
  if (path.includes('/_npx/') || path.includes('/.npm/_npx/')) return 'npx'
  if (path.includes('/dlx-') || path.includes('/pnpm/dlx')) return 'npx'

  if (userAgent.startsWith('bun')) return 'bun'
  if (userAgent.startsWith('pnpm')) return 'pnpm'
  if (userAgent.startsWith('yarn')) return 'yarn'
  if (userAgent.startsWith('npm')) return 'npm'

  // Path-based fallback for a persistently-installed global binary.
  if (path.includes('/.bun/')) return 'bun'
  if (path.includes('/pnpm/')) return 'pnpm'
  if (path.includes('/yarn/') || path.includes('/.yarn/')) return 'yarn'
  if (path.includes('/npm/') || path.includes('node_modules')) return 'npm'

  return 'unknown'
}

/**
 * Build the global self-upgrade command for a given install method + version.
 * Returns `null` for `npx` (nothing to upgrade — the next `npx` fetches latest)
 * and `unknown`.
 */
export function selfUpgradeCommand(method: InstallMethod, version: string): string | null {
  if (!SAFE_NPM_VERSION.test(version)) return null
  const spec = `${CLI_PACKAGE}@${version}`
  switch (method) {
    case 'npm':
      return `npm install -g ${spec}`
    case 'pnpm':
      return `pnpm add -g ${spec}`
    case 'yarn':
      return `yarn global add ${spec}`
    case 'bun':
      return `bun add -g ${spec}`
    case 'npx':
    case 'unknown':
    default:
      return null
  }
}

export interface SelfUpgradeResult {
  current: string
  latest: string | null
  method: InstallMethod
  command: string | null
  upgraded: boolean
  message: string
}

export interface RunSelfUpgradeOptions {
  dryRun?: boolean
  /** Injected for tests. */
  exec?: (cmd: string) => void
}

/**
 * Check npm for a newer `@mushi-mushi/cli`, and (unless dry-run) run the
 * detected global upgrade command. Never throws — every failure path returns
 * a descriptive `message` and `upgraded: false`.
 */
export async function runSelfUpgrade(opts: RunSelfUpgradeOptions = {}): Promise<SelfUpgradeResult> {
  const current = MUSHI_CLI_VERSION
  const method = detectInstallMethod()

  const freshness = await checkFreshness(CLI_PACKAGE, current, {
    timeoutMs: 4000,
    ignoreOptOut: true, // an explicit `upgrade --self` must always hit the registry
  })
  const latest = freshness?.latest ?? null
  const safeLatest = latest && SAFE_NPM_VERSION.test(latest) ? latest : null

  if (!freshness) {
    return {
      current,
      latest: null,
      method,
      command: null,
      upgraded: false,
      message: 'Could not reach the npm registry to check for a newer CLI — try again in a moment.',
    }
  }

  if (!freshness.isOutdated || !safeLatest) {
    return {
      current,
      latest,
      method,
      command: null,
      upgraded: false,
      message: `mushi CLI is already at the latest stable version (v${current}).`,
    }
  }

  const command = selfUpgradeCommand(method, safeLatest)

  if (!command) {
    const via =
      method === 'npx'
        ? 'You are running via npx — the next `npx mushi` will fetch the latest automatically.'
        : `Could not detect how the CLI was installed. Upgrade manually:\n  npm install -g ${CLI_PACKAGE}@${safeLatest}`
    return { current, latest, method, command: null, upgraded: false, message: `A newer CLI is available (v${current} → v${safeLatest}).\n${via}` }
  }

  if (opts.dryRun) {
    return {
      current,
      latest,
      method,
      command,
      upgraded: false,
      message: `[dry-run] Would run: ${command}`,
    }
  }

  try {
    const exec = opts.exec ?? ((cmd: string) => execSync(cmd, { stdio: 'inherit', env: process.env }))
    exec(command)
  } catch {
    return {
      current,
      latest,
      method,
      command,
      upgraded: false,
      message: `Self-upgrade command failed — run it manually:\n  ${command}`,
    }
  }

  return {
    current,
    latest,
    method,
    command,
    upgraded: true,
    message: `Upgraded mushi CLI: v${current} → v${safeLatest}.`,
  }
}
