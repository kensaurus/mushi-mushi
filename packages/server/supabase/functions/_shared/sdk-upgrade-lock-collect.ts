/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-lock-collect.ts
 * PURPOSE: Decide which lockfiles an SDK upgrade can edit. npm v2/v3 entries
 *          are rewritten from the registry packument. pnpm and yarn produce
 *          the install command instead. Callers skip this when the host
 *          workflow is present (ADR 0019).
 */

import { cmpSemVer } from './sdk-upgrade-semver.ts'
import {
  bumpedRanges,
  governedLocks,
  lockKeyFor,
  mushiNamesInLock,
  overridesOf,
  packageManagerOf,
  refreshCommand,
  type LockfileEdit,
  type LockKind,
} from './sdk-upgrade-lock-edit.ts'
import { type NpmPackument } from './sdk-upgrade-npm-lock.ts'
import { patchNpmLockfile } from './sdk-upgrade-npm-patch.ts'

const SCOPE = '@mushi-mushi/'
const ROOT_LOCKS = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']
const IGNORE = /(^|\/)(node_modules|dist|build|out|\.next|\.turbo|\.output|coverage|vendor|\.git)\//

function dirOf(manifestPath: string): string {
  return manifestPath === 'package.json' ? '' : manifestPath.slice(0, -'/package.json'.length)
}

async function fetchPackument(name: string, fetchImpl: typeof fetch): Promise<NpmPackument | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
      signal: ac.signal,
    })
    if (!res.ok) return null
    const body = await res.json() as { 'dist-tags'?: { latest?: unknown }; versions?: NpmPackument['versions'] }
    const latest = typeof body['dist-tags']?.latest === 'string' ? body['dist-tags'].latest : null
    const versions = body.versions && typeof body.versions === 'object' ? body.versions : {}
    return { latest, versions }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function loadText(
  path: string,
  sha: string | undefined,
  opts: { readBlob: (sha: string) => Promise<string | null>; readContents: (path: string) => Promise<string | null> },
): Promise<string | null> {
  if (sha) {
    const fromBlob = await opts.readBlob(sha)
    if (fromBlob) return fromBlob
  }
  return opts.readContents(path)
}

/**
 * Read the lockfiles that govern the bumped manifests. For npm v2/v3, rewrite
 * the @mushi-mushi entries in the same commit as package.json. Anything this
 * cannot edit is left untouched and named in `commands`.
 */
export async function collectLockfileChanges(opts: {
  blobs: Array<{ path: string; sha?: string }>
  treeComplete: boolean
  manifests: Array<{ path: string; contents: string }>
  bumps: Array<{ package: string; to: string }>
  readBlob: (sha: string) => Promise<string | null>
  readContents: (path: string) => Promise<string | null>
  fetchImpl?: typeof fetch
}): Promise<LockfileEdit> {
  const none: LockfileEdit = { files: [], outcome: 'none', commands: [], reasons: [] }
  if (opts.bumps.length === 0 || opts.manifests.length === 0) return none
  const files = new Set(opts.blobs.map((blob) => blob.path).filter((path) => !IGNORE.test(path)))
  const shaByPath = new Map(opts.blobs.filter((blob) => blob.sha).map((blob) => [blob.path, blob.sha!]))
  if (!opts.treeComplete) {
    for (const name of ROOT_LOCKS) {
      if (files.has(name)) continue
      const text = await opts.readContents(name)
      if (text) files.add(name)
    }
  }
  const managers = new Map<string, LockKind>()
  for (const manifest of opts.manifests) {
    const kind = packageManagerOf(manifest.contents)
    if (kind) managers.set(dirOf(manifest.path), kind)
  }
  const governed = governedLocks(opts.manifests.map((manifest) => manifest.path), files, managers)
  if (governed.length === 0) return none

  const commands: string[] = []
  const reasons: string[] = []
  const seen = new Set<string>()
  const addCommand = (kind: LockKind) => {
    const command = refreshCommand(kind)
    if (seen.has(command)) return
    seen.add(command)
    commands.push(command)
  }
  for (const lock of governed) {
    if (lock.kind !== 'npm') addCommand(lock.kind)
  }

  const filesOut: LockfileEdit['files'] = []
  let sawNpm = false
  const fetchImpl = opts.fetchImpl ?? fetch
  for (const lock of governed) {
    if (lock.kind !== 'npm') continue
    const names = new Set<string>()
    for (const path of lock.manifests) {
      const text = opts.manifests.find((manifest) => manifest.path === path)?.contents ?? ''
      for (const ranges of Object.values(bumpedRanges(text, new Set(opts.bumps.map((bump) => bump.package))))) {
        for (const name of Object.keys(ranges)) names.add(name)
      }
    }
    const direct: Record<string, string> = {}
    for (const bump of opts.bumps) {
      if (!names.has(bump.package) || !bump.package.startsWith(SCOPE)) continue
      if (!direct[bump.package] || cmpSemVer(bump.to, direct[bump.package]) > 0) direct[bump.package] = bump.to
    }
    if (Object.keys(direct).length === 0) continue
    sawNpm = true
    const text = await loadText(lock.path, shaByPath.get(lock.path), opts)
    if (!text) {
      addCommand('npm')
      reasons.push(`could not read ${lock.path}`)
      continue
    }
    const packuments: Record<string, NpmPackument> = {}
    const wanted = new Set([...names, ...mushiNamesInLock(text)])
    await Promise.all([...wanted].map(async (name) => {
      const pack = await fetchPackument(name, fetchImpl)
      if (pack) packuments[name] = pack
    }))
    const patched = patchNpmLockfile(text, {
      direct,
      packuments,
      manifests: lock.manifests.map((path) => {
        const contents = opts.manifests.find((manifest) => manifest.path === path)?.contents ?? ''
        return {
          lockKey: lockKeyFor(path, lock.path),
          ranges: bumpedRanges(contents, names),
          overrides: overridesOf(contents),
        }
      }),
    })
    if (!patched.ok) {
      addCommand('npm')
      reasons.push(`${lock.path}: ${patched.reason}`)
      continue
    }
    if (patched.text !== text) {
      filesOut.push({ path: lock.path, contents: patched.text, reason: 'update @mushi-mushi/* lock entries' })
    }
  }

  if (commands.length) return { files: filesOut, outcome: 'manual', commands, reasons }
  if (sawNpm) return { files: filesOut, outcome: 'npm_updated', commands: [], reasons }
  return none
}
