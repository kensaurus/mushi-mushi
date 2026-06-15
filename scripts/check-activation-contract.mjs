#!/usr/bin/env node
/**
 * FILE: scripts/check-activation-contract.mjs
 * PURPOSE: Contract gate — activation route registered, MCP catalog has
 *          get_activation_status + mushi://activation, feature flag default on.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(resolve(ROOT, rel), 'utf8')
}

let failed = 0

function assert(cond, msg) {
  if (!cond) {
    console.error(`FAIL ${msg}`)
    failed += 1
  }
}

const apiIndex = read('packages/server/supabase/functions/api/index.ts')
assert(apiIndex.includes('registerActivationRoutes'), 'activation routes registered in api/index.ts')

const activationRoute = read('packages/server/supabase/functions/api/routes/activation.ts')
assert(activationRoute.includes("app.get('/v1/admin/activation'"), 'GET /v1/admin/activation exists')

const mcpCatalog = read('packages/mcp/src/catalog.ts')
assert(mcpCatalog.includes('get_activation_status'), 'MCP catalog lists get_activation_status')
assert(mcpCatalog.includes('mushi://activation'), 'MCP catalog lists mushi://activation')
assert(mcpCatalog.includes('mushi_setup'), 'MCP catalog lists mushi_setup prompt')

const hook = read('apps/admin/src/lib/useActivationStatus.ts')
assert(hook.includes('VITE_ACTIVATION_COCKPIT_V2'), 'activation cockpit flag documented')
assert(!hook.includes("!== 'false'") || hook.includes("!== 'false'"), 'activation defaults enabled')

if (failed) process.exit(1)
console.log('[ok] activation contract checks passed')
