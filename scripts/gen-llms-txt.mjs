#!/usr/bin/env node
/**
 * Generate apps/docs/public/llms.txt from the docs content tree.
 *
 *   pnpm gen:llms-txt
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const CONTENT = path.join(ROOT, "apps/docs/content")
const OUT = path.join(ROOT, "apps/docs/public/llms.txt")
const BASE = "https://docs.mushimushi.dev"

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
  "> Bug intelligence SDK — shake-to-report, AI triage, agentic fixes.",
  "",
  "Canonical docs: https://docs.mushimushi.dev",
  "GitHub: https://github.com/kensaurus/mushi-mushi",
  "npm org: https://www.npmjs.com/org/mushi-mushi",
  "",
  "## SDK quickstarts",
  "",
  `- [Choose your stack](${BASE}/quickstart)`,
  `- [React](${BASE}/quickstart/react)`,
  `- [Web / vanilla JS](${BASE}/quickstart/web)`,
  `- [React Native](${BASE}/quickstart/react-native)`,
  `- [MCP server](${BASE}/quickstart/mcp)`,
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
writeFileSync(OUT, lines.join("\n"), "utf8")
console.log(`Wrote ${path.relative(ROOT, OUT)} (${pages.length} pages)`)
