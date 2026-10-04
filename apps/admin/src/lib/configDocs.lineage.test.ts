/// <reference types="node" />
/**
 * FILE: apps/admin/src/lib/configDocs.lineage.test.ts
 * PURPOSE: Every help popover that says "Writes: <table>.<column>" must name a
 *          table the database really has, and every "Read by" name that looks
 *          like an edge function must be one. The checks read the migrations
 *          (every `create table` name and every `cron.schedule` job name) and
 *          the edge function directories, so a doc entry that points at a
 *          table, function or cron nobody created fails here instead of
 *          misleading the reader in the console.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ALL_CONFIG_DOCS } from './configDocs'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/server/supabase/migrations')
const FUNCTIONS_DIR = resolve(REPO_ROOT, 'packages/server/supabase/functions')

const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi
const CRON_SCHEDULE_RE = /cron\.schedule\(\s*'([^']+)'/gi
/** A leading kebab-case token, e.g. `fix-worker` in "fix-worker edge function". */
const KEBAB_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/

function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
}

function migrationTableNames(): Set<string> {
  const names = new Set<string>()
  for (const sql of migrationSql()) {
    for (const m of sql.matchAll(CREATE_TABLE_RE)) names.add(m[1].toLowerCase())
  }
  return names
}

function knownReaders(): Set<string> {
  const names = new Set<string>()
  for (const entry of readdirSync(FUNCTIONS_DIR)) {
    if (!entry.startsWith('_') && statSync(join(FUNCTIONS_DIR, entry)).isDirectory()) names.add(entry)
  }
  for (const sql of migrationSql()) {
    for (const m of sql.matchAll(CRON_SCHEDULE_RE)) names.add(m[1])
  }
  return names
}

describe('configDocs backend lineage', () => {
  it('names only tables that a migration creates', () => {
    const tables = migrationTableNames()
    expect(tables.size, 'no create table statements found under migrations/').toBeGreaterThan(0)

    const missing = ALL_CONFIG_DOCS.filter((doc) => doc.backend?.table !== undefined)
      .filter((doc) => !tables.has(String(doc.backend?.table).toLowerCase()))
      .map((doc) => `${doc.id} -> ${doc.backend?.table}`)

    expect(missing, `Tables not created by any migration:\n${missing.join('\n')}`).toEqual([])
  })

  it('names only readers that exist as an edge function or a pg_cron job', () => {
    const readers = knownReaders()
    expect(readers.has('api'), 'functions directory not found').toBe(true)

    const missing: string[] = []
    for (const doc of ALL_CONFIG_DOCS) {
      for (const reader of doc.backend?.readBy ?? []) {
        const name = reader.trim().split(/[\s,]+/)[0] ?? ''
        if (KEBAB_NAME_RE.test(name) && !readers.has(name)) missing.push(`${doc.id} -> ${reader}`)
      }
    }

    expect(missing, `Readers that are not an edge function or cron job:\n${missing.join('\n')}`).toEqual([])
  })
})
