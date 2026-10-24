/**
 * FILE: examples/e2e-dogfood/tests/merge-queue-panel-overflow.spec.ts
 * PURPOSE: 390px layout check for the /fixes "Merge when ready" panel.
 *
 * jsdom has no layout engine, so MergeQueuePanel.test.tsx cannot see
 * overflow. This spec serves the real panel (admin CSS included) at
 * 390×844 and asserts the short #N label, the full owner/repo#N title,
 * a single-line ref beside the badge, and that document and <main>
 * scrollWidth equal clientWidth.
 *
 * It does not sign in and does not call the network. The API response
 * is fulfilled in the browser. Vite is a throwaway server on port 0.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const REPO = 'kensaurus/solo-boss-cloud-documentation'
const BARE_REPO = 'acme/widget-docs'
const PR = 789
const TRAIN_PR = 790
const MERGED_PR = 791
const REASON = 'Branch is behind its base after the previous merge.'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/admin')

function refHref(repo: string, pr: number) {
  return `https://github.com/${repo}/pull/${pr}`
}

function queueRow(id: string, state: string, pr: number, detail: string | null) {
  return {
    id,
    fix_attempt_id: id,
    project_id: 'proj-1',
    repo: REPO,
    pr_number: pr,
    state,
    detail,
    head_sha: null,
    queued_at: '2026-10-24T00:00:00Z',
    updated_at: '2026-10-24T01:00:00Z',
    merged_at: state === 'merged' ? '2026-10-24T02:00:00Z' : null,
    conflict_agents: 0,
  }
}

const payload = {
  ok: true,
  data: {
    rows: [
      queueRow('held', 'blocked', PR, REASON),
      queueRow('done', 'merged', MERGED_PR, null),
    ],
    trains: [
      {
        id: 'train-1',
        project_id: 'proj-1',
        repo: REPO,
        pr_number: TRAIN_PR,
        state: 'testing',
        members: [PR],
        attempt: 1,
        detail: 'CI running',
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T01:00:00Z',
        merged_at: null,
      },
      {
        id: 'train-bare',
        project_id: 'proj-1',
        repo: BARE_REPO,
        pr_number: null,
        state: 'testing',
        members: [1],
        attempt: 1,
        detail: 'CI running',
        created_at: '2026-10-24T00:00:00Z',
        updated_at: '2026-10-24T01:00:00Z',
        merged_at: null,
      },
    ],
    release: [{ projectId: 'proj-1', mode: 'train', intervalMinutes: 360, maxMembers: 15 }],
  },
}

const harnessPath = path.join(adminRoot, 'merge-queue-overflow-harness.tsx')
const apiMockPath = path.join(adminRoot, 'merge-queue-overflow-api.ts')
const viteConfigPath = path.join(adminRoot, 'node_modules', '.merge-queue-overflow.config.mjs')

function viteConfigSource(): string {
  return `import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apiMockPath = ${JSON.stringify(apiMockPath)}
const html = \`<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body>
  <div id="root">
    <main id="main-content" class="flex-1 min-h-0 min-w-0 w-full max-w-full overflow-y-auto">
      <div id="panel"></div>
    </main>
  </div>
  <script type="module" src="/merge-queue-overflow-harness.tsx"></script>
</body>
</html>\`

export default {
  root: adminRoot,
  appType: 'custom',
  clearScreen: false,
  resolve: {
    alias: {
      '@': path.join(adminRoot, 'src'),
      rrweb: path.join(adminRoot, 'src/stubs/rrweb.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
    hmr: false,
    fs: { allow: [searchForWorkspaceRoot(adminRoot)] },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'merge-queue-overflow-mock',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './supabase' && importer && importer.endsWith('mergeQueue.ts')) return apiMockPath
        return null
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] !== '/overflow') return next()
          res.statusCode = 200
          res.setHeader('content-type', 'text/html; charset=utf-8')
          res.end(html)
        })
      },
    },
  ],
}
`
}

function writeHarnessFiles() {
  writeFileSync(
    apiMockPath,
    `const data = ${JSON.stringify(payload.data)}
export async function apiFetch(path: string) {
  if (String(path).includes('/v1/admin/merge-queue')) return { ok: true, data }
  return { ok: false, error: { code: 'TEST', message: 'unused' } }
}
`,
  )
  writeFileSync(
    harnessPath,
    `import '@vitejs/plugin-react/preamble'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MergeQueuePanel } from './src/components/fixes/MergeQueuePanel'
import { PAGE_SHELL_CLASS } from './src/lib/pageLayout'
import './src/index.css'

function OverflowHarness() {
  return createElement(
    'div',
    { className: PAGE_SHELL_CLASS.standard },
    createElement(MergeQueuePanel, { projectId: 'proj-1', refreshKey: 0 }),
  )
}

const mount = document.getElementById('panel')
if (mount) createRoot(mount).render(createElement(OverflowHarness))
`,
  )
}

function removeHarnessFiles() {
  rmSync(harnessPath, { force: true })
  rmSync(apiMockPath, { force: true })
  rmSync(viteConfigPath, { force: true })
}

function waitForLocalUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`vite did not print a local url\n${buf}`))
    }, 90_000)
    const take = (chunk: Buffer) => {
      buf += chunk.toString()
      const match = buf.match(/http:\/\/127\.0\.0\.1:\d+\//)
      if (!match || settled) return
      settled = true
      clearTimeout(timer)
      resolve(match[0])
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.once('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`vite exited ${code} before it was ready\n${buf}`))
    })
  })
}

async function startPanelServer(): Promise<{ base: string; stop: () => Promise<void> }> {
  // The config sits in apps/admin/node_modules so its bare imports resolve
  // and `..` is the admin root. The harness and API stub are app-root files
  // so Vite will serve them; all three are removed when the server stops.
  writeHarnessFiles()
  writeFileSync(viteConfigPath, viteConfigSource())
  const viteBin = path.join(adminRoot, 'node_modules/vite/bin/vite.js')
  const child = spawn(process.execPath, [viteBin, '--config', viteConfigPath, '--host', '127.0.0.1'], {
    cwd: adminRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let base: string
  try {
    base = await waitForLocalUrl(child)
  } catch (err) {
    child.kill('SIGTERM')
    removeHarnessFiles()
    throw err
  }
  return {
    base,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          const kill = setTimeout(() => {
            child.kill('SIGKILL')
            resolve()
          }, 2_000)
          child.once('exit', () => {
            clearTimeout(kill)
            resolve()
          })
        })
      }
      removeHarnessFiles()
    },
  }
}

async function overflowReport(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    const doc = document.documentElement
    const wide = main
      ? [...main.querySelectorAll<HTMLElement>('*')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .slice(0, 8)
          .map((el) => ({
            tag: el.tagName,
            className: String(el.className).slice(0, 160),
            text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
            scroll: el.scrollWidth,
            client: el.clientWidth,
          }))
      : []
    return {
      doc: [doc.scrollWidth, doc.clientWidth],
      main: main ? [main.scrollWidth, main.clientWidth] : null,
      wide,
    }
  })
}

test.describe('Merge when ready at 390px', () => {
  test.describe.configure({ timeout: 180_000 })
  let stop: (() => Promise<void>) | undefined
  let base = ''

  test.beforeAll(async () => {
    const started = await startPanelServer()
    base = started.base
    stop = started.stop
  })

  test.afterAll(async () => {
    await stop?.()
  })

  test('short #N refs stay one line and the page does not scroll sideways', async ({ page }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(`pageerror: ${err}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`)
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith(base)) return route.continue()
      return route.abort()
    })
    // The harness file is named merge-queue-overflow-harness.tsx. A pattern
    // of *merge-queue* would answer that module with this JSON body.
    await page.route('**/v1/admin/merge-queue**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      }),
    )

    await page.goto(`${base}overflow`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    const queue = page.locator(`a[href="${refHref(REPO, PR)}"]`)
    try {
      await expect(queue).toBeVisible({ timeout: 90_000 })
    } catch (err) {
      const body = await page.locator('body').innerText().catch(() => '')
      throw new Error(`${String(err)}\nbody:\n${body.slice(0, 500)}\n${pageErrors.join('\n')}`)
    }

    await page.getByRole('button', { name: /merged today/ }).click()

    const train = page.locator(`a[href="${refHref(REPO, TRAIN_PR)}"]`)
    const merged = page.locator(`a[href="${refHref(REPO, MERGED_PR)}"]`)
    for (const [locator, pr] of [
      [queue, PR],
      [train, TRAIN_PR],
      [merged, MERGED_PR],
    ] as const) {
      await expect(locator).toHaveText(`#${pr}`)
      await expect(locator).toHaveAttribute('title', `${REPO}#${pr}`)
      const lines = await locator.evaluate((el) => el.getClientRects().length)
      expect(lines).toBe(1)
    }

    const bare = page.locator('span', { hasText: /^widget-docs$/ })
    await expect(bare).toHaveAttribute('title', BARE_REPO)
    expect(await bare.evaluate((el) => el.getClientRects().length)).toBe(1)

    const aligned = await queue.evaluate((el) => {
      const badge = el.closest('li')?.firstElementChild
      if (!badge) return false
      return Math.abs(el.getBoundingClientRect().top - badge.getBoundingClientRect().top) < 8
    })
    expect(aligned).toBe(true)

    const visible = await page.locator('main').innerText()
    expect(visible).not.toContain(`${REPO}#`)
    expect(visible).not.toContain(BARE_REPO)
    expect(visible).toContain(`#${PR}`)

    const report = await overflowReport(page)
    expect(report.main, JSON.stringify(report)).not.toBeNull()
    expect(report.doc[0], JSON.stringify(report)).toBe(report.doc[1])
    expect(report.main![0], JSON.stringify(report)).toBe(report.main![1])
  })
})
