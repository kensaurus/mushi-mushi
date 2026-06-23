/**
 * Pipeline closed-loop smoke — ingest → console list → detail (no 404).
 * Full dispatch/MCP merge loop requires mcp:write keys and is run manually.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const YEN_YEN_PROJECT = '6e7e0c3a-a777-4f1e-a699-6515993cf3bd'
const API_BASE =
  process.env.MUSHI_API_ENDPOINT ??
  'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

function loadEnvKey(file: string, key: string): string | null {
  try {
    const content = readFileSync(file, 'utf8')
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return match ? match[1].replace(/['"]/g, '').trim() : null
  } catch {
    return null
  }
}

function loadAdminSessionEnv() {
  const rootEnv: Record<string, string> = {}
  for (const rel of ['.env.local', 'apps/admin/.env']) {
    try {
      const raw = readFileSync(resolve(__dirname, '../../../', rel), 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        rootEnv[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).replace(/^["']|["']$/g, '')
      }
    } catch {
      /* optional */
    }
  }
  return {
    supabaseUrl: process.env.VITE_SUPABASE_URL ?? rootEnv.VITE_SUPABASE_URL ?? '',
    anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? rootEnv.VITE_SUPABASE_ANON_KEY ?? '',
    email: process.env.TEST_USER_EMAIL ?? rootEnv.TEST_USER_EMAIL ?? '',
    password: process.env.TEST_USER_PASSWORD ?? rootEnv.TEST_USER_PASSWORD ?? '',
  }
}

test.describe('Pipeline closed loop (ingest → admin detail)', () => {
  test('yen-yen ingest 201 and admin detail loads with ?project=', async ({ page, request }) => {
    const ingestKey = loadEnvKey(
      'C:/Users/kensa/Documents/GitHub/yen-yen/.env',
      'EXPO_PUBLIC_MUSHI_API_KEY',
    )
    test.skip(!ingestKey, 'yen-yen EXPO_PUBLIC_MUSHI_API_KEY not in .env')

    const reporterToken = `mushi_e2e_${Date.now()}`
    const ingestRes = await request.post(`${API_BASE}/v1/reports`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': ingestKey,
        'X-Mushi-Project-Id': YEN_YEN_PROJECT,
      },
      data: {
        projectId: YEN_YEN_PROJECT,
        category: 'other',
        description: `E2E pipeline closed-loop ${new Date().toISOString()}`,
        reporterToken,
        environment: {
          userAgent: 'Playwright/pipeline-closed-loop',
          platform: 'web',
          language: 'en',
          viewport: { width: 390, height: 844 },
          url: 'mushi://yen-yen-e2e',
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: 'UTC',
        },
      },
    })
    expect(ingestRes.status()).toBe(201)
    const ingested = (await ingestRes.json()) as { data?: { id?: string }; id?: string }
    const reportId = ingested.data?.id ?? ingested.id
    expect(reportId).toBeTruthy()

    const { supabaseUrl, anonKey, email, password } = loadAdminSessionEnv()
    test.skip(!supabaseUrl || !anonKey || !email || !password, 'Admin test user env missing')

    const authRes = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      data: { email, password },
    })
    expect(authRes.ok()).toBeTruthy()
    const session = (await authRes.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }
    const ref = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1] ?? 'dxptnwrhwsqckaftyymj'
    const storageKey = `sb-${ref}-auth-token`
    const sessionPayload = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: Math.floor(Date.now() / 1000) + session.expires_in,
      token_type: 'bearer',
      user: { id: 'e2e', email },
    })

    await page.goto(`${ADMIN_URL}/`)
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: storageKey, value: sessionPayload },
    )

    await page.goto(`${ADMIN_URL}/reports/${reportId}?project=${YEN_YEN_PROJECT}`)
    await expect(page.getByText(/404|Report not found/i)).not.toBeVisible({ timeout: 15000 })
    await expect(page.locator('body')).toContainText(/pipeline closed-loop|E2E pipeline/i, {
      timeout: 15000,
    })
  })
})
