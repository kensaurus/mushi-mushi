#!/usr/bin/env node
/**
 * mushi-install-doctor.mjs
 *
 * Diagnoses and optionally cleans up npm-introduced stale temp directories
 * that block `npm install` upgrades for `@mushi-mushi/*` packages.
 *
 * ROOT CAUSE
 * ----------
 * npm uses a write-to-temp-then-rename strategy for installing packages.
 * On Windows + OneDrive (the glot.it dev environment) the rename can fail
 * because OneDrive holds file handles open, leaving behind directories named
 * `@mushi-mushi/.core-uTuX2Ax6` or similar. The next `npm install` finds
 * these directories and bails with ENOTEMPTY.
 *
 * HOW TO USE
 * ----------
 * This script is NOT a postinstall hook (those break --ignore-scripts users
 * and are a security smell). Run it manually when you hit ENOTEMPTY:
 *
 *   npx @mushi-mushi/cli doctor install
 *
 * Or directly:
 *
 *   node scripts/mushi-install-doctor.mjs
 *
 * Pass --fix to remove found directories (default: dry-run, list only).
 */

import { readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const FIX_FLAG = process.argv.includes('--fix')
const YES_FLAG = process.argv.includes('--yes') || process.argv.includes('-y')

// Scan these directories for stale @mushi-mushi temp dirs.
const SCAN_ROOTS = [
  resolve(process.cwd(), 'node_modules', '@mushi-mushi'),
]

// Stale temp dir pattern: `.something-XXXXXXXX` (dot-prefix + alphanumeric suffix)
const TEMP_DIR_PATTERN = /^\..+-[A-Za-z0-9]{6,}$/

function scanForStaleDirs(root) {
  if (!existsSync(root)) return []
  try {
    return readdirSync(root)
      .filter((name) => TEMP_DIR_PATTERN.test(name))
      .map((name) => join(root, name))
      .filter((full) => {
        try { return statSync(full).isDirectory() } catch { return false }
      })
  } catch {
    return []
  }
}

async function main() {
  console.log('🔬 Mushi Install Doctor — scanning for stale temp directories…\n')

  const found = SCAN_ROOTS.flatMap(scanForStaleDirs)

  if (found.length === 0) {
    console.log('✅ No stale temp directories found. Your node_modules look clean.\n')
    console.log('If you still see ENOTEMPTY, try:\n')
    console.log('  npm cache clean --force')
    console.log('  rm -rf node_modules && npm install\n')
    return
  }

  console.log(`Found ${found.length} stale temp director${found.length === 1 ? 'y' : 'ies'}:\n`)
  found.forEach((dir) => console.log(`  ${dir}`))
  console.log()

  if (!FIX_FLAG) {
    console.log('Run with --fix to remove them, or manually:\n')
    console.log(`  rm -rf ${found.join(' ')}\n`)
    console.log('Then re-run npm install.\n')
    return
  }

  let confirmed = YES_FLAG
  if (!confirmed) {
    const rl = createInterface({ input, output })
    const answer = await rl.question('Remove these directories? [y/N] ')
    rl.close()
    confirmed = answer.trim().toLowerCase() === 'y'
  }

  if (!confirmed) {
    console.log('\nAborted. No files were changed.')
    return
  }

  let removed = 0
  let failed = 0
  for (const dir of found) {
    try {
      rmSync(dir, { recursive: true, force: true })
      console.log(`  ✓ Removed ${dir}`)
      removed++
    } catch (err) {
      console.error(`  ✗ Failed to remove ${dir}: ${err.message}`)
      failed++
    }
  }

  console.log(`\n${removed} removed, ${failed} failed.\n`)

  if (failed > 0) {
    console.log('For locked directories (OneDrive sync active), try:\n')
    console.log('  1. Pause OneDrive sync')
    console.log('  2. Run this doctor again (--fix --yes)')
    console.log('  3. Resume OneDrive sync\n')
  } else {
    console.log('✅ Done — re-run npm install now.\n')
  }
}

main().catch((err) => {
  console.error('Doctor error:', err.message)
  process.exit(1)
})
