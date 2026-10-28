/**
 * Empty fields on Settings and Integrations showed the owner's own repos and
 * machines ("kensaurus/mushi-mushi", "alienware-glot-1") and values that read
 * as saved data (a full Sentry DSN, "bot@acme.com"), so a new user could not
 * tell an empty field from a filled one (first-time user test, 2026-10-28).
 * Placeholders carry no real names, and a whole-value example says "e.g.".
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIRS = ['.', '../integrations', '../sdk-install'].map((d) => join(__dirname, d))

function placeholders(): Array<{ file: string; value: string }> {
  const out: Array<{ file: string; value: string }> = []
  for (const dir of DIRS) {
    for (const name of readdirSync(dir)) {
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue
      const src = readFileSync(join(dir, name), 'utf8')
      for (const m of src.matchAll(/placeholder(?:=\{?|:\s*)(['"])((?:\\.|(?!\1).)*)\1/g)) {
        out.push({ file: name, value: m[2] })
      }
    }
  }
  return out
}

describe('Settings and Integrations placeholders', () => {
  const all = placeholders()

  it('finds the placeholders it checks', () => {
    expect(all.length).toBeGreaterThan(40)
  })

  it("never shows the owner's own repos, machines or teams", () => {
    const leaks = all.filter((p) => /kensaurus|atpeak|alienware|tsumagoi|solo-boss|sbc-visual/i.test(p.value))
    expect(leaks).toEqual([])
  })

  it('marks a whole URL, address or email as an example', () => {
    const looksReal = all.filter(
      (p) => /https?:\/\/|@|\.(com|io|co|net)\b/.test(p.value) && !p.value.endsWith('…') && !p.value.startsWith('e.g. '),
    )
    expect(looksReal).toEqual([])
  })
})
