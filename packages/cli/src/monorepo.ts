/**
 * FILE: packages/cli/src/monorepo.ts
 * PURPOSE: Detect whether the user is running the wizard at a workspace
 *          root and, if so, return the list of app-like sub-packages to
 *          offer them instead. We never change directories automatically —
 *          we just surface the ambiguity so the user can fix it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export interface WorkspaceHint {
  /** The root directory that owns the workspaces. */
  root: string
  /** Sub-packages that look like applications (have a framework dep). */
  apps: WorkspacePackage[]
  /** Did we find this via pnpm-workspace.yaml, package.json "workspaces", or a parent search? */
  source: 'pnpm-workspace' | 'package-json' | 'parent'
}

export interface WorkspacePackage {
  name: string
  relativePath: string
  framework?: string
}

const WORKSPACE_GLOB_CANDIDATES = ['apps/*', 'packages/*', 'examples/*']
const FRAMEWORK_DEPS: Record<string, string> = {
  next: 'Next.js',
  nuxt: 'Nuxt',
  '@sveltejs/kit': 'SvelteKit',
  '@angular/core': 'Angular',
  expo: 'Expo',
  'react-native': 'React Native',
  '@capacitor/core': 'Capacitor',
  svelte: 'Svelte',
  vue: 'Vue',
  react: 'React',
}

interface RawPackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}

/**
 * If `cwd` looks like the root of a workspace (has pnpm-workspace.yaml or a
 * `workspaces` field in package.json) and its own package.json has no
 * framework dependency, scan the declared glob prefixes (`apps/*`,
 * `packages/*`, `examples/*`) for framework-owning sub-packages.
 */
export function detectWorkspaceHint(cwd: string): WorkspaceHint | null {
  const root = findWorkspaceRoot(cwd)
  if (!root) return null

  const rootPkg = readPackageJsonSafely(join(root, 'package.json'))
  if (rootPkg && getFrameworkFromPkg(rootPkg)) return null

  const source: WorkspaceHint['source'] = existsSync(join(root, 'pnpm-workspace.yaml'))
    ? 'pnpm-workspace'
    : root === cwd
      ? 'package-json'
      : 'parent'

  const apps = collectAppsFromGlobs(root)
  if (apps.length === 0) return null

  return { root, apps, source }
}

function findWorkspaceRoot(start: string): string | null {
  let dir = resolve(start)
  for (let i = 0; i < 8; i++) {
    if (isWorkspaceRoot(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function isWorkspaceRoot(dir: string): boolean {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return true
  const pkg = readPackageJsonSafely(join(dir, 'package.json'))
  if (!pkg) return false
  return Boolean(pkg.workspaces)
}

function collectAppsFromGlobs(root: string): WorkspacePackage[] {
  const results: WorkspacePackage[] = []
  for (const glob of WORKSPACE_GLOB_CANDIDATES) {
    const prefix = glob.replace('/*', '')
    const parentDir = join(root, prefix)
    if (!existsSync(parentDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(parentDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      const pkgPath = join(parentDir, entry, 'package.json')
      if (!isFileSafe(pkgPath)) continue
      const pkg = readPackageJsonSafely(pkgPath)
      if (!pkg) continue
      const framework = getFrameworkFromPkg(pkg)
      if (!framework) continue
      results.push({
        name: pkg.name ?? `${prefix}/${entry}`,
        relativePath: `${prefix}/${entry}`,
        framework,
      })
    }
  }
  return results
}

function readPackageJsonSafely(path: string): RawPackageJson | null {
  if (!isFileSafe(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as RawPackageJson
  } catch {
    return null
  }
}

function isFileSafe(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function getFrameworkFromPkg(pkg: RawPackageJson): string | undefined {
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  }
  for (const dep of Object.keys(FRAMEWORK_DEPS)) {
    if (dep in deps) return FRAMEWORK_DEPS[dep]
  }
  return undefined
}
