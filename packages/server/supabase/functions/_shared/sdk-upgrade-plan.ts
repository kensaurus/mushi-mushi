/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-plan.ts
 * PURPOSE: Pure bump-plan logic for @mushi-mushi/* packages.
 *          Mirrors the CLI's `planUpgrade()` in packages/cli/src/upgrade.ts
 *          so both paths apply identical safety guards.
 *
 * Deno-compatible, no Node APIs.
 */

/** Strict semver guard (same as CLI) — never interpolate a registry version
 *  into a shell command or package.json unless it passes this test. */
const SAFE_SEMVER = /^\d+\.\d+\.\d+(-[\w.]+)?$/

const MUSHI_SCOPE = '@mushi-mushi/'

/** Package names the bump plan considers. */
export const UPGRADEABLE_PACKAGES = [
  '@mushi-mushi/core',
  '@mushi-mushi/web',
  '@mushi-mushi/react',
  '@mushi-mushi/vue',
  '@mushi-mushi/svelte',
  '@mushi-mushi/angular',
  '@mushi-mushi/react-native',
  '@mushi-mushi/capacitor',
  '@mushi-mushi/cli',
  '@mushi-mushi/mcp',
  '@mushi-mushi/node',
] as const

export type UpgradeablePackage = (typeof UPGRADEABLE_PACKAGES)[number]

export interface BumpEntry {
  package: string
  from: string
  to: string
  /** Legacy @mushi-mushi/react package — include migration note in PR body. */
  migrateToWeb?: boolean
}

export interface BumpPlan {
  /** Packages that will be bumped. */
  bumps: BumpEntry[]
  /** Parsed package.json with bumped deps applied. */
  updatedPkg: Record<string, unknown>
}

/** Return true when `version` is a plain semver specifier (not workspace:/file:/git). */
function isRegistrySpecifier(version: string): boolean {
  const core = version.replace(/^[\^~>=<\s*]+/, '').trim()
  return /^\d/.test(core)
}

/**
 * Given a parsed `package.json` and a map of `package → latestVersion`,
 * return the list of bumps and the updated package.json content.
 *
 * Non-registry specifiers (workspace:, file:, link:, git URLs, dist-tags)
 * are never replaced — same guard as the CLI.
 */
export function computeBumpPlan(
  pkg: Record<string, unknown>,
  latestVersions: Record<string, string>,
): BumpPlan {
  const deps = (pkg.dependencies ?? {}) as Record<string, string>
  const devDeps = (pkg.devDependencies ?? {}) as Record<string, string>

  const bumps: BumpEntry[] = []
  const newDeps = { ...deps }
  const newDevDeps = { ...devDeps }

  const processSection = (section: Record<string, string>, target: Record<string, string>) => {
    for (const name of UPGRADEABLE_PACKAGES) {
      if (!(name in section)) continue
      const current = section[name]
      if (!isRegistrySpecifier(current)) continue

      const currentCore = current.replace(/^[\^~>=<\s*]+/, '').trim()
      const latest = latestVersions[name]
      if (!latest || !SAFE_SEMVER.test(latest)) continue

      // Only bump if latest is strictly newer.
      if (!isNewerSemver(latest, currentCore)) continue

      // Preserve the specifier prefix (^, ~, etc.) when present.
      const prefix = current.match(/^([\^~>=<]+)/)?.[1] ?? ''
      target[name] = `${prefix}${latest}`

      bumps.push({
        package: name,
        from: currentCore,
        to: latest,
        ...(name === '@mushi-mushi/react' ? { migrateToWeb: true } : {}),
      })
    }
  }

  processSection(deps, newDeps)
  processSection(devDeps, newDevDeps)

  const updatedPkg = {
    ...pkg,
    ...(Object.keys(deps).length > 0 ? { dependencies: newDeps } : {}),
    ...(Object.keys(devDeps).length > 0 ? { devDependencies: newDevDeps } : {}),
  }

  return { bumps, updatedPkg }
}

/**
 * Compare two plain semver strings (no range prefix).
 * Returns true when `candidate` is strictly greater than `current`.
 * Falls back to false on any parse error so a malformed registry entry
 * never triggers a bump.
 */
export function isNewerSemver(candidate: string, current: string): boolean {
  try {
    const parse = (v: string) => v.split('.').map(Number)
    const [caMaj, caMin, caPat] = parse(candidate)
    const [cuMaj, cuMin, cuPat] = parse(current)
    if (isNaN(caMaj) || isNaN(cuMaj)) return false
    if (caMaj !== cuMaj) return caMaj > cuMaj
    if (caMin !== cuMin) return caMin > cuMin
    return caPat > cuPat
  } catch {
    return false
  }
}

/**
 * Fetch the latest stable version of a single npm package.
 * Calls the public npm registry; returns null on any failure.
 */
export async function fetchLatestNpmVersion(
  packageName: string,
  timeoutMs = 5000,
): Promise<string | null> {
  try {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      {
        headers: { Accept: 'application/json' },
        signal: ac.signal,
      },
    )
    clearTimeout(timer)
    if (!res.ok) return null
    const body = (await res.json()) as { version?: string }
    const version = body.version
    return version && SAFE_SEMVER.test(version) ? version : null
  } catch {
    return null
  }
}

/**
 * Fetch latest versions for all known @mushi-mushi/* packages in parallel.
 * Returns a map of package name → latest version (omits failures).
 */
export async function fetchAllLatestVersions(): Promise<Record<string, string>> {
  const results = await Promise.allSettled(
    UPGRADEABLE_PACKAGES.map(async (name) => {
      const v = await fetchLatestNpmVersion(name)
      return { name, version: v }
    }),
  )

  const map: Record<string, string> = {}
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.version) {
      map[r.value.name] = r.value.version
    }
  }
  return map
}
