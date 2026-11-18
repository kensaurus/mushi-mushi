/**
 * No table may have a primary key made of both `organization_id` and `project_id`
 * (2026-11-18). PostgREST reads such a table as a many-to-many junction between
 * projects and organizations, which already relate directly, so every
 * `projects?select=…,organizations(…)` embed fails with PGRST201. ops_mutes did this
 * for a day: the org's "Run AI on: OpenAI" switch read as Claude and billing reads
 * failed. Give the table an `id` primary key and make the pair UNIQUE instead.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = resolve(__dirname, '../../supabase/migrations')
const BOTH = /\(\s*(organization_id\s*,\s*project_id|project_id\s*,\s*organization_id)\s*[,)]/i

/** Tables whose primary key, after every migration in order, holds both columns. */
export function junctionTables(files: Array<{ name: string; sql: string }>): string[] {
  const flagged = new Set<string>()
  for (const { sql } of files) {
    const text = sql.replace(/--[^\n]*/g, '')
    for (const m of text.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/gi)) {
      const pk = m[2].match(/PRIMARY KEY\s*(\([^)]*\))/i)
      if (pk && BOTH.test(pk[1].replace(/\)$/, ',)'))) flagged.add(m[1].toLowerCase())
    }
    for (const m of text.matchAll(/ALTER TABLE(?: ONLY)?\s+(?:public\.)?"?(\w+)"?\s+DROP CONSTRAINT(?: IF EXISTS)?\s+"?\w+_pkey"?/gi)) flagged.delete(m[1].toLowerCase())
    for (const m of text.matchAll(/ALTER TABLE(?: ONLY)?\s+(?:public\.)?"?(\w+)"?\s+ADD(?: CONSTRAINT\s+\w+)?\s+PRIMARY KEY\s*(\([^)]*\))/gi)) {
      if (BOTH.test(m[2].replace(/\)$/, ',)'))) flagged.add(m[1].toLowerCase())
    }
  }
  return [...flagged].sort()
}

describe('no projects↔organizations junction tables', () => {
  it('flags a composite (organization_id, project_id) key and clears it once the key is replaced', () => {
    const create = { name: 'a.sql', sql: 'CREATE TABLE IF NOT EXISTS public.t (\n  organization_id uuid,\n  project_id uuid,\n  PRIMARY KEY (organization_id, project_id)\n);' }
    expect(junctionTables([create])).toEqual(['t'])
    expect(junctionTables([create, { name: 'b.sql', sql: 'ALTER TABLE public.t DROP CONSTRAINT t_pkey;\nALTER TABLE public.t ADD CONSTRAINT t_pkey PRIMARY KEY (id);' }])).toEqual([])
    expect(junctionTables([{ name: 'c.sql', sql: 'CREATE TABLE public.u (\n  project_id uuid,\n  kind text,\n  PRIMARY KEY (project_id, kind)\n);' }])).toEqual([])
  })

  it('every migration in the repo leaves none behind', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((name) => ({ name, sql: readFileSync(resolve(DIR, name), 'utf8') }))
    expect(files.length).toBeGreaterThan(100)
    expect(junctionTables(files)).toEqual([])
  })
})
