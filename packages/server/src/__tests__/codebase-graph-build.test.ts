import { describe, it, expect } from 'vitest'
import { fingerprintFile } from '../../supabase/functions/_shared/codebase-graph-build.ts'

describe('fingerprintFile', () => {
  it('is stable for the same preview', () => {
    const row = {
      id: '1',
      file_path: 'lib/a.ts',
      symbol_name: null,
      signature: null,
      line_start: null,
      line_end: null,
      language: 'typescript',
      content_preview: "import './b'\nexport const x = 1",
      content_hash: 'abc',
    }
    const a = fingerprintFile(row)
    const b = fingerprintFile(row)
    expect(a).toEqual(b)
    expect(a.importCount).toBeGreaterThan(0)
  })
})
