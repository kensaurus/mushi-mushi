/**
 * PATCH /v1/admin/settings (Hono is stubbed under vitest, so this pins the
 * source):
 *   - every refusal carries `ok: false`, so the console shows its sentence and
 *     not `400: {"error":…}` (suspected-bugs entry 111);
 *   - refusals name settings in words, never by column name;
 *   - `reporter_notifications_enabled` is writable, by admins only, as a
 *     boolean (entry 118: the console had no way to turn it on).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(
  resolve(__dirname, '../../supabase/functions/api/routes/settings-research.ts'),
  'utf8',
)
const start = src.indexOf("app.patch('/v1/admin/settings'")
const route = src.slice(start, src.indexOf('\n  app.', start + 10))

describe('PATCH /v1/admin/settings refusals', () => {
  it('always uses the ok:false envelope', () => {
    expect(start).toBeGreaterThan(-1)
    const bare = route.match(/c\.json\(\s*\{\s*error:/g) ?? []
    expect(bare).toEqual([])
  })

  it('explains a refused branch pattern in words, not the regex', () => {
    expect(route).toContain('message: FIX_BRANCH_TEMPLATE_HELP')
    expect(src).toMatch(/const FIX_BRANCH_TEMPLATE_HELP =\s*'Branch names must start with a type and the report/)
  })

  it('names settings by label in webhook and secret refusals', () => {
    expect(route).toContain('${settingLabel(key)}: ${verdict.reason}')
    expect(route).not.toMatch(/message: `\$\{key\}/)
  })
})

describe('reporter_notifications_enabled', () => {
  it('is on the allow-list', () => {
    expect(route).toContain("'reporter_notifications_enabled',")
  })

  it('is admin-only and boolean-only', () => {
    const block = route.slice(route.indexOf("if (key === 'reporter_notifications_enabled')"))
    const body = block.slice(0, block.indexOf('continue;'))
    expect(body).toContain('requireProjectAdmin(')
    expect(body).toContain("typeof value !== 'boolean'")
  })
})
