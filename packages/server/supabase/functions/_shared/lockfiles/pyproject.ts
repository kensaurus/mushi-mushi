/**
 * FILE: _shared/lockfiles/pyproject.ts
 * PURPOSE: The Python pieces the poetry, uv and requirements parsers share:
 *          the dependency names a pyproject.toml declares (production vs
 *          dev), a PEP 508 name reader and an exact PEP 440 version check.
 *
 * Production: `[project] dependencies`, `[project.optional-dependencies]`
 * (extras ship to users), `[tool.poetry.dependencies]` and
 * `[tool.poetry.group.main.dependencies]`. Dev: `[tool.poetry.dev-dependencies]`,
 * every other `[tool.poetry.group.<g>.dependencies]`, PEP 735
 * `[dependency-groups]` and `[tool.uv] dev-dependencies`. An extra whose name
 * says it is for development (`dev`, `test`, `lint`, `docs`, `typing`) counts
 * as dev: projects use `[project.optional-dependencies] dev = [...]` as a dev
 * group.
 */

import { normalizePypiName, type Manifests } from './types.ts'
import { arrayAt, parseTomlLite, tableAt, type TomlTable, type TomlValue } from './toml-lite.ts'

/** An exact PEP 440 version: 2.31.0, 1.0rc1, 2.0.0.post1, 1!2.0, 2.1.0+cpu. */
export const EXACT_PEP440 =
  /^(?:\d+!)?\d+(?:\.\d+)*(?:[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview)[-_.]?\d*)?(?:[-_.]?(?:post|rev|r)[-_.]?\d*)?(?:[-_.]?dev[-_.]?\d*)?(?:\+[A-Za-z0-9.]+)?$/i

/** An extra (optional-dependencies group) that is a dev group by name. */
export const DEV_EXTRA = /^(dev|devel|develop|development|test|tests|testing|lint|linting|docs?|typing|types|mypy|ci|qa)$/i

/** The distribution name at the start of a PEP 508 requirement, normalised; null when there is none. */
export function pep508Name(req: string): string | null {
  const m = /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/.exec(req)
  return m ? normalizePypiName(m[1]) : null
}

export interface PyprojectDeps {
  prod: Set<string>
  dev: Set<string>
  /** A pyproject.toml was read. */
  any: boolean
}

function addReqs(target: Set<string>, list: TomlValue | undefined): void {
  for (const r of arrayAt(list)) {
    // PEP 735 groups may hold `{ include-group = "x" }` tables; those name no package.
    if (typeof r !== 'string') continue
    const n = pep508Name(r)
    if (n) target.add(n)
  }
}

function addKeys(target: Set<string>, table: TomlTable): void {
  for (const k of Object.keys(table)) if (k.toLowerCase() !== 'python') target.add(normalizePypiName(k))
}

export function pyprojectDeps(manifests: Manifests): PyprojectDeps {
  const prod = new Set<string>()
  const dev = new Set<string>()
  let any = false
  for (const [path, text] of Object.entries(manifests)) {
    if (!/(^|\/)pyproject\.toml$/.test(path)) continue
    let doc: TomlTable
    try {
      doc = parseTomlLite(text)
    } catch {
      continue
    }
    any = true
    const project = tableAt(doc.project)
    addReqs(prod, project.dependencies)
    for (const [extra, list] of Object.entries(tableAt(project['optional-dependencies']))) {
      addReqs(DEV_EXTRA.test(extra) ? dev : prod, list)
    }
    for (const list of Object.values(tableAt(doc['dependency-groups']))) addReqs(dev, list)
    const tool = tableAt(doc.tool)
    addReqs(dev, tableAt(tool.uv)['dev-dependencies'])
    const poetry = tableAt(tool.poetry)
    addKeys(prod, tableAt(poetry.dependencies))
    addKeys(dev, tableAt(poetry['dev-dependencies']))
    for (const [group, g] of Object.entries(tableAt(poetry.group))) {
      addKeys(group === 'main' ? prod : dev, tableAt(tableAt(g).dependencies))
    }
  }
  return { prod, dev, any }
}
