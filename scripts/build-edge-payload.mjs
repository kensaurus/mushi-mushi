#!/usr/bin/env node
// Reads a single edge function and all shared files, prints the JSON payload
// expected by the Supabase MCP `deploy_edge_function` tool's `files` field.
//
// Usage: node scripts/build-edge-payload.mjs <function-name>

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const fnName = process.argv[2]
if (!fnName) {
  console.error('Usage: node scripts/build-edge-payload.mjs <function-name>')
  process.exit(1)
}

const root = 'packages/server/supabase/functions'
const sharedDir = join(root, '_shared')
const fnDir = join(root, fnName)

const files = []

// Add the function index
files.push({
  name: `functions/${fnName}/index.ts`,
  content: readFileSync(join(fnDir, 'index.ts'), 'utf8'),
})

// Add all shared files (small enough that we always bundle all)
for (const fname of readdirSync(sharedDir)) {
  if (!fname.endsWith('.ts')) continue
  files.push({
    name: `functions/_shared/${fname}`,
    content: readFileSync(join(sharedDir, fname), 'utf8'),
  })
}

// Add .well-known if present (api function only)
try {
  const wkDir = join(fnDir, '.well-known')
  for (const fname of readdirSync(wkDir)) {
    files.push({
      name: `functions/${fnName}/.well-known/${fname}`,
      content: readFileSync(join(wkDir, fname), 'utf8'),
    })
  }
} catch { /* no .well-known */ }

process.stdout.write(JSON.stringify(files))
