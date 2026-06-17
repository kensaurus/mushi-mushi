#!/usr/bin/env node
/**
 * Generate the SDK version matrix in apps/docs/content/sdks/index.mdx
 *
 *   pnpm gen:sdk-version-matrix
 *   pnpm check:sdk-version-matrix
 */

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  replaceVersionMatrixBlock,
  renderVersionMatrixMarkdown,
} from "./lib/sdk-version-matrix.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const TARGET = path.join(ROOT, "apps/docs/content/sdks/index.mdx")

const check = process.argv.includes("--check")
const table = renderVersionMatrixMarkdown(ROOT)
const source = readFileSync(TARGET, "utf8")
const next = replaceVersionMatrixBlock(source, table)

if (check) {
  if (next !== source) {
    console.error(
      "SDK version matrix drift — run `pnpm gen:sdk-version-matrix` and commit."
    )
    process.exit(1)
  }
  console.log("SDK version matrix check passed.")
  process.exit(0)
}

writeFileSync(TARGET, next, "utf8")
console.log(`Updated ${path.relative(ROOT, TARGET)}`)
