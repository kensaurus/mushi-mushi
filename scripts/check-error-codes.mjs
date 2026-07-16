#!/usr/bin/env node
/**
 * FILE: scripts/check-error-codes.mjs
 * PURPOSE: Drift guard for the API error-code registry ↔ OpenAPI ↔ docs catalog.
 *          Part of `pnpm check:drift`.
 */

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GEN = resolve(__dirname, 'generate-error-catalog.mjs')

const child = spawn(process.execPath, [GEN, '--check'], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
