#!/usr/bin/env node
/**
 * Deploy mcp.kensaurus Worker — serves origin RFC 9728 PRM Smithery requires.
 *
 * Prereqs:
 *   export CLOUDFLARE_API_TOKEN=...   # Workers Scripts Edit + Zone DNS Edit
 *   DNS: mcp.kensaur.us CNAME → (worker route auto via wrangler.toml)
 *
 * Usage: node scripts/cloudflare/deploy-mcp-worker.mjs
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error(`Missing CLOUDFLARE_API_TOKEN.

Smithery OAuth discovery probes:
  https://<origin>/.well-known/oauth-protected-resource/<path>

Supabase project origins return 401 for that path (platform gateway).
Deploy this worker on mcp.kensaur.us, then republish Smithery with:
  https://mcp.kensaur.us/

See docs/marketing/GTM-DISTRIBUTION.md § Smithery`)
  process.exit(1)
}

const r = spawnSync('npx', ['wrangler', 'deploy'], {
  cwd: dir,
  stdio: 'inherit',
  shell: true,
})
process.exit(r.status ?? 1)
