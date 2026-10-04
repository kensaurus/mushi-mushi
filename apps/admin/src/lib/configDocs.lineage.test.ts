/// <reference types="node" />
/**
 * FILE: apps/admin/src/lib/configDocs.lineage.test.ts
 * PURPOSE: Every help popover that says "Writes: <table>.<column>" must name a
 *          table the database really has. The check reads the migrations and
 *          collects every `create table` name, so a doc entry that points at a
 *          table nobody created (or one that was renamed) fails here instead of
 *          misleading the reader in the console.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { ALL_CONFIG_DOCS } from './configDocs'

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..')
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages/server/supabase/migrations')

const CREATE_TABLE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi

function migrationTableNames(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith('.sql')) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const m of sql.matchAll(CREATE_TABLE_RE)) names.add(m[1].toLowerCase())
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
})
