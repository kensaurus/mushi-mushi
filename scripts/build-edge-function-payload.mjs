// Helper used by the MCP-driven Edge Function deploy.
// Walks supabase/functions/{function}/ + supabase/functions/_shared/ and emits
// a JSON file shaped as { files: [{name, content}] } that matches the
// `deploy_edge_function` MCP tool schema.
//
// Usage: node scripts/build-edge-function-payload.mjs <function-name> <output-json>
// Example: node scripts/build-edge-function-payload.mjs api .agent-tmp/api-deploy.json

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'

const fnName = process.argv[2]
const outPath = process.argv[3]
if (!fnName || !outPath) {
  console.error('Usage: build-edge-function-payload.mjs <function-name> <output-json>')
  process.exit(2)
}

const repoRoot = join(process.cwd())
const supabaseRoot = join(repoRoot, 'packages', 'server', 'supabase')
const functionDir = join(supabaseRoot, 'functions', fnName)
const sharedDir = join(supabaseRoot, 'functions', '_shared')

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, acc)
    } else if (entry.endsWith('.ts') || entry.endsWith('.json')) {
      acc.push(full)
    }
  }
  return acc
}

const files = []
const seen = new Set()

function add(absPath) {
  const rel = relative(supabaseRoot, absPath).split(sep).join(posix.sep)
  if (seen.has(rel)) return
  seen.add(rel)
  files.push({ name: rel, content: readFileSync(absPath, 'utf8') })
}

for (const f of walk(functionDir)) add(f)
for (const f of walk(sharedDir)) add(f)

const payload = { files }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(payload))

const totalBytes = files.reduce((acc, f) => acc + f.content.length, 0)
console.log(`fn=${fnName}  files=${files.length}  bytes=${totalBytes}  outPath=${outPath}`)
