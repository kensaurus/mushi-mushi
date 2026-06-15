#!/usr/bin/env node
/**
 * One-shot codemod: replace known AA-failing chip class combos with foreground tokens.
 * Safe to re-run (idempotent on already-fixed strings).
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../apps/admin/src')

const REPLACEMENTS = [
  ['bg-accent/15 text-accent', 'bg-accent-muted/55 text-accent-foreground'],
  ['bg-accent/10 text-accent', 'bg-accent-muted/55 text-accent-foreground'],
  ['bg-accent-muted text-accent', 'bg-accent-muted/70 text-accent-foreground'],
  ['bg-accent-muted/40 text-accent', 'bg-accent-muted/55 text-accent-foreground'],
  ['bg-accent-muted/35 text-accent', 'bg-accent-muted/55 text-accent-foreground'],
  ['text-accent-muted', 'text-accent-foreground'],
  ['bg-warn/10 text-warn', 'bg-warn-muted/50 text-warning-foreground'],
  ['bg-warn/15 text-warn', 'bg-warn-muted/50 text-warning-foreground'],
  ['bg-danger/10 text-danger', 'bg-danger-muted/50 text-danger-foreground'],
  ['bg-danger/15 text-danger', 'bg-danger-muted/50 text-danger-foreground'],
  ['bg-info/10 text-info', 'bg-info-muted/50 text-info-foreground'],
  ['bg-ok/10 text-ok', 'bg-ok-muted/50 text-ok-foreground'],
  ['border border-accent/40 text-accent', 'border border-accent/35 bg-accent-muted/55 text-accent-foreground'],
  ['border-accent/40 text-accent', 'border-accent/35 bg-accent-muted/55 text-accent-foreground'],
  ['border border-accent/30 text-accent', 'border border-accent/30 bg-accent-muted/55 text-accent-foreground'],
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules') continue
      walk(p, out)
    } else if (/\.(tsx|ts|css)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

let filesChanged = 0
let totalReplacements = 0

for (const file of walk(ROOT)) {
  let src = readFileSync(file, 'utf8')
  let changed = false
  for (const [from, to] of REPLACEMENTS) {
    if (src.includes(from)) {
      const n = src.split(from).length - 1
      src = src.split(from).join(to)
      totalReplacements += n
      changed = true
    }
  }
  if (changed) {
    writeFileSync(file, src)
    filesChanged++
  }
}

console.log(`chip-contrast: ${totalReplacements} replacements in ${filesChanged} files`)
