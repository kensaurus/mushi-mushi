// scripts/marketing/post-devto.mjs
//
// Publishes a markdown post under docs/marketing/posts/<slug>.md to dev.to
// via their first-class JSON API. dev.to is the highest-leverage technical
// blog platform for OSS devtools — its tag system surfaces posts to
// developers searching for a tech stack, and the canonical_url field
// lets us cross-post without SEO penalty if/when we add our own blog.
//
// Posts are uploaded as DRAFTS by default. Final publish requires
// `--publish` so a typo in front-matter never goes live by accident.
//
// Front-matter contract (YAML at the top of every post):
//   ---
//   title: 60 seconds from "this is broken" to a draft PR
//   tags: [ai, opensource, devtools, productivity]
//   description: A 90-second walkthrough of the Mushi auto-fix loop.
//   cover_image: https://kensaur.us/mushi-mushi/og-card.png   # optional
//   canonical_url: https://kensaur.us/mushi-mushi/blog/auto-fix-loop  # optional
//   ---
//
// Usage:
//   node scripts/marketing/post-devto.mjs <slug>           # upload as draft
//   node scripts/marketing/post-devto.mjs <slug> --publish # upload + publish
//   node scripts/marketing/post-devto.mjs <slug> --dry     # show parsed fields
//
// Idempotency:
//   The script asks dev.to for the user's existing articles and matches
//   by `title`. If a match exists it does PUT /api/articles/{id} so
//   re-runs update the existing post in place rather than creating
//   duplicates.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadEnv, need, parseArgs, REPO_ROOT, step, ok, warn, err, announceDryRun } from './lib.mjs'

loadEnv()
const args = parseArgs()
announceDryRun(args)

const slug = args._[0]
if (!slug) {
  err('Usage: node scripts/marketing/post-devto.mjs <slug> [--publish] [--dry]')
  process.exit(1)
}

const path = resolve(REPO_ROOT, 'docs/marketing/posts', `${slug}.md`)
if (!existsSync(path)) {
  err(`Post not found: ${path}`)
  process.exit(1)
}

const raw = readFileSync(path, 'utf8')

// --- front-matter parse --------------------------------------------------

// Tiny YAML-subset parser sufficient for the fields we care about. We
// deliberately do not pull in `gray-matter` to keep the script
// zero-dependency like the rest of scripts/.
function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) {
    err('Post is missing the YAML front-matter block (--- ... ---).')
    process.exit(1)
  }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const eq = line.indexOf(':')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    } else {
      value = value.replace(/^['"]|['"]$/g, '')
    }
    meta[key] = value
  }
  return { meta, body: m[2] }
}

const { meta, body } = parseFrontMatter(raw)

if (!meta.title) {
  err('Post front-matter must include a `title` field.')
  process.exit(1)
}

// dev.to caps tags at 4 and requires lowercase alphanumerics.
const tags = (Array.isArray(meta.tags) ? meta.tags : [])
  .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ''))
  .filter(Boolean)
  .slice(0, 4)
if (tags.length < (Array.isArray(meta.tags) ? meta.tags.length : 0)) {
  warn(`Trimmed tags to ${tags.length} (dev.to caps at 4): ${tags.join(', ')}`)
}

const article = {
  title: meta.title,
  body_markdown: body.trimStart(),
  published: Boolean(args.publish),
  tags,
  description: meta.description || undefined,
  main_image: meta.cover_image || undefined,
  canonical_url: meta.canonical_url || undefined,
}

step(`Slug:       ${slug}`)
step(`Title:      ${meta.title}`)
step(`Tags:       ${tags.join(', ') || '(none)'}`)
step(`Published:  ${article.published ? 'YES (live on dev.to)' : 'no (draft)'}`)
step(`Body chars: ${body.trim().length}`)

if (args.dry) {
  process.exit(0)
}

const apiKey = need('DEVTO_API_KEY', 'Get one at https://dev.to/settings/extensions (free).')

const headers = {
  'api-key': apiKey,
  'Content-Type': 'application/json',
  Accept: 'application/vnd.forem.api-v1+json',
}

// --- existing-by-title lookup so re-runs update in place ------------------

step('Checking for an existing article with this title...')
const listRes = await fetch('https://dev.to/api/articles/me/all?per_page=100', {
  headers,
})
if (!listRes.ok) {
  err(`Failed to list articles: HTTP ${listRes.status}`)
  console.error(await listRes.text())
  process.exit(1)
}
const list = await listRes.json()
const existing = list.find((a) => a.title === meta.title)

let res, created
if (existing) {
  step(`Updating existing article #${existing.id}...`)
  res = await fetch(`https://dev.to/api/articles/${existing.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ article }),
  })
  created = false
} else {
  step('Creating new article...')
  res = await fetch('https://dev.to/api/articles', {
    method: 'POST',
    headers,
    body: JSON.stringify({ article }),
  })
  created = true
}

if (!res.ok) {
  err(`dev.to ${created ? 'POST' : 'PUT'} failed: HTTP ${res.status}`)
  console.error(await res.text())
  process.exit(1)
}

const json = await res.json()
ok(
  `${created ? 'Created' : 'Updated'} article #${json.id} — ${json.url ?? `https://dev.to${json.path}`}`,
)
if (!article.published) {
  warn('Article saved as draft. Re-run with --publish when ready to go live.')
}
