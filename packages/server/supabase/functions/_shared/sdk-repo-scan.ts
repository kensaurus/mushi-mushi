/**
 * FILE: packages/server/supabase/functions/_shared/sdk-repo-scan.ts
 * PURPOSE: Declared SDK version from a connected repo's package.json when no
 *          runtime observation exists (dogfood monorepos with workspace:* deps).
 */

import type { getServiceClient } from './db.ts'
import { ghFetchOptional } from './github-pr.ts'
import { parseGithubRepoUrl, resolveProjectGithubToken } from './github.ts'
import { log as rootLog } from './logger.ts'
import { UPGRADEABLE_PACKAGES } from './sdk-upgrade-plan.ts'
import { upsertProjectSdkObservationAsync } from './sdk-observation.ts'

const log = rootLog.child('sdk-repo-scan')

const PKG_PATH_CANDIDATES = [
  'package.json',
  'apps/web/package.json',
  'apps/admin/package.json',
  'apps/mobile/package.json',
  'apps/app/package.json',
  'src/package.json',
]

/** Prefer web/RN adapters over core for display when multiple are declared. */
const PACKAGE_PRIORITY: string[] = [
  '@mushi-mushi/web',
  '@mushi-mushi/react-native',
  '@mushi-mushi/react',
  '@mushi-mushi/capacitor',
  '@mushi-mushi/core',
  ...UPGRADEABLE_PACKAGES.filter(
    (p) =>
      !['@mushi-mushi/web', '@mushi-mushi/react-native', '@mushi-mushi/react', '@mushi-mushi/capacitor', '@mushi-mushi/core'].includes(p),
  ),
]

const WORKSPACE_PKG_PATH: Record<string, string> = {
  '@mushi-mushi/web': 'packages/web/package.json',
  '@mushi-mushi/react-native': 'packages/react-native/package.json',
  '@mushi-mushi/react': 'packages/react/package.json',
  '@mushi-mushi/core': 'packages/core/package.json',
  '@mushi-mushi/capacitor': 'packages/capacitor/package.json',
  '@mushi-mushi/cli': 'packages/cli/package.json',
  '@mushi-mushi/node': 'packages/node/package.json',
  '@mushi-mushi/mcp': 'packages/mcp/package.json',
}

function parseRegistryCore(version: string): string | null {
  const core = version.replace(/^[\^~>=<\s*]+/, '').trim()
  const match = core.match(/^(\d+\.\d+\.\d+)/)
  return match ? match[1] : null
}

async function fetchPackageJson(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const fileRes = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    { headers },
  )
  if (!fileRes) return null
  const encoded = (fileRes as Record<string, unknown>).content as string | undefined
  if (!encoded) return null
  try {
    const pkgText = atob(encoded.replace(/\s/g, ''))
    return JSON.parse(pkgText) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface DeclaredSdkScanResult {
  sdkPackage: string
  sdkVersion: string
}

export function detectDeclaredSdkFromDeps(
  deps: Record<string, string>,
  workspaceVersions: Record<string, string>,
): DeclaredSdkScanResult | null {
  let best: DeclaredSdkScanResult | null = null
  let bestRank = Number.POSITIVE_INFINITY

  for (const pkg of PACKAGE_PRIORITY) {
    const spec = deps[pkg]
    if (!spec) continue
    const rank = PACKAGE_PRIORITY.indexOf(pkg)
    let version: string | null = null
    if (spec.startsWith('workspace:')) {
      version = workspaceVersions[pkg] ?? null
    } else {
      version = parseRegistryCore(spec)
    }
    if (!version) continue
    if (rank < bestRank) {
      best = { sdkPackage: pkg, sdkVersion: version }
      bestRank = rank
    }
  }
  return best
}

export async function scanProjectDeclaredSdk(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  repoUrl: string | null,
): Promise<DeclaredSdkScanResult | null> {
  if (!repoUrl) return null
  const repoRef = parseGithubRepoUrl(repoUrl)
  if (!repoRef) return null

  const token = await resolveProjectGithubToken(db, projectId)
  if (!token) return null

  const { owner, repo } = repoRef
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const repoInfoRes = await ghFetchOptional(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers },
  )
  const defaultBranch =
    repoInfoRes && typeof repoInfoRes === 'object' &&
      'default_branch' in (repoInfoRes as Record<string, unknown>)
      ? ((repoInfoRes as Record<string, unknown>).default_branch as string)
      : 'main'

  const workspaceVersions: Record<string, string> = {}
  for (const [pkg, path] of Object.entries(WORKSPACE_PKG_PATH)) {
    const wsPkg = await fetchPackageJson(owner, repo, path, defaultBranch, headers)
    const ver = typeof wsPkg?.version === 'string' ? parseRegistryCore(wsPkg.version) : null
    if (ver) workspaceVersions[pkg] = ver
  }

  for (const pkgPath of PKG_PATH_CANDIDATES) {
    const pkg = await fetchPackageJson(owner, repo, pkgPath, defaultBranch, headers)
    if (!pkg) continue
    const deps = {
      ...((pkg.dependencies ?? {}) as Record<string, string>),
      ...((pkg.devDependencies ?? {}) as Record<string, string>),
    }
    const found = detectDeclaredSdkFromDeps(deps, workspaceVersions)
    if (found) return found
  }

  return null
}

/** Scan + persist when a project has no runtime SDK observation. */
export async function ensureRepoDeclaredSdkObservation(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
  repoUrl: string | null,
): Promise<DeclaredSdkScanResult | null> {
  try {
    const found = await scanProjectDeclaredSdk(db, projectId, repoUrl)
    if (!found) return null
    upsertProjectSdkObservationAsync(db, {
      projectId,
      sdkPackage: found.sdkPackage,
      sdkVersion: found.sdkVersion,
      source: 'repo_scan',
    })
    return found
  } catch (err) {
    log.warn('ensureRepoDeclaredSdkObservation failed', { projectId, err: String(err) })
    return null
  }
}
