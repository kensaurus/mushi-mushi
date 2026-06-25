#!/usr/bin/env node
/**
 * check-destructive-migrations.mjs
 *
 * Scans all SQL migration files for bare DELETE / TRUNCATE statements that
 * lack a WHERE clause. Such statements in migrations are almost always
 * accidental and can cause irrecoverable data loss in production.
 *
 * Rules:
 *   - DELETE FROM <table>  without WHERE  → ERROR
 *   - TRUNCATE <table>                    → ERROR
 *   - Exceptions: lines annotated with `-- migration-check: allow-destructive`
 *     are skipped (use sparingly; add a comment explaining why it is safe).
 *
 * Usage:
 *   node scripts/check-destructive-migrations.mjs
 *   node scripts/check-destructive-migrations.mjs --dir packages/server/supabase/migrations
 */

import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const ALLOW_ANNOTATION = 'migration-check: allow-destructive'

const args = process.argv.slice(2)
const dirIndex = args.indexOf('--dir')
const migrationsDir = resolve(
  dirIndex !== -1 && args[dirIndex + 1]
    ? args[dirIndex + 1]
    : 'packages/server/supabase/migrations',
)

/** @type {{ file: string; line: number; text: string }[]} */
const violations = []

let sqlFiles
try {
  sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(migrationsDir, f))
} catch {
  console.error(`check-destructive-migrations: directory not found: ${migrationsDir}`)
  process.exit(1)
}

for (const file of sqlFiles) {
  const lines = readFileSync(file, 'utf-8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const stripped = raw.replace(/--.*$/, '').trim() // strip inline comments

    if (raw.includes(ALLOW_ANNOTATION)) continue

    // DELETE FROM <table> without WHERE on the same line
    // Pattern: DELETE (whitespace) FROM (non-WHERE content) — not followed by WHERE
    const isDelete = /^\s*DELETE\s+FROM\s+/i.test(stripped)
    if (isDelete) {
      // Collect lines up to the next semicolon (statement boundary) to handle
      // multi-line DELETE ... USING ... WHERE patterns correctly.
      const stmtLines = []
      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        stmtLines.push(lines[j])
        if (lines[j].includes(';')) break
      }
      const context = stmtLines.join(' ').toLowerCase()
      if (!/\bwhere\b/.test(context)) {
        violations.push({ file, line: i + 1, text: raw.trim() })
      }
    }

    // TRUNCATE <table> — always destructive in a migration context
    if (/^\s*TRUNCATE\s+/i.test(stripped)) {
      violations.push({ file, line: i + 1, text: raw.trim() })
    }
  }
}

if (violations.length === 0) {
  console.log(`check-destructive-migrations: ✓ no bare DELETE/TRUNCATE found in ${sqlFiles.length} migration files`)
  process.exit(0)
}

console.error('check-destructive-migrations: FAIL — found potentially destructive SQL in migration files:')
console.error('')
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`)
  console.error(`    ${v.text}`)
  console.error('')
}
console.error(
  `Found ${violations.length} violation(s). ` +
    `If this is intentional (e.g. seed cleanup), annotate the line with:\n` +
    `  -- migration-check: allow-destructive\n` +
    `and add a comment explaining why the destructive op is safe.`
)
process.exit(1)
