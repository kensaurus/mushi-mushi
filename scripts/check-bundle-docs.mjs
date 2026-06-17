#!/usr/bin/env node
/**
 * Verify @mushi-mushi/web README bundle budget matches package.json size-limit.
 *
 *   pnpm check:bundle-docs
 */

import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const pkgPath = path.join(ROOT, "packages/web/package.json")
const readmePath = path.join(ROOT, "packages/web/README.md")

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
const readme = readFileSync(readmePath, "utf8")

const gzLimit = pkg["size-limit"]?.find((e) => e.gzip)?.limit
const rawLimit = pkg["size-limit"]?.find((e) => !e.gzip)?.limit

const findings = []

if (gzLimit) {
  const m = readme.match(/(\d+)\s*KB\s*gzipped/i)
  if (!m || m[1] !== String(parseInt(gzLimit, 10))) {
    findings.push(
      `README gzipped budget (${m?.[1] ?? "missing"}) != package.json (${gzLimit})`
    )
  }
}

if (rawLimit) {
  const m = readme.match(/(\d+)\s*KB\s*uncompressed/i)
  if (!m || m[1] !== String(parseInt(rawLimit, 10))) {
    findings.push(
      `README uncompressed budget (${m?.[1] ?? "missing"}) != package.json (${rawLimit})`
    )
  }
}

if (findings.length > 0) {
  console.error("Bundle docs check failed:\n" + findings.map((f) => `- ${f}`).join("\n"))
  process.exit(1)
}

console.log("Bundle docs check passed.")
