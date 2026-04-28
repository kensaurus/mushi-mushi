/**
 * FILE: examples/e2e-dogfood/tests/teams.spec.ts
 * PURPOSE: Teams v1 smoke. Invites kensaurus@gmail.com from the test tenant,
 *          accepts in a second browser context, and verifies the roster.
 */

import { expect, test, type Browser, type Page, type APIRequestContext } from '@playwright/test'

const ADMIN_URL = process.env.MUSHI_ADMIN_URL ?? 'http://localhost:6464'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const SQL_RPC_ENABLED = process.env.E2E_TEAMS_SQL_RPC === '1'
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? ''
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD ?? ''
const TEAMMATE_EMAIL = 'kensaurus@gmail.com'
const TEAMMATE_PASSWORD = process.env.KENSAURUS_TEST_PASSWORD ?? ''

test.describe('Teams v1 invitations', () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD || !TEAMMATE_PASSWORD,
    'Requires Supabase URL/anon/service keys, TEST_USER_*, KENSAURUS_TEST_PASSWORD',
  )
  test.skip(
    !SQL_RPC_ENABLED,
    'Set E2E_TEAMS_SQL_RPC=1 only against a disposable project that exposes the execute_sql helper',
  )

  test('invites kensaurus and accepts the invite in a second context', async ({ page, browser, request }) => {
    const owner = await loginViaRest(request, TEST_USER_EMAIL, TEST_USER_PASSWORD)
    await seedOwnerOrg(request, owner.user.id)
    await installSession(page, owner)
    await page.goto(`${ADMIN_URL}/organization/members`, { waitUntil: 'networkidle' })

    await expect(page.getByRole('heading', { name: /members/i })).toBeVisible()
    await page.getByLabel(/email/i).fill(TEAMMATE_EMAIL)
    await page.getByLabel(/role/i).selectOption('admin')
    await page.getByRole('button', { name: /^invite$/i }).click()
    await expect(page.getByText(TEAMMATE_EMAIL)).toBeVisible()

    const token = await latestInviteToken(request, TEAMMATE_EMAIL)
    const teammate = await loginViaRest(request, TEAMMATE_EMAIL, TEAMMATE_PASSWORD)
    const teammatePage = await newAuthedPage(browser, teammate)
    await teammatePage.goto(`${ADMIN_URL}/invite/accept?token=${encodeURIComponent(token)}`, {
      waitUntil: 'networkidle',
    })
    await expect(teammatePage.getByText(/you're in/i)).toBeVisible()

    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByText(TEAMMATE_EMAIL)).toBeVisible()
    await expect(page.getByText(/admin/i).first()).toBeVisible()

    await cleanupInvite(request, TEAMMATE_EMAIL)
  })

  test('blocks invitations below Pro', async ({ page, request }) => {
    const owner = await loginViaRest(request, TEST_USER_EMAIL, TEST_USER_PASSWORD)
    const orgId = await seedOwnerOrg(request, owner.user.id, 'starter')
    await installSession(page, owner)
    await page.goto(`${ADMIN_URL}/organization/members`, { waitUntil: 'networkidle' })
    await expect(page.getByText(/teams require pro or enterprise/i)).toBeVisible()

    const api = await request.post(`${SUPABASE_URL}/functions/v1/api/v1/org/${orgId}/invitations`, {
      headers: {
        Authorization: `Bearer ${owner.access_token}`,
        'Content-Type': 'application/json',
      },
      data: { email: TEAMMATE_EMAIL, role: 'member' },
    })
    expect(api.status()).toBe(402)

    await setOrgPlan(request, orgId, 'pro')
  })
})

interface LoginResult {
  access_token: string
  refresh_token: string
  user: { id: string; email?: string }
}

async function loginViaRest(request: APIRequestContext, email: string, password: string): Promise<LoginResult> {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email, password },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as LoginResult
}

async function installSession(page: Page, tokens: LoginResult): Promise<void> {
  await page.addInitScript((input) => {
    window.localStorage.setItem(
      'sb-mushi-auth-token',
      JSON.stringify({ access_token: input.access_token, refresh_token: input.refresh_token }),
    )
  }, { access_token: tokens.access_token, refresh_token: tokens.refresh_token })
}

async function newAuthedPage(browser: Browser, tokens: LoginResult): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await installSession(page, tokens)
  return page
}

async function sql<T = unknown>(request: APIRequestContext, query: string): Promise<T[]> {
  const res = await request.post(`${SUPABASE_URL}/rest/v1/rpc/execute_sql`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    data: { query },
  })
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as T[]
}

async function seedOwnerOrg(request: APIRequestContext, ownerId: string, plan = 'pro'): Promise<string> {
  const rows = await sql<{ id: string }>(
    request,
    `
      with org as (
        insert into organizations(slug, name, owner_id, plan_id, is_personal)
        values ('e2e-' || substr('${ownerId}'::text, 1, 8), 'E2E Team', '${ownerId}', '${plan}', true)
        on conflict (slug) do update set plan_id = excluded.plan_id
        returning id
      )
      insert into organization_members(organization_id, user_id, role)
      select id, '${ownerId}', 'owner' from org
      on conflict (organization_id, user_id) do update set role = 'owner'
      returning organization_id as id;
    `,
  )
  return rows[0].id
}

async function setOrgPlan(request: APIRequestContext, orgId: string, plan: string): Promise<void> {
  await sql(request, `update organizations set plan_id = '${plan}' where id = '${orgId}'`)
}

async function latestInviteToken(request: APIRequestContext, email: string): Promise<string> {
  const rows = await sql<{ token: string }>(
    request,
    `select token from invitations where lower(email::text) = lower('${email}') order by created_at desc limit 1`,
  )
  expect(rows[0]?.token).toBeTruthy()
  return rows[0].token
}

async function cleanupInvite(request: APIRequestContext, email: string): Promise<void> {
  await sql(
    request,
    `
      delete from organization_members
      where user_id in (select id from auth.users where email = '${email}');
      delete from invitations where lower(email::text) = lower('${email}');
    `,
  )
}
