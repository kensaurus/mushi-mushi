#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(resolve(ROOT, 'packages/mcp/src/catalog.ts'), 'utf8')
let admin = readFileSync(resolve(ROOT, 'apps/admin/src/lib/mcpCatalog.ts'), 'utf8')

function sliceBetween(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker)
  const e = text.indexOf(endMarker, s)
  if (s < 0 || e < 0) throw new Error(`markers not found: ${startMarker} -> ${endMarker}`)
  return text.slice(s, e).trim()
}

const pairs = [
  ['export const TOOL_CATALOG', 'export interface ResourceSpec', 'export const TOOL_CATALOG', 'export const TDD_TOOL_CATALOG'],
  ['export const RESOURCE_CATALOG', 'export interface PromptSpec', 'export const RESOURCE_CATALOG', 'export interface PromptSpec'],
  ['export const PROMPT_CATALOG', 'export interface PromptSpec', 'export const PROMPT_CATALOG', '// ── Phase 4: TDD'],
]

for (const [adminStart, adminEnd, srcStart, srcEnd] of pairs) {
  const block = sliceBetween(src, srcStart, srcEnd)
  const escapedStart = adminStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = adminEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escapedStart}[\\s\\S]*?(?=${escapedEnd})`)
  if (!re.test(admin)) throw new Error(`pattern not found in admin: ${adminStart}`)
  admin = admin.replace(re, `${block}\n\n`)
}

writeFileSync(resolve(ROOT, 'apps/admin/src/lib/mcpCatalog.ts'), admin)
console.log('[ok] synced MCP catalogs to admin mirror')
