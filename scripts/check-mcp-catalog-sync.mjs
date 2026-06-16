#!/usr/bin/env node
/**
 * FILE: scripts/check-mcp-catalog-sync.mjs
 * PURPOSE: Catalog drift guard — delegates to the authoritative implementation
 *          at packages/mcp/scripts/check-catalog-sync.mjs.
 *
 *          The canonical catalog lives in packages/mcp/src/catalog.ts.
 *          The admin copy (apps/admin/src/lib/mcpCatalog.ts) is allowed to be
 *          a subset of the canonical, but must never have entries that the
 *          canonical doesn't. The hosted HTTP MCP must also be a subset with
 *          matching scopes.
 *
 *          Run locally:   node scripts/check-mcp-catalog-sync.mjs
 *          In CI:          pnpm check:catalog-sync
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const delegatePath = resolve(__dirname, '../packages/mcp/scripts/check-catalog-sync.mjs')

const args = ['--strict-full-parity']
const child = spawn(process.execPath, [delegatePath, ...args], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
