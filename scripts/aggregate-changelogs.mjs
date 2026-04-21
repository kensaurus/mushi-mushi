#!/usr/bin/env node
// =============================================================================
// scripts/aggregate-changelogs.mjs
//
// D2: Customer-facing changelog generator.
//
// Walks every published package's auto-generated CHANGELOG.md (created by
// Changesets), groups every per-package entry by SDK release version, and
// emits two artefacts:
//
//   1. CHANGELOG.md at the repo root — a human-friendly, marketing-grade
//      changelog grouped by date (newest first), with one section per release.
//
//   2. apps/docs/data/changelog.json — a structured JSON feed the public
//      docs site consumes to render the /changelog page and the in-app
//      "What's new" toast.
//
// The script is intentionally pure and deterministic: same input always
// produces the same byte-identical output. CI can therefore commit-back the
// regenerated file or fail if the working tree drifts.
//
// Inputs:  packages/*/CHANGELOG.md  (Changesets-managed)
// Outputs: CHANGELOG.md + apps/docs/data/changelog.json
//
// Conventions (set by the `.changeset/v0_*.md` files):
//   * The first line of every changeset bullet that begins a release is an
// H1 (`# v0.X.0 — ...`). We use this as the release headline.
//   * Bullets prefixed with "- **Highlight**" are surfaced into the docs feed
//     so customers see what changed without scanning npm changelogs.
//
// Usage:
//   node scripts/aggregate-changelogs.mjs            # write files
//   node scripts/aggregate-changelogs.mjs --check    # exit 1 if drift
// =============================================================================

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PACKAGES_DIR = join(ROOT, 'packages')
const CHANGESETS_DIR = join(ROOT, '.changeset')
const OUT_MD = join(ROOT, 'CHANGELOG.md')
const OUT_JSON = join(ROOT, 'apps', 'docs', 'data', 'changelog.json')

const checkMode = process.argv.includes('--check')

/**
 * Parse a single package CHANGELOG.md (Changesets format). Returns an array
 * of { version, sections: { major: [], minor: [], patch: [] } } entries in
 * file order.
 */
function parsePackageChangelog(packageName, content) {
  const lines = content.split(/\r?\n/)
  const entries = []
  let current = null
  let currentSection = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    const versionMatch = line.match(/^##\s+([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)\s*$/)
    if (versionMatch) {
      current = { package: packageName, version: versionMatch[1], sections: {} }
      currentSection = null
      entries.push(current)
      continue
    }
    if (!current) continue

    const sectionMatch = line.match(/^###\s+(Major|Minor|Patch)\s+Changes\s*$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase()
      current.sections[currentSection] ??= []
      continue
    }

    if (!currentSection) continue

    if (line.startsWith('- ')) {
      current.sections[currentSection].push(line.slice(2))
    } else if (line.startsWith('  ') && current.sections[currentSection].length > 0) {
      const last = current.sections[currentSection].length - 1
      current.sections[currentSection][last] += '\n' + line
    }
  }

  return entries
}

/**
 * Pick the "marquee" heading from a changeset bullet body. Heuristic:
 *   - if the bullet begins with an `# vX.Y.Z — …` H1, return that
 *   - otherwise return the first sentence
 */
function extractHeadline(body) {
  const h1 = body.match(/^#\s+(.+)$/m)
  if (h1) return h1[1].trim()
  const firstLine = body.split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  return firstLine.replace(/^#+\s+/, '').replace(/\.$/, '').slice(0, 140)
}

/**
 * Pull bullets that look like "- **<Name>**: …" out of the body — these are
 * the polished one-liners we want on the public changelog.
 */
function extractHighlights(body) {
  const out = []
  const re = /^[\t ]*-\s+\*\*([^*]+)\*\*:?\s*(.+)$/gm
  let m
  while ((m = re.exec(body)) !== null) {
    out.push({ title: m[1].trim(), description: m[2].trim() })
  }
  return out
}

async function listPackages() {
  const entries = await readdir(PACKAGES_DIR)
  const packages = []
  for (const name of entries) {
    const dir = join(PACKAGES_DIR, name)
    const s = await stat(dir).catch(() => null)
    if (!s?.isDirectory()) continue
    const pkgPath = join(dir, 'package.json')
    const pkg = await readFile(pkgPath, 'utf8').catch(() => null)
    if (!pkg) continue
    const meta = JSON.parse(pkg)
    if (meta.private === true) continue
    const changelogPath = join(dir, 'CHANGELOG.md')
    const changelog = await readFile(changelogPath, 'utf8').catch(() => null)
    if (!changelog) continue
    packages.push({ name: meta.name ?? name, dir, changelog })
  }
  return packages
}

/**
 * Group per-package entries into per-version releases, where "release" means
 * "the union of all package bumps that share a major.minor (X.Y) tag".
 */
function groupByRelease(allEntries) {
  const releases = new Map()

  for (const entry of allEntries) {
    const key = entry.version.split('.').slice(0, 2).join('.')
    if (!releases.has(key)) {
      releases.set(key, {
        majorMinor: key,
        versions: new Set(),
        packages: new Map(),
        headline: null,
        highlights: [],
      })
    }
    const release = releases.get(key)
    release.versions.add(entry.version)
    if (!release.packages.has(entry.package)) release.packages.set(entry.package, [])
    release.packages.get(entry.package).push(entry)

    for (const bullets of Object.values(entry.sections)) {
      for (const body of bullets) {
        if (!release.headline) {
          const headline = extractHeadline(body)
          if (headline.startsWith('v')) {
            release.headline = headline
          }
        }
        const highlights = extractHighlights(body)
        for (const h of highlights) {
          if (release.highlights.length < 12) release.highlights.push(h)
        }
      }
    }
  }

  return [...releases.values()].sort((a, b) => semverCompare(b.majorMinor, a.majorMinor))
}

function semverCompare(a, b) {
  const [aMaRaw, aMiRaw, aPaRaw] = a.split('.')
  const [bMaRaw, bMiRaw, bPaRaw] = b.split('.')
  const aMa = Number(aMaRaw), aMi = Number(aMiRaw), aPa = Number(aPaRaw ?? 0)
  const bMa = Number(bMaRaw), bMi = Number(bMiRaw), bPa = Number(bPaRaw ?? 0)
  // Non-numeric tags ("pending", "next") sort below any real version.
  const aIsNum = Number.isFinite(aMa) && Number.isFinite(aMi)
  const bIsNum = Number.isFinite(bMa) && Number.isFinite(bMi)
  if (!aIsNum && bIsNum) return -1
  if (aIsNum && !bIsNum) return 1
  if (!aIsNum && !bIsNum) return 0
  if (aMa !== bMa) return aMa - bMa
  if (aMi !== bMi) return aMi - bMi
  return (Number.isFinite(aPa) ? aPa : 0) - (Number.isFinite(bPa) ? bPa : 0)
}

function renderMarkdown(releases) {
  const lines = [
    '# Mushi Mushi — Public Changelog',
    '',
    'Customer-facing release notes for every published `@mushi-mushi/*` SDK.',
    'For per-package, per-bullet detail see each package\'s `CHANGELOG.md`.',
    '',
    '> Auto-generated by `scripts/aggregate-changelogs.mjs` from the',
    '> Changesets-managed CHANGELOGs. Do not hand-edit.',
    '',
  ]

  for (const r of releases) {
    const versions = [...r.versions].sort((a, b) => semverCompare(b, a))
    const headline = r.headline ?? `v${r.majorMinor}.x`
    const pendingTag = r.pending ? ' *(pending release)*' : ''
    lines.push(`## ${headline}${pendingTag}`)
    lines.push('')
    if (versions[0]) {
      lines.push(`${r.pending ? 'Targeted tag' : 'Latest tag'}: \`v${versions[0]}\``)
      lines.push('')
    }

    if (r.highlights.length > 0) {
      lines.push('### Highlights')
      lines.push('')
      for (const h of r.highlights) {
        lines.push(`- **${h.title}** — ${h.description}`)
      }
      lines.push('')
    }

    const packageNames = [...r.packages.keys()].sort()
    if (packageNames.length > 0) {
      lines.push('### Packages bumped')
      lines.push('')
      for (const name of packageNames) {
        const entries = r.packages.get(name)
        const v = entries[0].version
        lines.push(`- \`${name}\` → ${v}`)
      }
      lines.push('')
    }
  }

  return lines.join('\n')
}

function renderJson(releases) {
  return releases.map((r) => ({
    majorMinor: r.majorMinor,
    headline: r.headline,
    pending: r.pending === true,
    versions: [...r.versions].sort((a, b) => semverCompare(b, a)),
    highlights: r.highlights,
    packages: [...r.packages.entries()].map(([name, entries]) => ({
      name,
      version: entries[0].version,
    })).sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

/**
 * Parse pending `.changeset/*.md` files into a synthetic "upcoming" release
 * so customers can preview what is about to ship before we tag.
 */
async function loadPendingChangeset() {
  const files = await readdir(CHANGESETS_DIR).catch(() => [])
  const perTag = new Map()
  for (const f of files) {
    if (!f.endsWith('.md') || f.toLowerCase() === 'readme.md') continue
    const body = await readFile(join(CHANGESETS_DIR, f), 'utf8')
    const fm = body.match(/^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/)
    if (!fm) continue
    const rest = fm[2].trim()
    if (!rest) continue

    const tag = f.match(/v([0-9]+_[0-9]+_[0-9]+)/)?.[1]?.replace(/_/g, '.') ?? 'pending'
    if (!perTag.has(tag)) perTag.set(tag, { headline: null, bullets: [] })
    const slot = perTag.get(tag)

    if (!slot.headline) {
      const candidate = extractHeadline(rest)
      if (candidate.startsWith('v') || candidate.startsWith('#')) {
        slot.headline = candidate
      }
    }
    for (const h of extractHighlights(rest)) {
      if (slot.bullets.length < 18) slot.bullets.push(h)
    }
  }

  if (perTag.size === 0) return null

  const sortedTags = [...perTag.keys()].sort((a, b) => semverCompare(b, a))
  const latestTag = sortedTags[0]
  const slot = perTag.get(latestTag)
  return {
    majorMinor: latestTag === 'pending' ? 'next' : latestTag.split('.').slice(0, 2).join('.'),
    versions: new Set(latestTag === 'pending' ? [] : [latestTag]),
    packages: new Map(),
    headline: slot.headline ?? `${latestTag} (pending release)`,
    highlights: slot.bullets,
    pending: true,
  }
}

async function main() {
  const packages = await listPackages()
  const allEntries = []
  for (const pkg of packages) {
    allEntries.push(...parsePackageChangelog(pkg.name, pkg.changelog))
  }

  const releases = groupByRelease(allEntries)
  const pending = await loadPendingChangeset()
  if (pending) releases.unshift(pending)
  const md = renderMarkdown(releases)
  const json = JSON.stringify(renderJson(releases), null, 2) + '\n'

  if (checkMode) {
    const [existingMd, existingJson] = await Promise.all([
      readFile(OUT_MD, 'utf8').catch(() => ''),
      readFile(OUT_JSON, 'utf8').catch(() => ''),
    ])
    if (existingMd !== md || existingJson !== json) {
      console.error('::error::CHANGELOG drift detected. Run `pnpm changelog:aggregate` and commit the result.')
      process.exit(1)
    }
    console.log(`changelog: ${releases.length} release(s) in sync`)
    return
  }

  await mkdir(dirname(OUT_JSON), { recursive: true })
  await writeFile(OUT_MD, md, 'utf8')
  await writeFile(OUT_JSON, json, 'utf8')
  console.log(`changelog: wrote ${OUT_MD}`)
  console.log(`changelog: wrote ${OUT_JSON}`)
  console.log(`changelog: ${releases.length} release(s) aggregated`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
