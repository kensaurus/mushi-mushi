#!/usr/bin/env node
/**
 * check-landing-voice.mjs
 *
 * @deprecated Delegates to check-public-voice.mjs. Kept so stale doc references
 * and direct `node scripts/check-landing-voice.mjs` invocations keep working.
 *
 * Run: node scripts/check-landing-voice.mjs
 */

import { spawnSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dir = fileURLToPath(new URL('.', import.meta.url))
const delegate = join(__dir, 'check-public-voice.mjs')

console.warn(
  '[check-landing-voice] Deprecated — use `pnpm check:public-voice` (scripts/check-public-voice.mjs).',
)

const result = spawnSync(process.execPath, [delegate], { stdio: 'inherit' })
process.exit(result.status ?? 1)
