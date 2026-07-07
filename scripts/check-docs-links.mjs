#!/usr/bin/env node
/**
 * Fail when a docs link points at a page/file that doesn't exist.
 *
 *   pnpm check:docs-drift   (runs this + check-docs-versions.mjs)
 *   node scripts/check-docs-links.mjs
 *
 * A broader companion to scripts/check-internal-doc-links.mjs. That guard only
 * looks at same-line markdown `](/route)` links in `.mdx`; this one also covers
 * the link surfaces docs pick up as they grow, so a future broken link is
 * caught the day it lands rather than shipping a 404 (the class that let a
 * `/sdks/mcp-tools.generated` link rot across pages):
 *   - `.md` files as well as `.mdx`
 *   - relative links (`./x`, `../x/y`) resolved against the file on disk
 *   - JSX `href="/route"` / `href={'/route'}` (Nextra <Cards>/<Card>), which the
 *     markdown-only regex never sees
 *
 * Absolute `/route` resolution mirrors check-internal-doc-links.mjs (Nextra flat
 * routing: /a/b → content/a/b.mdx or content/a/b/index.mdx) including the same
 * app-router and asset exceptions, so the two guards agree on shared links.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const CONTENT = path.join(ROOT, "apps/docs/content")

// Routes served by the Next.js app router (apps/docs/app/**) rather than Nextra
// content MDX. Keep in sync with check-internal-doc-links.mjs.
const APP_ROUTER_ROUTES = ["/connect"]
// Static/served-elsewhere targets that don't resolve to a content MDX route.
const SKIP_PREFIXES = ["/integrations/cursor.cursorrules"]
// Asset extensions live under public/ or are served externally — resolving them
// here is noisy and out of scope (this guard is about doc-to-doc navigation).
const ASSET_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
  ".css", ".js", ".mjs", ".json", ".txt", ".pdf", ".zip", ".xml", ".woff", ".woff2",
])

function walkDocs(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walkDocs(full, acc)
    else if (name.endsWith(".mdx") || name.endsWith(".md")) acc.push(full)
  }
  return acc
}

/** Nextra flat routing: /a/b → content/a/b.mdx or content/a/b/index.mdx. */
function absoluteRouteExists(route) {
  const clean = route.replace(/^\//, "").replace(/\/$/, "")
  if (!clean) return existsSync(path.join(CONTENT, "index.mdx"))
  if (existsSync(path.join(CONTENT, `${clean}.mdx`))) return true
  if (existsSync(path.join(CONTENT, `${clean}.md`))) return true
  return existsSync(path.join(CONTENT, clean, "index.mdx"))
}

/** Resolve a relative link against the linking file's directory. */
function relativeTargetExists(fromFile, target) {
  const base = path.resolve(path.dirname(fromFile), target)
  const candidates = [
    base,
    `${base}.mdx`,
    `${base}.md`,
    path.join(base, "index.mdx"),
    path.join(base, "index.md"),
  ]
  return candidates.some((c) => existsSync(c))
}

function extRelevant(target) {
  const ext = path.extname(target.split(/[#?]/)[0]).toLowerCase()
  return !ASSET_EXT.has(ext)
}

// Markdown `](target)` and JSX `href="target"` / `href={'target'}` / `href={"target"}`.
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g
const JSX_HREF = /href=(?:\{)?["']([^"']+)["']/g

function isExternal(target) {
  return (
    /^https?:/.test(target) ||
    target.startsWith("//") ||
    target.startsWith("mailto:") ||
    target.startsWith("tel:") ||
    target.startsWith("#")
  )
}

const findings = []
const files = walkDocs(CONTENT)

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const source = readFileSync(file, "utf8")

  const targets = []
  for (const re of [MARKDOWN_LINK, JSX_HREF]) {
    re.lastIndex = 0
    for (const m of source.matchAll(re)) {
      targets.push({ raw: m[1], index: m.index })
    }
  }

  for (const { raw, index } of targets) {
    if (isExternal(raw)) continue
    const target = raw.split(/[#?]/)[0] // strip anchor/query
    if (!target) continue // pure anchor
    if (!extRelevant(raw)) continue
    if (SKIP_PREFIXES.some((p) => target === p || target.startsWith(`${p}/`))) continue

    if (target.startsWith("/")) {
      if (APP_ROUTER_ROUTES.some((r) => target === r || target.startsWith(`${r}/`))) continue
      if (!absoluteRouteExists(target)) {
        const line = source.slice(0, index).split(/\r?\n/).length
        findings.push(`${rel}:${line} dead internal link ${raw}`)
      }
    } else if (target.startsWith("./") || target.startsWith("../")) {
      if (!relativeTargetExists(file, target)) {
        const line = source.slice(0, index).split(/\r?\n/).length
        findings.push(`${rel}:${line} dead relative link ${raw}`)
      }
    }
    // bare `word` targets (no leading / . ) are treated as external refs and skipped
  }
}

if (findings.length > 0) {
  console.error("Docs link check failed:\n" + findings.map((f) => `- ${f}`).join("\n"))
  process.exit(1)
}

console.log(`Docs link check passed (${files.length} files).`)
