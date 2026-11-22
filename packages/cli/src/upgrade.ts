/**
 * FILE: packages/cli/src/upgrade.ts
 * PURPOSE: `mushi upgrade` — bump the installed `mushi-mushi` package and any
 *          scoped @mushi-mushi/* packages to latest npm.
 *
 * `--check` is the CI/local freshness probe: plan only, no install.
 * Exit codes: 0 current, 1 outdated or missing, 2 registry unreachable.
 */

import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { detectPackageManager, installCommand, isLauncherOnly, readPackageJson } from './detect.js'
import { checkFreshness } from './freshness.js'

/** Strict semver guard before interpolating registry versions into shell commands. */
const SAFE_NPM_VERSION = /^\d+\.\d+\.\d+(-[\w.]+)?$/

const MUSHI_PACKAGES = [
  // The one package users install (ADR 0060). The scoped names below keep
  // working for apps that installed them before.
  'mushi-mushi',
  '@mushi-mushi/web',
  '@mushi-mushi/core',
  '@mushi-mushi/react',
  '@mushi-mushi/vue',
  '@mushi-mushi/svelte',
  '@mushi-mushi/angular',
  '@mushi-mushi/react-native',
  '@mushi-mushi/capacitor',
  '@mushi-mushi/node',
  '@mushi-mushi/cli',
] as const

interface UpgradePlanEntry {
  name: string
  current: string
  latest: string | null
  willUpgrade: boolean
}

/** Scoped SDKs whose code also ships in `mushi-mushi` (`mushi-mushi/<name>`). */
const IN_UMBRELLA = new Set([
  '@mushi-mushi/web',
  '@mushi-mushi/core',
  '@mushi-mushi/react',
  '@mushi-mushi/vue',
  '@mushi-mushi/svelte',
  '@mushi-mushi/angular',
  '@mushi-mushi/node',
])

/**
 * A pointer to the single package, shown after an upgrade of an app that
 * still installs scoped SDKs. Not a migration: the scoped names keep working
 * and keep getting updates.
 *
 * @internal Exported for tests only.
 */
export function umbrellaNote(entries: ReadonlyArray<Pick<UpgradePlanEntry, 'name'>>): string {
  if (entries.some((e) => e.name === 'mushi-mushi')) return ''
  const scoped = entries.map((e) => e.name).filter((n) => IN_UMBRELLA.has(n))
  if (scoped.length === 0) return ''
  return (
    '\nTip: the same SDK now ships as one package. ' +
    '`npm install mushi-mushi` and import from `mushi-mushi` (or `mushi-mushi/react`, `/vue`, `/svelte`, `/angular`, `/node`). ' +
    `Your ${scoped.join(', ')} install keeps working.`
  )
}

export interface UpgradePlan {
  cwd: string
  packageManager: ReturnType<typeof detectPackageManager>
  entries: UpgradePlanEntry[]
  installCmd: string | null
}

async function planUpgrade(cwd: string): Promise<UpgradePlan> {
  const root = resolve(cwd)
  const pkg = readPackageJson(root)
  const pm = detectPackageManager(root)
  const deps = {
    ...(pkg?.dependencies ?? {}),
    ...(pkg?.devDependencies ?? {}),
  }

  // `mushi-mushi@0.x` is the setup command, not the SDK: leave it as it is.
  const installed = MUSHI_PACKAGES.filter((name) => deps[name] && !isLauncherOnly(name, deps[name]))

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
  /** Plan only. Used by `mushi upgrade --check`. */
  check?: boolean
}

/** Process exit code for `mushi upgrade --check`. */
export type UpgradeCheckExit = 0 | 1 | 2

/**
 * 0 = current (or only non-registry pins).
 * 1 = outdated, or no Mushi Mushi package in package.json.
 * 2 = every semver pin failed to reach the registry (retry; do not flake CI).
 */
export function evaluateUpgradeCheckExit(plan: UpgradePlan): UpgradeCheckExit {
  if (plan.entries.length === 0) return 1
  const semverEntries = plan.entries.filter((e) => /^\d/.test(e.current.replace(/^[\^~>=<]*/, '')))
  if (semverEntries.length === 0) return 0
  if (semverEntries.every((e) => e.latest === null)) return 2
  if (plan.entries.some((e) => e.willUpgrade)) return 1
  return 0
}

export interface RunUpgradeResult {
  plan: UpgradePlan
  upgraded: boolean
  message: string
}

export async function runUpgrade(opts: RunUpgradeOptions = {}): Promise<RunUpgradeResult> {
  const plan = await planUpgrade(opts.cwd ?? process.cwd())

  if (opts.check) {
    const exit = evaluateUpgradeCheckExit(plan)
    const message =
      exit === 0
        ? 'All installed Mushi packages are already at the latest stable version.'
        : exit === 2
          ? 'Could not reach the npm registry to check for updates — try again in a moment.'
          : plan.entries.length === 0
            ? 'No Mushi Mushi package (mushi-mushi or @mushi-mushi/*) in package.json — run `npx mushi-mushi` first.'
            : 'One or more Mushi packages are behind the latest stable npm release.'
    return { plan, upgraded: false, message }
  }

  if (plan.entries.length === 0) {
    return {
      plan,
      upgraded: false,
      message: 'No Mushi Mushi package (mushi-mushi or @mushi-mushi/*) in package.json — run `npx mushi-mushi` first.',
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

  const migrateNote = umbrellaNote(plan.entries)

  return {
    plan,
    upgraded: true,
    message: `Upgraded Mushi SDK packages.\n  ${plan.installCmd}${migrateNote}`,
  }
}
