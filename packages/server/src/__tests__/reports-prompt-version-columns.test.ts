/**
 * FILE: reports-prompt-version-columns.test.ts
 * PURPOSE: judge-batch selects reports.stage1_prompt_version and
 *          stage2_prompt_version, but only stage1 was ever added by a
 *          migration (production got stage2 out of band). A database built
 *          from the repo failed that select and judge-batch skipped every
 *          project. Pins that the migrations create every column it reads.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const SUPABASE = resolve(__dirname, '../../supabase')
const MIGRATIONS = resolve(SUPABASE, 'migrations')
const allSql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))
  .join('\n')

describe('reports prompt-version columns', () => {
  const judge = readFileSync(resolve(SUPABASE, 'functions/judge-batch/index.ts'), 'utf8')

  for (const column of ['stage1_prompt_version', 'stage2_prompt_version']) {
    it(`a migration adds reports.${column}, which judge-batch selects`, () => {
      expect(judge).toContain(column)
      expect(allSql).toMatch(
        new RegExp(`alter table (public\\.)?reports\\s+add column if not exists ${column} text;`, 'i'),
      )
    })
  }
})
