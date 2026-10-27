/**
 * FILE: _shared/lockfiles/requirements.ts
 * PURPOSE: A pinned requirements file (requirements.txt, requirements-dev.txt,
 *          pip-compile output) → resolved PyPI packages.
 *
 * Only `name==X.Y.Z` (and `name===X.Y.Z`) pins count. Extras
 * (`name[extra]==1.0`), environment markers (`; python_version < "3.12"`),
 * per-line options (`--hash=sha256:…`), comments and `\` line continuations
 * are stripped. `-r` / `-c` includes are not followed; `-e`, URLs, VCS and
 * local paths are not registry packages; ranges, wildcards (`==1.*`) and
 * unpinned names are counted in a warning, because a range never matches an
 * advisory (ADR 0038 decision 3). A file whose name has a `dev` or `test`
 * part (requirements-dev.txt, requirements_test.txt) marks every package
 * dev. Every pinned package is direct: the file is the manifest.
 */

import { dedupePackages, normalizePypiName, type LockfileParse, type ResolvedPackage } from './types.ts'
import { EXACT_PEP440 } from './pyproject.ts'

const PIN = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(?:\[[^\]]*\])?\s*(===|==)\s*([^\s,;]+)$/
const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?/

export function parseRequirements(text: string, path = 'requirements.txt'): LockfileParse {
  const warnings: string[] = []
  const base = (typeof path === 'string' ? path : '').split('/').pop() ?? ''
  // requirements-dev.txt, requirements_test.txt, requirements.tests.txt; not requirements-latest.txt.
  const dev = /(^|[^a-z])(dev|test)/i.test(base)
  const out: ResolvedPackage[] = []
  let ranges = 0
  let local = 0
  let includes = 0
  let unknown = 0
  // Join `\` continuations, then read one requirement per logical line.
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\\\n/g, ' ').split('\n')
  for (const raw of lines) {
    // A comment starts at a `#` at the line start or after whitespace (a URL fragment has none before it).
    let line = raw.replace(/(^|\s)#.*$/, '').trim()
    if (!line) continue
    if (/^(-r|-c|--requirement|--constraint)\b/.test(line)) {
      includes++
      continue
    }
    if (/^(-e|--editable)\b/.test(line)) {
      local++
      continue
    }
    // Other options: an index URL, --find-links, --pre, a bare --hash line.
    if (line.startsWith('-')) continue
    // Per-requirement options (`--hash=…`) follow the requirement.
    const opt = line.search(/\s--?[a-z]/)
    if (opt >= 0) line = line.slice(0, opt).trim()
    if (/:\/\/|^\.{0,2}\/|^[A-Za-z]:\\|\s@\s|^git\+|\.(whl|zip|tar\.gz)$/.test(line)) {
      local++
      continue
    }
    const marker = line.indexOf(';')
    if (marker >= 0) line = line.slice(0, marker).trim()
    const pin = PIN.exec(line)
    if (pin && !pin[3].includes('*') && EXACT_PEP440.test(pin[3])) {
      out.push({ ecosystem: 'PyPI', name: normalizePypiName(pin[1]), version: pin[3], dev, direct: true })
    } else if (NAME.test(line)) {
      ranges++
    } else {
      unknown++
    }
  }
  if (ranges > 0) {
    warnings.push(`${ranges} requirement${ranges === 1 ? ' is' : 's are'} a range or unpinned and cannot be matched to an advisory; pin exact versions (pip-compile, uv pip compile or pip freeze).`)
  }
  if (local > 0) warnings.push(`${local} editable, VCS, URL or local requirement${local === 1 ? '' : 's'} skipped.`)
  if (includes > 0) warnings.push(`${includes} included file${includes === 1 ? '' : 's'} (-r / -c) not followed; each requirements file is read on its own.`)
  if (unknown > 0) warnings.push(`${unknown} line${unknown === 1 ? ' is' : 's are'} not a requirement and ${unknown === 1 ? 'was' : 'were'} skipped.`)
  return { kind: 'requirements', ecosystem: 'PyPI', packages: dedupePackages(out), warnings }
}
