/**
 * A CHECK constraint that calls a function needs EXECUTE on it for every role
 * that writes the table, on every insert and update (PostgreSQL runs all of a
 * row's CHECKs, not only those on changed columns). 20261022010615 revoked
 * EXECUTE on private.text_items_within from everyone while a project_settings
 * CHECK called it, and every settings save failed until 20261022012449
 * granted it back. Repo checks passed because nothing ran the migration as
 * the API's role.
 *
 * Rule: a function named inside a CHECK in any migration, if any migration
 * revokes EXECUTE on it, must also be granted EXECUTE to service_role.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = resolve(__dirname, '../../supabase/migrations')
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const sql = files.map((f) => readFileSync(resolve(DIR, f), 'utf8')).join('\n')

/** schema.fn names called inside CHECK ( … ) clauses. */
function functionsInChecks(text: string): Set<string> {
  const out = new Set<string>()
  const re = /CHECK\s*\(/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
      i++
    }
    const body = text.slice(start, i - 1)
    for (const call of body.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/gi)) {
      if (['public', 'private', 'mushi'].includes(call[1].toLowerCase())) out.add(`${call[1]}.${call[2]}`.toLowerCase())
    }
  }
  return out
}

function revoked(text: string, fn: string): boolean {
  return new RegExp(`REVOKE\\s+(ALL|EXECUTE)[^;]*ON\\s+FUNCTION\\s+${fn.replace('.', '\\.')}\\s*\\(`, 'i').test(text)
}

function grantedToService(text: string, fn: string): boolean {
  return new RegExp(`GRANT\\s+(ALL|EXECUTE)[^;]*ON\\s+FUNCTION\\s+${fn.replace('.', '\\.')}\\s*\\([^;]*TO[^;]*\\bservice_role\\b`, 'i').test(text)
}

describe('functions called by CHECK constraints', () => {
  it('finds the CHECK that broke settings saves', () => {
    expect(functionsInChecks(sql)).toContain('private.text_items_within')
  })

  it('are executable by service_role whenever a migration revokes them', () => {
    const missing = [...functionsInChecks(sql)].filter((fn) => revoked(sql, fn) && !grantedToService(sql, fn))
    expect(missing).toEqual([])
  })
})
