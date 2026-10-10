/**
 * FILE: packages/server/src/__tests__/cursor-max-iterations-retired.test.ts
 * PURPOSE: cursor_max_iterations is retired (owner decision 2026-10-10).
 *          Nothing enforced it — one dispatch is one Cursor v1 run — so the
 *          integrations API no longer writes it and the Cursor delivery path
 *          no longer reads it. The column stays: dropping it would be a
 *          destructive migration. The archived packages/agents adapter is
 *          left as is (ADR 0013).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const FN = resolve(__dirname, '../../supabase/functions')
const read = (p: string) => readFileSync(resolve(FN, p), 'utf8')

describe('cursor_max_iterations retired', () => {
  it('the integrations API does not accept it', () => {
    const src = read('api/routes/integrations.ts')
    const block = src.slice(src.indexOf('cursor_cloud: ['), src.indexOf('],', src.indexOf('cursor_cloud: [')))
    expect(block).toContain("'cursor_api_key_ref'")
    expect(block).not.toContain('cursor_max_iterations')
  })

  it('the Cursor delivery path does not read it', () => {
    const src = read('_shared/plugins.ts')
    expect(src).not.toMatch(/cursor_max_iterations'?\s*[,)]|select\([^)]*cursor_max_iterations/)
    expect(src).not.toContain('maxIterations')
  })
})
