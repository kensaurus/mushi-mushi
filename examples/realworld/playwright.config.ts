import { defineConfig } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * RealWorld dogfood Playwright config.
 *
 * Gated behind MUSHI_REALWORLD=1 so default CI is fast — this suite boots
 * three servers, so is excluded from the repo's main `pnpm test`.
 *
 * Run: MUSHI_REALWORLD=1 pnpm e2e:realworld
 *
 * Servers:
 *  4101 — Conduit Express backend  (@mushi-mushi/node)
 *  4102 — React-Vite frontend      (@mushi-mushi/react, path router)
 *  4103 — Vanilla-TS frontend      (@mushi-mushi/web, hash router)
 *  4199 — Mushi ingest stub        (accepts SDK report POSTs hermetically)
 */

/**
 * Guard: if MUSHI_REALWORLD is not set, skip everything by pointing at no
 * testDir so Playwright finds zero tests instantly (no 4-server boot needed).
 */
export const MUSHI_REALWORLD_ENABLED = !!process.env['MUSHI_REALWORLD']

// MCP dogfood step only when a real Mushi project is pointed at.
export const MUSHI_MCP_ENABLED =
  !!(process.env['MUSHI_PROJECT_ID'] && process.env['MUSHI_API_KEY'])

// Env forwarded to every webServer child process.
const SHARED_ENV = {
  MUSHI_PROJECT_ID: process.env['MUSHI_PROJECT_ID'] ?? 'realworld-fixture',
  MUSHI_API_KEY: process.env['MUSHI_API_KEY'] ?? 'mushi_realworld_fixture_key',
  MUSHI_API_ENDPOINT:
    process.env['MUSHI_API_ENDPOINT'] ?? 'http://localhost:4199/functions/v1/api',
}

const VITE_ENV = {
  VITE_MUSHI_PROJECT_ID: SHARED_ENV.MUSHI_PROJECT_ID,
  VITE_MUSHI_API_KEY: SHARED_ENV.MUSHI_API_KEY,
  VITE_MUSHI_API_ENDPOINT: SHARED_ENV.MUSHI_API_ENDPOINT,
}

export default defineConfig({
  // No MUSHI_REALWORLD → point testDir at an empty path so Playwright exits
  // instantly with 0 tests (no webServer processes spawn).
  testDir: MUSHI_REALWORLD_ENABLED
    ? path.join(__dirname, 'tests')
    : path.join(__dirname, '_skip'),
  testMatch: ['**/conduit-journey.spec.ts'],
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
  },
  // webServer entries only boot when MUSHI_REALWORLD=1 — without the gate the
  // suite exits immediately (testDir has no .spec files) so no servers needed.
  webServer: MUSHI_REALWORLD_ENABLED
    ? [
        // 4199 — ingest stub: first so the SDKs can reach it on boot
        {
          command: 'node tests/ingest-stub.mjs --port 4199',
          url: 'http://localhost:4199/health',
          cwd: __dirname,
          reuseExistingServer: !process.env['CI'],
          timeout: 15_000,
          env: {},
        },
        // 4101 — Conduit Express backend
        {
          command: 'pnpm --filter mushi-realworld-backend-express start',
          url: 'http://localhost:4101/health',
          reuseExistingServer: !process.env['CI'],
          timeout: 20_000,
          env: { PORT: '4101', ...SHARED_ENV },
        },
        // 4102 — React-Vite frontend (path router)
        {
          command: 'pnpm --filter mushi-realworld-react-vite dev --port 4102',
          url: 'http://localhost:4102',
          reuseExistingServer: !process.env['CI'],
          timeout: 30_000,
          env: { ...VITE_ENV },
        },
        // 4103 — Hash frontend
        {
          command: 'pnpm --filter mushi-realworld-frontend-hash dev --port 4103',
          url: 'http://localhost:4103',
          reuseExistingServer: !process.env['CI'],
          timeout: 30_000,
          env: { ...VITE_ENV },
        },
      ]
    : [],
})
