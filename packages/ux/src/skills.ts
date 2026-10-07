// SPDX-License-Identifier: MIT
/**
 * Skills the agent applies to each screen. `--skill` takes:
 *
 *   - a path to a SKILL.md, or to a skill folder (SKILL.md + references/);
 *   - a skill name, read from a local checkout of the skills repo
 *     (MUSHI_UX_SKILLS_DIR) or fetched from GitHub (default kensaurus/skills).
 *
 * The whole folder is copied next to the prompt (.mushi-ux/skill/), so a
 * skill's references (scorecards, checklists) are there for the agent to
 * read. Caps keep a large folder from flooding the worktree.
 */

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

/**
 * The published npm package (served by jsDelivr): pinned to one version per
 * run, no GitHub API limit (60 an hour unauthenticated). `owner/repo[@ref]`
 * still reads a GitHub repo, e.g. for an unreleased branch.
 */
export const DEFAULT_SKILLS_REPO = 'npm:@kensaurus/skills'
const NPM_RE = /^npm:((?:@[\w.-]+\/)?[\w.-]+)(?:@([\w.+-]+))?$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/
const REPO_RE = /^([\w.-]+)\/([\w.-]+)(?:@([\w./-]+))?$/
const MAX_FILES = 40
const MAX_BYTES = 1_000_000

export interface ResolvedSkill {
  name: string
  /** Skills this one hands over to, from its "## Related" list and "→ skill" mentions. */
  related?: string[]
  /** SKILL.md text. */
  text: string
  /** Every file of the skill folder, by path relative to it (includes SKILL.md). */
  files: Record<string, Buffer>
  /** Where it came from: a path, or owner/repo@ref. */
  source: string
}

export interface SkillListItem {
  name: string
  group: string | null
}

export interface SkillOptions {
  /** npm:@scope/pkg[@version] (default npm:@kensaurus/skills, latest) or owner/repo[@ref] on GitHub. */
  repo?: string
  /** A local checkout of the skills repo; wins over GitHub. Default: MUSHI_UX_SKILLS_DIR. */
  localDir?: string | null
  fetch?: typeof fetch
}

interface NpmSource {
  name: string
  version: string
  /** Every file path in the published package, each starting with "/". */
  files: string[]
}

const npmCache = new Map<string, Promise<NpmSource>>()

/** The npm package behind an `npm:` spec, its version resolved once and its file list from jsDelivr. */
function npmSource(spec: string, doFetch: typeof fetch): Promise<NpmSource> | null {
  const m = spec.match(NPM_RE)
  if (!m) return null
  const key = spec
  const hit = npmCache.get(key)
  if (hit) return hit
  const p = (async () => {
    const name = m[1]
    let version = m[2]
    if (!version) {
      const res = await doFetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`, { headers: { 'User-Agent': 'mushi-ux' } })
      if (!res.ok) throw new Error(`npm answered ${res.status} for ${name}.`)
      version = String(((await res.json()) as { version?: unknown }).version ?? '')
      if (!/^[\w.+-]+$/.test(version)) throw new Error(`npm gave no version for ${name}.`)
    }
    const list = await doFetch(`https://data.jsdelivr.com/v1/packages/npm/${name}@${version}?structure=flat`, { headers: { 'User-Agent': 'mushi-ux' } })
    if (!list.ok) throw new Error(`jsDelivr answered ${list.status} for ${name}@${version}.`)
    const files = (((await list.json()) as { files?: Array<{ name?: unknown }> }).files ?? []).map((f) => String(f.name ?? '')).filter(Boolean)
    return { name, version, files }
  })()
  npmCache.set(key, p)
  p.catch(() => npmCache.delete(key))
  return p
}

const cdnUrl = (src: NpmSource, path: string) => `https://cdn.jsdelivr.net/npm/${src.name}@${src.version}${path}`

/** Fetch skills/<slug>/ from the npm package through jsDelivr. */
async function fetchNpmFolder(slug: string, src: NpmSource, doFetch: typeof fetch): Promise<ResolvedSkill> {
  const prefix = `/skills/${slug}/`
  const paths = src.files.filter((f) => f.startsWith(prefix)).slice(0, MAX_FILES)
  if (!paths.length) throw new Error(`No skill "${slug}" in ${src.name}@${src.version}.`)
  const files: Record<string, Buffer> = {}
  let bytes = 0
  for (const path of paths) {
    const res = await doFetch(cdnUrl(src, path), { headers: { 'User-Agent': 'mushi-ux' } })
    if (!res.ok) throw new Error(`Could not download ${path} (${res.status}).`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (bytes + buf.length > MAX_BYTES) continue
    bytes += buf.length
    files[path.slice(prefix.length)] = buf
  }
  const md = files['SKILL.md']
  if (!md) throw new Error(`skills/${slug} in ${src.name}@${src.version} has no SKILL.md.`)
  const text = md.toString('utf8')
  return { name: skillName(text, slug), text, files, source: `npm:${src.name}@${src.version}`, related: relatedSkills(text) }
}

/**
 * Pure: the skills a SKILL.md hands over to. kensaurus/skills has no chain
 * field in its frontmatter (2.5.0): hand-offs are the backticked names in a
 * "## Related" section and "→ skill-name" in the text.
 */
function relatedSkills(text: string): string[] {
  const out: string[] = []
  const section = text.match(/^##\s+Related\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m)?.[1] ?? ''
  for (const m of section.matchAll(/`([a-z0-9][a-z0-9-]{1,80})`/g)) out.push(m[1])
  for (const m of text.matchAll(/(?:→|->)\s*`?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)`?/g)) out.push(m[1])
  const self = skillName(text, '')
  return [...new Set(out)].filter((n) => n !== self && SLUG_RE.test(n)).slice(0, 12)
}

/**
 * Pure: several skills as one, applied in order. Each skill's files sit in a
 * folder named after it; the text says which folder is whose.
 */
function chainSkills(skills: readonly ResolvedSkill[]): ResolvedSkill {
  if (skills.length === 1) return skills[0]
  const files: Record<string, Buffer> = {}
  for (const sk of skills) for (const [rel, buf] of Object.entries(sk.files)) files[`${sk.name}/${rel}`] = buf
  const text = [
    `This run applies ${skills.length} skills in this order: ${skills.map((sk, i) => `${i + 1}. ${sk.name}`).join(', ')}. Work through them in that order: plan and make the first skill's changes before the next skill's. Each skill's supporting files are in a folder named after it.`,
    ...skills.map((sk, i) => `\n## Skill ${i + 1}: ${sk.name} (files in ${sk.name}/)\n\n${sk.text}`),
  ].join('\n')
  return { name: skills.map((sk) => sk.name).join(' → '), text, files, source: [...new Set(skills.map((sk) => sk.source))].join(', '), related: [] }
}

function parseRepo(spec: string | undefined): { owner: string; repo: string; ref: string } {
  const m = (spec ?? DEFAULT_SKILLS_REPO).match(REPO_RE)
  if (!m) throw new Error(`Skills repo must look like owner/repo or owner/repo@ref, got "${spec}".`)
  return { owner: m[1], repo: m[2], ref: m[3] ?? 'main' }
}

function skillName(text: string, fallback: string): string {
  return text.match(/^name:\s*([\w-]+)\s*$/m)?.[1] ?? fallback
}

/** Read a skill folder from disk, capped. */
function readFolder(dir: string, source: string): ResolvedSkill {
  const files: Record<string, Buffer> = {}
  let bytes = 0
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      if (Object.keys(files).length >= MAX_FILES || entry.name.startsWith('.')) continue
      const abs = join(d, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) {
        // One handle for the size check and the read (CodeQL js/file-system-race).
        const fd = openSync(abs, 'r')
        try {
          const size = fstatSync(fd).size
          if (bytes + size > MAX_BYTES) continue
          bytes += size
          files[relative(dir, abs).split(sep).join('/')] = readFileSync(fd)
        } finally {
          closeSync(fd)
        }
      }
    }
  }
  walk(dir)
  const md = files['SKILL.md']
  if (!md) throw new Error(`No SKILL.md in ${dir}.`)
  const text = md.toString('utf8')
  return { name: skillName(text, basename(dir)), text, files, source }
}

async function fetchJson(doFetch: typeof fetch, url: string): Promise<unknown> {
  const res = await doFetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mushi-ux' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${url}`)
  return res.json()
}

/** Fetch skills/<slug>/ from a GitHub repo through the contents API. */
async function fetchFolder(slug: string, opts: SkillOptions): Promise<ResolvedSkill> {
  const doFetch = opts.fetch ?? fetch
  const { owner, repo, ref } = parseRepo(opts.repo)
  const files: Record<string, Buffer> = {}
  let bytes = 0
  const walk = async (path: string) => {
    const list = (await fetchJson(doFetch, `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`)) as
      | Array<{ type: string; path: string; size: number; download_url: string | null }>
      | null
    if (!list) throw new Error(`No skill "${slug}" in ${owner}/${repo}@${ref}.`)
    for (const item of list) {
      if (Object.keys(files).length >= MAX_FILES) return
      if (item.type === 'dir') await walk(item.path)
      else if (item.type === 'file' && item.download_url && bytes + item.size <= MAX_BYTES) {
        const res = await doFetch(item.download_url, { headers: { 'User-Agent': 'mushi-ux' } })
        if (!res.ok) throw new Error(`Could not download ${item.path} (${res.status}).`)
        const buf = Buffer.from(await res.arrayBuffer())
        bytes += buf.length
        files[item.path.slice(`skills/${slug}/`.length)] = buf
      }
    }
  }
  await walk(`skills/${slug}`)
  const md = files['SKILL.md']
  if (!md) throw new Error(`skills/${slug} in ${owner}/${repo} has no SKILL.md.`)
  const text = md.toString('utf8')
  return { name: skillName(text, slug), text, files, source: `${owner}/${repo}@${ref}` }
}

export async function resolveSkill(spec: string, opts: SkillOptions = {}): Promise<ResolvedSkill> {
  // Read first and let the error say what the path is: a stat before the
  // read could be raced (CodeQL js/file-system-race).
  let text: string | null = null
  try {
    text = readFileSync(spec, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EISDIR') return readFolder(spec, spec)
    // Not a path on disk (what existsSync said false to): try it as a skill name.
    if (!['ENOENT', 'ENOTDIR', 'EINVAL', 'ENAMETOOLONG'].includes(code ?? '')) throw err
  }
  if (text !== null) {
    if (basename(spec) === 'SKILL.md') return readFolder(dirname(spec), spec)
    return { name: skillName(text, basename(spec).replace(/\.md$/i, '')), text, files: { 'SKILL.md': Buffer.from(text) }, source: spec }
  }
  if (!SLUG_RE.test(spec)) throw new Error(`"${spec}" is neither a file nor a skill name.`)
  const local = opts.localDir === undefined ? process.env.MUSHI_UX_SKILLS_DIR : opts.localDir
  if (local) {
    const dir = join(local, 'skills', spec)
    if (existsSync(join(dir, 'SKILL.md'))) return readFolder(dir, dir)
  }
  const doFetch = opts.fetch ?? fetch
  const npm = npmSource(opts.repo ?? DEFAULT_SKILLS_REPO, doFetch)
  if (npm) return fetchNpmFolder(spec, await npm, doFetch)
  const skill = await fetchFolder(spec, opts)
  return { ...skill, related: relatedSkills(skill.text) }
}

/** Several names, comma-separated, resolved in order and applied as a chain. */
export async function resolveSkillChain(spec: string, opts: SkillOptions = {}): Promise<ResolvedSkill> {
  const names = spec.split(',').map((x) => x.trim()).filter(Boolean)
  if (names.length > 5) throw new Error('A chain takes at most 5 skills.')
  return chainSkills(await Promise.all(names.map((n) => resolveSkill(n, opts))))
}

/** Skill names from the repo's skills.sh.json groupings (one request), or its skills/ folder. */
export async function listSkills(opts: SkillOptions = {}): Promise<SkillListItem[]> {
  const local = opts.localDir === undefined ? process.env.MUSHI_UX_SKILLS_DIR : opts.localDir
  const fromIndex = (index: unknown): SkillListItem[] | null => {
    const groupings = (index as { groupings?: Array<{ title?: string; skills?: unknown[] }> } | null)?.groupings
    if (!Array.isArray(groupings)) return null
    return groupings.flatMap((g) =>
      (g.skills ?? []).filter((s): s is string => typeof s === 'string' && SLUG_RE.test(s)).map((name) => ({ name, group: g.title ?? null })),
    )
  }
  if (local && existsSync(join(local, 'skills'))) {
    let index: unknown = null
    try {
      index = JSON.parse(readFileSync(join(local, 'skills.sh.json'), 'utf8'))
    } catch {
      // No index (or a broken one): the folders alone, ungrouped.
    }
    const dirs = readdirSync(join(local, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
    return mergeSkillList(dirs, fromIndex(index))
  }
  const doFetch = opts.fetch ?? fetch
  const npm = npmSource(opts.repo ?? DEFAULT_SKILLS_REPO, doFetch)
  if (npm) {
    const src = await npm
    const dirs = [...new Set(src.files.map((f) => f.match(/^\/skills\/([^/]+)\/SKILL\.md$/)?.[1]).filter((d): d is string => Boolean(d)))]
    let index: unknown = null
    if (src.files.includes('/skills.sh.json')) {
      const res = await doFetch(cdnUrl(src, '/skills.sh.json'), { headers: { 'User-Agent': 'mushi-ux' } })
      index = res.ok ? await res.json().catch(() => null) : null
    }
    return mergeSkillList(dirs, fromIndex(index))
  }
  const { owner, repo, ref } = parseRepo(opts.repo)
  const res = await doFetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/skills.sh.json`, { headers: { 'User-Agent': 'mushi-ux' } })
  const listed = res.ok ? fromIndex(await res.json().catch(() => null)) : null
  const dirs = (await fetchJson(doFetch, `https://api.github.com/repos/${owner}/${repo}/contents/skills?ref=${encodeURIComponent(ref)}`)) as Array<{ type: string; name: string }> | null
  // The folder listing can fail (GitHub's unauthenticated limit is 60 an hour): then the index is all there is.
  if (!dirs) return listed ?? []
  return mergeSkillList(
    dirs.filter((d) => d.type === 'dir').map((d) => d.name),
    listed,
  )
}

/**
 * Pure: the skills that exist (one folder each), grouped as the index groups
 * them. The index can be stale both ways (kensaurus/skills 2.4.0 listed 22
 * skills folded into references and missed enhance-mobile-native-feel), so it
 * only names groups: a folder it misses goes under "Other", a name it lists
 * without a folder is left out.
 * @internal Exported for tests only.
 */
export function mergeSkillList(dirs: string[], index: SkillListItem[] | null): SkillListItem[] {
  const exists = new Set(dirs.filter((d) => SLUG_RE.test(d)))
  const grouped = (index ?? []).filter((s) => exists.has(s.name))
  const seen = new Set(grouped.map((s) => s.name))
  const rest = [...exists].filter((d) => !seen.has(d)).sort()
  return [...grouped, ...rest.map((name) => ({ name, group: index?.length ? 'Other' : null }))]
}
