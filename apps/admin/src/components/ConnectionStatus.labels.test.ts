/**
 * Set up's Test it tab listed "Mushi Mushi Cloud REST API", "Authentication
 * (GoTrue)" and "Edge Functions API: LLM pipeline and report ingest" to a new
 * user (first-time user test, 2026-10-28). The checks now have plain names.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'ConnectionStatus.tsx'), 'utf8')

describe('ConnectionStatus labels', () => {
  it('names each check in plain words', () => {
    const checks = src.slice(src.indexOf('useState<Check[]>(['), src.indexOf('])', src.indexOf('useState<Check[]>([')))
    expect(checks).toContain("'Sign-in'")
    expect(checks).not.toMatch(/GoTrue|REST API|Edge Functions|LLM|ingest/)
  })
})
