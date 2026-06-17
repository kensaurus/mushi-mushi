#!/usr/bin/env node
/**
 * Fail when internal MDX links under apps/docs/content point at missing routes.
 *
 *   pnpm check:internal-doc-links
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const CONTENT = path.join(ROOT, "apps/docs/content")

function walkMdx(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkMdx(full, acc)
    else if (name.endsWith(".mdx")) acc.push(full)
  }
  return acc
}

/** Map /foo/bar → content/foo/bar.mdx (Nextra flat routing). */
function routeExists(route) {
  const clean = route.replace(/^\//, "").replace(/\/$/, "")
  if (!clean) return existsSync(path.join(CONTENT, "index.mdx"))
  const direct = path.join(CONTENT, `${clean}.mdx`)
  if (existsSync(direct)) return true
  const index = path.join(CONTENT, clean, "index.mdx")
  return existsSync(index)
}

const linkRe = /\]\((\/(?!\/|https?:)[^)#?]+)\)/g
const findings = []

for (const file of walkMdx(CONTENT)) {
  const rel = path.relative(ROOT, file)
  const source = readFileSync(file, "utf8")
  let match
  while ((match = linkRe.exec(source)) !== null) {
    const href = match[1]
    if (href.startsWith("/integrations/cursor.cursorrules")) continue
    if (!routeExists(href)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length
      findings.push(`${rel}:${line} dead internal link ${href}`)
    }
  }
}

if (findings.length > 0) {
  console.error("Internal doc link check failed:\n" + findings.map((f) => `- ${f}`).join("\n"))
  process.exit(1)
}

console.log(`Internal doc link check passed (${walkMdx(CONTENT).length} MDX files).`)
