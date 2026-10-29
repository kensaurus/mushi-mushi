/**
 * FILE: apps/admin/src/lib/stripAnsi.test.ts
 * PURPOSE: stripAnsi lives in lib so report truth can clean hook output
 *          without importing a component.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stripAnsi } from './stripAnsi'

describe('stripAnsi', () => {
  it('drops a real escape and a double-encoded lefthook color', () => {
    expect(stripAnsi('pre \\u001b[38;2;56;56;56m│\\u001b[0m post')).toBe('pre │ post')
    expect(stripAnsi('pre \u001b[38;2;56;56;56m│\u001b[0m post')).toBe('pre │ post')
  })

  it('is defined in lib, and lib modules do not import it from a component', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const self = readFileSync(join(dir, 'stripAnsi.ts'), 'utf8')
    expect(self).not.toContain('components/')
    for (const file of ['fixReportTruth.ts', 'reportDiagnosisNodes.ts']) {
      const src = readFileSync(join(dir, file), 'utf8')
      expect(src).not.toContain('components/report-detail/reportLogFormat')
      expect(src).toContain("from './stripAnsi'")
    }
  })
})
