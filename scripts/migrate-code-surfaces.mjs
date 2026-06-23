#!/usr/bin/env node
/**
 * One-shot migrator: hand-rolled <pre> blocks using flat surface-overlay fills
 * → inverted `mushi-code-block` / `mushi-code-body` chrome.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ADMIN_SRC = join(ROOT, 'apps/admin/src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(p)
  }
  return out
}

const OVERLAY_BG =
  /\bbg-surface-overlay(?:\/(?:40|50|60|80))?\b/g
const FLAT_SURFACE = /\bbg-surface-raised\b/g
const MUTED_TEXT = /\btext-fg-(?:muted|secondary)\b/g
const EDGE_BORDER = /\bborder-edge-subtle(?:\/50)?\b/g

let changed = 0

for (const file of walk(ADMIN_SRC)) {
  let src = readFileSync(file, 'utf8')
  if (!/<pre\s+className=/.test(src)) continue
  if (!OVERLAY_BG.test(src) && !/<pre className="[^"]*bg-surface-raised/.test(src)) continue

  OVERLAY_BG.lastIndex = 0
  const next = src.replace(
    /(<pre\s+className=")([^"]*)(")/g,
    (_m, open, cls, close) => {
      if (!OVERLAY_BG.test(cls) && !FLAT_SURFACE.test(cls)) return _m
      OVERLAY_BG.lastIndex = 0
      FLAT_SURFACE.lastIndex = 0
      let c = cls
        .replace(OVERLAY_BG, '')
        .replace(FLAT_SURFACE, '')
        .replace(MUTED_TEXT, '')
        .replace(EDGE_BORDER, 'border-code-surface-border')
        .replace(/\s{2,}/g, ' ')
        .trim()
      if (!c.includes('mushi-code-block')) {
        c = `mushi-code-block mushi-code-body ${c}`.trim()
      }
      return `${open}${c}${close}`
    },
  )
  if (next !== src) {
    writeFileSync(file, next)
    changed++
  }
}

console.log(`[migrate-code-surfaces] updated ${changed} file(s)`)
