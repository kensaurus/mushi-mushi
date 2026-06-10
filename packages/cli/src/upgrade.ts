/**
 * `mushi upgrade` — bump installed @mushi-mushi/* packages to latest npm.
 */

import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { detectPackageManager, installCommand, readPackageJson } from './detect.js'
import { checkFreshness, isNewerStableVersion } from './freshness.js'

/** Strict semver guard before interpolating registry versions into shell commands. */
const SAFE_NPM_VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/

const MUSHI_PACKAGES = [
  '@mushi-mushi/web',
  '@mushi-mushi/core',
  '@mushi-mushi/react',
  '@mushi-mushi/react-native',
  '@mushi-mushi/capacitor',
  '@mushi-mushi/node',
  '@mushi-mushi/cli',
] as const

export interface UpgradePlanEntry {
  name: string
  current: string
  latest: string | null
  willUpgrade: boolean
  /** Legacy @mushi-mushi/react — suggest web migration. */
  migrateToWeb?: boolean
}

export interface UpgradePlan {
  cwd: string
  packageManager: ReturnType<typeof detectPackageManager>
  entries: UpgradePlanEntry[]
  installCmd: string | null
}

export async function planUpgrade(cwd: string): Promise<UpgradePlan> {
  const root = resolve(cwd)
  const pkg = readPackageJson(root)
  const pm = detectPackageManager(root)
  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  }

  const installed = MUSHI_PACKAGES.filter((name) => deps[name])

  const entries: UpgradePlanEntry[] = await Promise.all(
    installed.map(async (name) => {
      const current = deps[name] ?? ''
      const currentCore = current.replace(/^[\^~>=<]*/, '')
      // Non-registry specifiers (workspace:, file:, link:, git URLs, dist-tags)
      // must never be replaced with a registry version.
      if (!/^\d/.test(currentCore)) {
        return { name, current, latest: null, willUpgrade: false }
      }
      const freshness = await checkFreshness(name, currentCore, {
        timeoutMs: 4000,
        ignoreOptOut: true,
      })
      const latest = freshness?.latest ?? null
      const safeLatest = latest && SAFE_NPM_VERSION.test(latest) ? latest : null
      const willUpgrade = Boolean(freshness?.isOutdated && safeLatest)
      return {
        name,
        current,
        latest: safeLatest,
        willUpgrade,
        migrateToWeb: name === '@mushi-mushi/react' && willUpgrade,
      }
    }),
  )

  const toBump = entries.filter((e) => e.willUpgrade && e.latest).map((e) => `${e.name}@${e.latest}`)
  return {
    cwd: root,
    packageManager: pm,
    entries,
    installCmd: toBump.length > 0 ? installCommand(pm, toBump) : null,
  }
}

export interface RunUpgradeOptions {
  cwd?: string
  dryRun?: boolean
  json?: boolean
}

export interface RunUpgradeResult {
  plan: UpgradePlan
  upgraded: boolean
  message: string
}

export async function runUpgrade(opts: RunUpgradeOptions = {}): Promise<RunUpgradeResult> {
  const plan = await planUpgrade(opts.cwd ?? process.cwd())

  if (plan.entries.length === 0) {
    return {
      plan,
      upgraded: false,
      message: 'No @mushi-mushi/* packages in package.json — run `mushi init` first.',
    }
  }

  if (!plan.installCmd) {
    // Distinguish "registry unreachable" from "genuinely current": when every
    // semver-pinned entry has latest === null the freshness checks all failed.
    const semverEntries = plan.entries.filter((e) => /\d/.test(e.current))
    const allChecksFailed = semverEntries.length > 0 && semverEntries.every((e) => e.latest === null)
    return {
      plan,
      upgraded: false,
      message: allChecksFailed
        ? 'Could not reach the npm registry to check for updates — try again in a moment.'
        : 'All installed Mushi packages are already at the latest stable version.',
    }
  }

  if (opts.dryRun) {
    return { plan, upgraded: false, message: `[dry-run] Would run: ${plan.installCmd}` }
  }

  try {
    execSync(plan.installCmd, { cwd: plan.cwd, stdio: 'inherit', env: process.env })
  } catch {
    // stderr already streamed via stdio: 'inherit'
    return {
      plan,
      upgraded: false,
      message: `Install command failed — fix the error above or run it manually:\n  ${plan.installCmd}`,
    }
  }

  const reactEntry = plan.entries.find((e) => e.migrateToWeb)
  const migrateNote = reactEntry
    ? '\nNote: @mushi-mushi/react is legacy — prefer @mushi-mushi/web for Vite/Capacitor/SPA apps.'
    : ''

  return {
    plan,
    upgraded: true,
    message: `Upgraded Mushi SDK packages.\n  ${plan.installCmd}${migrateNote}`,
  }
}

/** One-line upgrade hint for admin terminal blocks. */
export function formatUpgradeHint(packageName: string, current: string, latest: string | null): string | null {
  if (!latest || !isNewerStableVersion(latest, current.replace(/^[\^~>=<]*/, ''))) return null
  return `mushi upgrade   # bump ${packageName} to v${latest}`
}
