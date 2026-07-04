/**
 * FILE: examples/e2e-dogfood/tests/admin-oauth-signin.spec.ts
 * PURPOSE: Production smoke for the admin console OAuth sign-in entry points.
 *
 * Users reported "Sign in with Google/GitHub doesn't work" on
 * kensaur.us/mushi-mushi. Root cause was a stale admin SPA (deploy-admin was
 * red on a CloudFront Function size failure) rather than the OAuth config
 * itself. These no-login checks catch BOTH classes of regression without
 * needing a test account:
 *   - the login page must render and expose both provider buttons (proves the
 *     SPA is deployed and the route resolves, not a blank/stale shell), and
 *   - clicking a provider must hand off to the provider's own domain with the
 *     Supabase callback URL — i.e. Supabase's redirect allowlist still accepts
 *     the deep /mushi-mushi/admin/dashboard return path.
 */

import { test, expect } from '@playwright/test';

const PROD = (process.env.MUSHI_ADMIN_PROD_URL ?? 'https://kensaur.us').replace(/\/$/, '');
const LOGIN_URL = `${PROD}/mushi-mushi/admin/login`;
// signInWithOAuth's first hop — deterministic and on infra we control, unlike
// the external IdP landing page (github.com / accounts.google.com), which is
// flaky and rate-limit-prone in a nightly. Its redirect_to param carries the
// deep return path, so this request alone proves the allowlist accepts it.
const AUTHORIZE = /dxptnwrhwsqckaftyymj\.supabase\.co\/auth\/v1\/authorize/;

/** Click a provider button and return the Supabase /authorize request URL. */
async function authorizeUrlFor(page: import('@playwright/test').Page, buttonName: RegExp) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const authorizeRequest = page.waitForRequest((req) => AUTHORIZE.test(req.url()), {
    timeout: 30_000,
  });
  await page.getByRole('button', { name: buttonName }).click();
  return decodeURIComponent((await authorizeRequest).url());
}

test.describe('admin OAuth sign-in (production)', () => {
  test('login page renders both provider buttons', async ({ page }) => {
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await expect(page.getByRole('button', { name: /continue with github/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();
  });

  test('GitHub button requests Supabase authorize with the deep return path', async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    const url = await authorizeUrlFor(page, /continue with github/i);
    expect(url).toMatch(/provider=github/);
    // A too-narrow Supabase redirect allowlist would drop this deep path.
    expect(url).toContain('/mushi-mushi/admin/dashboard');
  });

  test('Google button requests Supabase authorize with the deep return path', async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    const url = await authorizeUrlFor(page, /continue with google/i);
    expect(url).toMatch(/provider=google/);
    expect(url).toContain('/mushi-mushi/admin/dashboard');
  });
});
