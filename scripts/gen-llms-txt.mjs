#!/usr/bin/env node
/**
 * Generate apps/docs/public/llms.txt from the docs content tree.
 *
 *   pnpm gen:llms-txt
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

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
      const source = readFileSync(full, "utf8")
      const title =
        source.match(/^title:\s*['"]?([^'"\n]+)/m)?.[1]?.trim() ??
        source.match(/^#\s+(.+)/m)?.[1]?.trim() ??
        slug
      acc.push({ route: slug.replace(/\/index$/, "") || "/", title })
    }
  }
  return acc
}

const pages = walkMdx(CONTENT).sort((a, b) => a.route.localeCompare(b.route))

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
  `- [Incident loop](${BASE}/quickstart/incident-loop)`,
  `- [MCP server](${BASE}/quickstart/mcp)`,
  `- [Choose your stack](${BASE}/quickstart)`,
  "",
  "## SDK quickstarts",
  "",
  `- [React](${BASE}/quickstart/react)`,
  `- [Web / vanilla JS](${BASE}/quickstart/web)`,
  `- [React Native](${BASE}/quickstart/react-native)`,
  "",
  "## SDK reference",
  "",
  `- [SDK index](${BASE}/sdks)`,
  `- [Project ID & API keys](${BASE}/concepts/credentials)`,
  `- [@mushi-mushi/web](${BASE}/sdks/web)`,
  `- [@mushi-mushi/cli](${BASE}/sdks/cli)`,
  `- [@mushi-mushi/mcp](${BASE}/sdks/mcp)`,
  "",
  "## All pages",
  "",
]

for (const page of pages) {
  const url = page.route === "/" ? BASE : `${BASE}${page.route}`
  lines.push(`- [${page.title}](${url})`)
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
