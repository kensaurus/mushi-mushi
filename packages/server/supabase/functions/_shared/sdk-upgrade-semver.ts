/**
 * FILE: packages/server/supabase/functions/_shared/sdk-upgrade-semver.ts
 * PURPOSE: Match registry ranges while rewriting npm lock entries.
 *          A prerelease satisfies a range only when that range has a
 *          comparator with the same major.minor.patch and a prerelease tag.
 */

export interface SemVer {
  major: number
  minor: number
  patch: number
  pre: string[] | null
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const COMPARATOR = /^(>=|<=|>|<|~|\^|=)?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseSemVer(input: string): SemVer | null {
  const match = VERSION.exec(input.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : null,
  }
}

/** Release sorts above a prerelease of the same major.minor.patch. */
export function cmpSemVer(a: string, b: string): number {
  const left = parseSemVer(a)
  const right = parseSemVer(b)
  if (!left || !right) return 0
  return cmpParsed(left, right)
}

function cmpParsed(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (!a.pre && !b.pre) return 0
  if (!a.pre) return 1
  if (!b.pre) return -1
  const count = Math.max(a.pre.length, b.pre.length)
  for (let i = 0; i < count; i++) {
    const ai = a.pre[i]
    const bi = b.pre[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const aNum = /^[0-9]+$/.test(ai)
    const bNum = /^[0-9]+$/.test(bi)
    if (aNum && bNum && ai !== bi) return Number(ai) - Number(bi)
    if (aNum && !bNum) return -1
    if (!aNum && bNum) return 1
    if (ai !== bi) return ai < bi ? -1 : 1
  }
  return 0
}

interface Comp {
  op: string
  ver: SemVer
}

function parseComp(bit: string): Comp | null {
  const match = COMPARATOR.exec(bit)
  if (!match) return null
  return {
    op: match[1] || '=',
    ver: {
      major: Number(match[2]),
      minor: Number(match[3]),
      patch: Number(match[4]),
      pre: match[5] ? match[5].split('.') : null,
    },
  }
}

function upperBound(op: string, ver: SemVer): SemVer | null {
  if (op === '^') {
    if (ver.major > 0) return { major: ver.major + 1, minor: 0, patch: 0, pre: null }
    if (ver.minor > 0) return { major: 0, minor: ver.minor + 1, patch: 0, pre: null }
    return { major: 0, minor: 0, patch: ver.patch + 1, pre: null }
  }
  if (op === '~') return { major: ver.major, minor: ver.minor + 1, patch: 0, pre: null }
  return null
}

function matchesComp(version: SemVer, comp: Comp): boolean {
  const delta = cmpParsed(version, comp.ver)
  const upper = upperBound(comp.op, comp.ver)
  if (upper) return delta >= 0 && cmpParsed(version, upper) < 0
  if (comp.op === '>') return delta > 0
  if (comp.op === '>=') return delta >= 0
  if (comp.op === '<') return delta < 0
  if (comp.op === '<=') return delta <= 0
  return delta === 0
}

function prereleaseAllowed(version: SemVer, comps: Comp[]): boolean {
  if (!version.pre) return true
  return comps.some((comp) =>
    Boolean(comp.ver.pre) &&
    comp.ver.major === version.major &&
    comp.ver.minor === version.minor &&
    comp.ver.patch === version.patch
  )
}

/** `^1.2.3`, `~1.2.3`, comparisons, exact versions, and `||`. */
export function semverSatisfies(version: string, range: string): boolean {
  const parsed = parseSemVer(version)
  if (!parsed) return false
  const trimmed = range.trim()
  if (trimmed === '*' || trimmed === 'x' || trimmed === '') return !parsed.pre
  return trimmed.split('||').some((part) => {
    const bits = part.trim().split(/\s+/).filter(Boolean)
    if (bits.length === 0) return false
    const comps: Comp[] = []
    for (const bit of bits) {
      const comp = parseComp(bit)
      if (!comp) return false
      comps.push(comp)
    }
    return prereleaseAllowed(parsed, comps) && comps.every((comp) => matchesComp(parsed, comp))
  })
}
