/**
 * FILE: _shared/lockfiles/index.ts
 * PURPOSE: Which files are lockfiles, which manifests to read beside each,
 *          and one `parseLockfile` that dispatches to the right parser
 *          (ADR 0038 decision 3: exact versions only).
 *
 * `parseLockfile` never throws: bad input gives no packages and a
 * plain-English warning. It returns null only for a path that is not a
 * lockfile Mushi reads (check `lockfileKindFor` first).
 */

import type { Ecosystem, LockfileKind, LockfileParse, Manifests } from './types.ts'
import { parseNpmLock } from './npm.ts'
import { parsePnpmLock } from './pnpm.ts'
import { parseYarnLock } from './yarn.ts'
import { parseComposerLock } from './composer.ts'
import { parsePoetryLock } from './poetry.ts'
import { parseUvLock } from './uv.ts'
import { parseRequirements } from './requirements.ts'
import { parseGoModules } from './gosum.ts'

export type { Ecosystem, LockfileKind, LockfileParse, Manifests, ResolvedPackage } from './types.ts'
export { parseNpmLock, parsePnpmLock, parseYarnLock, parseComposerLock, parsePoetryLock, parseUvLock, parseRequirements, parseGoModules }

/** Lockfile basename → kind. Requirements files match REQUIREMENTS_FILE instead. */
export const LOCKFILE_NAMES: Readonly<Record<string, LockfileKind>> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'composer.lock': 'composer',
  'poetry.lock': 'poetry',
  'uv.lock': 'uv',
  'go.sum': 'gosum',
}

/** requirements.txt, requirements-dev.txt, requirements.prod.txt, requirements_test.txt. */
export const REQUIREMENTS_FILE = /^requirements[\w.-]*\.txt$/

/** The manifest each kind reads beside its lockfile (none for requirements files). */
const MANIFEST_FOR: Record<LockfileKind, string | null> = {
  npm: 'package.json',
  pnpm: 'package.json',
  yarn: 'package.json',
  composer: 'composer.json',
  poetry: 'pyproject.toml',
  uv: 'pyproject.toml',
  requirements: null,
  gosum: 'go.mod',
}

const ECOSYSTEM_OF: Record<LockfileKind, Ecosystem> = {
  npm: 'npm',
  pnpm: 'npm',
  yarn: 'npm',
  composer: 'Packagist',
  poetry: 'PyPI',
  uv: 'PyPI',
  requirements: 'PyPI',
  gosum: 'Go',
}

function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) }
}

/** The lockfile kind of a repo path, or null when it is not a lockfile. */
export function lockfileKindFor(path: string): LockfileKind | null {
  const { base } = splitPath(path)
  if (Object.prototype.hasOwnProperty.call(LOCKFILE_NAMES, base)) return LOCKFILE_NAMES[base]
  return REQUIREMENTS_FILE.test(base) ? 'requirements' : null
}

/** The manifest paths to read beside a lockfile (same folder), e.g. `apps/web/package.json`. */
export function manifestPathsFor(lockPath: string): string[] {
  const kind = lockfileKindFor(lockPath)
  const manifest = kind ? MANIFEST_FOR[kind] : null
  return manifest ? [splitPath(lockPath).dir + manifest] : []
}

/** Parse a lockfile by its path. `manifests` maps manifest path → text (see manifestPathsFor). */
export function parseLockfile(path: string, text: string, manifests: Manifests = {}): LockfileParse | null {
  const kind = lockfileKindFor(path)
  if (!kind) return null
  const body = typeof text === 'string' ? text : ''
  try {
    switch (kind) {
      case 'npm':
        return parseNpmLock(body, manifests)
      case 'pnpm':
        return parsePnpmLock(body, manifests, splitPath(path).dir.replace(/\/$/, ''))
      case 'yarn':
        return parseYarnLock(body, manifests)
      case 'composer':
        return parseComposerLock(body, manifests)
      case 'poetry':
        return parsePoetryLock(body, manifests)
      case 'uv':
        return parseUvLock(body, manifests)
      case 'requirements':
        return parseRequirements(body, path)
      case 'gosum': {
        const goModPath = manifestPathsFor(path)[0]
        const goMod = manifests[goModPath] ?? Object.entries(manifests).find(([p]) => /(^|\/)go\.mod$/.test(p))?.[1]
        return parseGoModules(body, goMod)
      }
    }
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err)
    return { kind, ecosystem: ECOSYSTEM_OF[kind], packages: [], warnings: [`${splitPath(path).base} could not be read (${why}).`] }
  }
}
