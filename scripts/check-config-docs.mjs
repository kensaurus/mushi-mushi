#!/usr/bin/env node
/**
 * FILE: scripts/check-config-docs.mjs
 * PURPOSE: Pre-commit / CI guard that fails when `docs/CONFIG_REFERENCE.md`
 *          drifts from `apps/admin/src/lib/configDocs.ts`. Mirrors the
 *          existing `check-mcp-catalog-sync.mjs` pattern so contributors only
 *          have one drift workflow to learn.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GEN = resolve(__dirname, 'generate-config-reference.mjs')

const child = spawn(process.execPath, [GEN, 'check'], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
