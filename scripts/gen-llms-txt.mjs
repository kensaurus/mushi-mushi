#!/usr/bin/env node
/**
 * Generate apps/docs/public/llms.txt from the docs content tree.
 *
 *   pnpm gen:llms-txt
 *   node scripts/gen-llms-txt.mjs --check   # fail if llms.txt is stale
 *
 * Every entry follows the llmstxt.org shape `- [title](url): description`.
 * Titles and descriptions come from each page's YAML front matter
 * (scripts/lib/frontmatter.mjs) — a regex that stopped at the first
 * apostrophe used to cut "Here's what the data said" down to "Here".
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseFrontmatter } from "./lib/frontmatter.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const CONTENT = path.join(ROOT, "apps/docs/content")
const OUT = path.join(ROOT, "apps/docs/public/llms.txt")

const brand = await import(
  pathToFileURL(path.join(ROOT, "packages/brand/src/index.js")).href
)
const BASE = brand.MUSHI_CANONICAL_URLS.docs
const HOME = brand.MUSHI_CANONICAL_URLS.home

const checkMode = process.argv.includes("--check")

const ONE_LINER = brand.MUSHI_TAGLINE_V2.oneLiner

/** Link text must stay on one line and must not close the `[…]` early. */
function linkText(text) {
  return text.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim()
}

function walkMdx(dir, baseRoute = "", acc = []) {
  // Read the directory with Dirent entries so we never stat()-then-read() the
  // same path (a TOCTOU race); a missing dir simply yields no entries.
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const name = entry.name
    const full = path.join(dir, name)
    if (entry.isDirectory()) {
      walkMdx(full, `${baseRoute}/${name}`, acc)
    } else if (name.endsWith(".mdx")) {
      const slug = name === "index.mdx" ? baseRoute || "/" : `${baseRoute}/${name.replace(/\.mdx$/, "")}`
      const { data, body } = parseFrontmatter(readFileSync(full, "utf8"))
      const title = data.title || body.match(/^#\s+(.+)/m)?.[1]?.trim() || slug
      acc.push({
        route: slug.replace(/\/index$/, "") || "/",
        title: linkText(title),
        description: data.description ? data.description.replace(/\s+/g, " ").trim() : "",
      })
    }
  }
  return acc
}

const pages = walkMdx(CONTENT).sort((a, b) => a.route.localeCompare(b.route))
const byRoute = new Map(pages.map((p) => [p.route, p]))

function urlFor(route) {
  return route === "/" ? BASE : `${BASE}${route}`
}

/** A curated entry: the page's own description when it has one, else `note`. */
function curated(label, route, note = "") {
  const description = byRoute.get(route)?.description || note
  return `- [${label}](${urlFor(route)})${description ? `: ${description}` : ""}`
}

const lines = [
  "# Mushi Mushi",
  "",
  `> ${ONE_LINER}`,
  "",
  `Canonical docs: ${BASE}`,
  `Product home: ${HOME}`,
  "GitHub: https://github.com/kensaurus/mushi-mushi",
  "npm org: https://www.npmjs.com/org/mushi-mushi",
  "",
  "## Start here (MCP-first)",
  "",
  curated("Incident loop", "/quickstart/incident-loop"),
  curated("MCP server", "/quickstart/mcp"),
  curated(
    "Connect your AI client",
    "/connect",
    "One-click MCP setup for Cursor, VS Code, Windsurf, Cline, Claude and Zed, with a keyless demo.",
  ),
  curated("Choose your stack", "/quickstart"),
  curated("Pricing", "/pricing"),
  curated("Compare Mushi with Sentry, Jam and PostHog", "/compare"),
  "",
  "## SDK quickstarts",
  "",
  curated("React", "/quickstart/react"),
  curated("Web / vanilla JS", "/quickstart/web"),
  curated("React Native", "/quickstart/react-native"),
  "",
  "## SDK reference",
  "",
  curated("SDK index", "/sdks"),
  curated("Project ID & API keys", "/concepts/credentials"),
  // Labelled with the package name: the pages' own titles say what they are
  // ("React & Next.js bug reporting SDK"), and this label is how the package
  // name stays a keyword in the MCP docs index (gen-mcp-docs-index.mjs).
  curated("@mushi-mushi/web", "/sdks/web"),
  curated("@mushi-mushi/react", "/sdks/react"),
  curated("@mushi-mushi/node", "/sdks/node"),
  curated("@mushi-mushi/cli", "/sdks/cli"),
  curated("@mushi-mushi/mcp", "/sdks/mcp"),
  curated("MCP tools reference", "/sdks/mcp-tools"),
  "",
  "## All pages",
  "",
]

for (const page of pages) {
  const note = page.description ? `: ${page.description}` : ""
  lines.push(`- [${page.title}](${urlFor(page.route)})${note}`)
}

lines.push("")
const output = lines.join("\n")

if (checkMode) {
  let existing
  try {
    existing = readFileSync(OUT, "utf8")
  } catch {
    console.error(`FAIL  ${path.relative(ROOT, OUT)} missing — run pnpm gen:llms-txt`)
    process.exit(1)
  }
  if (existing !== output) {
    console.error(`FAIL  ${path.relative(ROOT, OUT)} is stale — run pnpm gen:llms-txt`)
    process.exit(1)
  }
  console.log(`llms.txt OK (${pages.length} pages)`)
} else {
  writeFileSync(OUT, output, "utf8")
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${pages.length} pages)`)
}
