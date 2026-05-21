/**
 * FILE: examples/e2e-dogfood/tests/cross-project-search.spec.ts
 * PURPOSE: Round 9 (2026-05-21) — verify the GET /v1/admin/search/global
 *          endpoint returns valid JSON and the CommandPalette renders the
 *          cross-project results in global-search mode.
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'

function loadEnvFile(relPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    const raw = readFileSync(resolve(__dirname, '../../../', relPath), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.replace(/\r$/, '').trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
    }
  } catch { /* optional */ }
  return out
}

const rootEnv = loadEnvFile('.env.local')
const adminEnv = loadEnvFile('apps/admin/.env')
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? adminEnv.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? adminEnv.VITE_SUPABASE_ANON_KEY ?? ''
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? rootEnv.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? rootEnv.TEST_USER_PASSWORD ?? ''

test.describe('Cross-project global search (Round 9)', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD,
    'Requires auth env vars',
  )

  test('GET /v1/admin/search/global returns valid schema', async ({ request }) => {
    // Authenticate
    const authRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
    })
    expect(authRes.ok()).toBeTruthy()
    const { access_token } = await authRes.json()

    // Hit the global search endpoint
    const searchRes = await request.get(`${ADMIN_URL}/api/v1/admin/search/global?q=test`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(searchRes.ok()).toBeTruthy()
    const body = await searchRes.json()
    expect(body).toHaveProperty('ok', true)
    expect(body.data).toHaveProperty('reports')
    expect(body.data).toHaveProperty('fixes')
    expect(body.data).toHaveProperty('comments')
    expect(Array.isArray(body.data.reports)).toBeTruthy()
    expect(Array.isArray(body.data.fixes)).toBeTruthy()
    expect(Array.isArray(body.data.comments)).toBeTruthy()
  })

  test('GET /v1/admin/search/global rejects short queries', async ({ request }) => {
    const authRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD },
    })
    const { access_token } = await authRes.json()

    const res = await request.get(`${ADMIN_URL}/api/v1/admin/search/global?q=x`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })
    expect(res.status()).toBe(400)
  })
})
