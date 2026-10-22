/**
 * FILE: _shared/lockfiles/gosum.ts
 * PURPOSE: go.mod + go.sum → resolved Go modules.
 *
 * The module list is go.mod's `require` (single-line and block form;
 * `// indirect` → not direct). Versions must be exact semver with the `v`
 * prefix and are stored without it, because OSV's Go ecosystem spells them
 * `1.2.3`; `+incompatible` is dropped and pseudo-versions
 * (`v0.0.0-20230101120000-abcdef123456`) are kept as they are, minus the
 * `v`. `replace` directives apply (version-specific first): a replacement by
 * a local path skips the module, a replacement by another module@version is
 * used instead. Only modules that go.sum lists (`<module> <version> h1:` or
 * `<module> <version>/go.mod h1:`) are kept; without go.sum, go.mod alone is
 * used and a warning says so. Go has no dev flag, so every module is
 * production.
 */

import { dedupePackages, EXACT_SEMVER, type LockfileParse, type ResolvedPackage } from './types.ts'

interface Require {
  module: string
  version: string
  indirect: boolean
}

interface Replace {
  module: string
  version: string | null
  /** The replacement module and version, or null for a local path. */
  to: { module: string; version: string } | null
}

function unquotePath(s: string): string {
  return s.replace(/^["`]|["`]$/g, '')
}

/** go.mod → require and replace directives, plus the `go` line. */
function readGoMod(text: string): { module: string | null; requires: Require[]; replaces: Replace[]; go: string | null } {
  const requires: Require[] = []
  const replaces: Replace[] = []
  let go: string | null = null
  let module: string | null = null
  let block: string | null = null
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const comment = raw.indexOf('//')
    const indirect = comment >= 0 && /^\/\/\s*indirect\b/.test(raw.slice(comment).trim())
    const line = (comment >= 0 ? raw.slice(0, comment) : raw).trim()
    if (!line) continue
    if (block) {
      if (line === ')') {
        block = null
        continue
      }
    }
    let verb: string | null = block
    let rest = line
    if (!block) {
      const m = /^(\w+)\s*(.*)$/.exec(line)
      if (!m) continue
      verb = m[1]
      rest = m[2].trim()
      if (rest === '(') {
        block = verb
        continue
      }
    }
    if (verb === 'module') module = unquotePath(rest)
    else if (verb === 'go') go = rest
    else if (verb === 'require') {
      const [module, version] = rest.split(/\s+/)
      if (module && version) requires.push({ module: unquotePath(module), version, indirect })
    } else if (verb === 'replace') {
      const [left, right] = rest.split('=>').map((s) => s.trim())
      if (!left || !right) continue
      const [module, version] = left.split(/\s+/)
      const [toModule, toVersion] = right.split(/\s+/)
      replaces.push({
        module: unquotePath(module),
        version: version ?? null,
        // A replacement without a version is a local directory (go.mod reference).
        to: toVersion ? { module: unquotePath(toModule), version: toVersion } : null,
      })
    }
  }
  return { module, requires, replaces, go }
}

/** `v1.2.3+incompatible` → `1.2.3`; null when it is not an exact semver. */
function goVersion(v: string): string | null {
  if (!v.startsWith('v')) return null
  const out = v.slice(1).replace(/\+incompatible$/, '')
  return EXACT_SEMVER.test(out) ? out : null
}

export function parseGoModules(goSumText: string | null | undefined, goModText: string | null | undefined): LockfileParse {
  const warnings: string[] = []
  if (typeof goModText !== 'string' || !goModText.trim()) {
    return { kind: 'gosum', ecosystem: 'Go', packages: [], warnings: ['go.sum needs the go.mod beside it to know which modules the build uses; go.mod was not read.'] }
  }
  const { module: mainModule, requires, replaces, go } = readGoMod(goModText)
  if (!mainModule) {
    return { kind: 'gosum', ecosystem: 'Go', packages: [], warnings: ['go.mod could not be read: it has no module line.'] }
  }
  const sum = new Set<string>()
  const haveSum = typeof goSumText === 'string' && goSumText.trim() !== ''
  if (haveSum) {
    for (const line of goSumText!.replace(/\r\n?/g, '\n').split('\n')) {
      const m = /^(\S+)\s+(\S+?)(?:\/go\.mod)?\s+h1:/.exec(line.trim())
      if (m) sum.add(`${m[1]} ${m[2]}`)
    }
  } else {
    warnings.push('No go.sum was read, so versions come from go.mod alone.')
  }
  const goMinor = go ? /^1\.(\d+)/.exec(go) : null
  if (goMinor && Number(goMinor[1]) < 17) {
    warnings.push(`go.mod declares go ${go}; before Go 1.17 go.mod does not list every indirect module, so some may be missing.`)
  }

  const out: ResolvedPackage[] = []
  let local = 0
  let inexact = 0
  let unsummed = 0
  for (const r of requires) {
    const rep = replaces.find((x) => x.module === r.module && x.version === r.version) ?? replaces.find((x) => x.module === r.module && x.version === null)
    if (rep && rep.to === null) {
      local++
      continue
    }
    const module = rep?.to?.module ?? r.module
    const raw = rep?.to?.version ?? r.version
    const version = goVersion(raw)
    if (!version) {
      inexact++
      continue
    }
    if (haveSum && !sum.has(`${module} ${raw}`)) {
      unsummed++
      continue
    }
    out.push({ ecosystem: 'Go', name: module, version, dev: false, direct: !r.indirect })
  }
  if (local > 0) warnings.push(`${local} module${local === 1 ? '' : 's'} replaced by a local directory skipped.`)
  if (inexact > 0) warnings.push(`${inexact} module${inexact === 1 ? '' : 's'} without an exact version skipped.`)
  if (unsummed > 0) warnings.push(`${unsummed} module${unsummed === 1 ? '' : 's'} in go.mod missing from go.sum skipped; run \`go mod tidy\`.`)
  return { kind: 'gosum', ecosystem: 'Go', packages: dedupePackages(out), warnings }
}
