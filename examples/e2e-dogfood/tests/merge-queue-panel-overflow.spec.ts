/**
 * FILE: examples/e2e-dogfood/tests/merge-queue-panel-overflow.spec.ts
 * PURPOSE: 390px layout check for the /fixes "Merge when ready" panel.
 *
 * jsdom has no layout engine, so MergeQueuePanel.test.tsx cannot see
 * overflow. This spec serves the real panel (admin CSS included) at
 * 390×844 and asserts the short #N label, the full owner/repo#N title,
 * a single-line ref beside the badge, and that document and <main>
 * scrollWidth equal clientWidth. Multi-repo repo#N labels are asserted
 * in the vitest file; this fixture stays one repo so #N stays one line.
 *
 * It does not sign in and does not call the network. The API response
 * is fulfilled in the browser. Vite is a throwaway server on port 0.
 * The harness and API stub are written under os.tmpdir(). That directory
 * is Vite's root, with node_modules symlinked from the admin package so
 * bare imports resolve, and the admin source is on server.fs.allow.
 * Files are removed when the server stops and on process exit, so a
 * killed run cannot leave them in the admin tree.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const REPO = 'kensaurus/solo-boss-cloud-documentation'
const BARE_REPO = 'acme/widget-docs'
const PR = 789
const TRAIN_PR = 790
const MERGED_PR = 791
const REASON = 'Branch is behind its base after the previous merge.'

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/admin')
const requireFromAdmin = createRequire(path.join(adminRoot, 'package.json'))

/** Names the previous harness wrote into the admin tree. Never recreate them. */
const STALE_APP_TREE_FILES = [
  path.join(adminRoot, 'merge-queue-overflow-harness.tsx'),
  path.join(adminRoot, 'merge-queue-overflow-api.ts'),
  path.join(adminRoot, 'node_modules', '.merge-queue-overflow.config.mjs'),
]

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

let tempRoot = ''

function removeStaleAppTreeFiles() {
  for (const file of STALE_APP_TREE_FILES) rmSync(file, { force: true })
}

function removeHarnessFiles() {
  const dir = tempRoot
  if (!dir) return
  tempRoot = ''
  const prefix = `${tmpdir()}${path.sep}`
  if (!dir.startsWith(prefix) || dir.startsWith(adminRoot)) return
  rmSync(dir, { recursive: true, force: true })
}

function installHarnessCleanup() {
  const stop = (code: number) => {
    removeHarnessFiles()
    removeStaleAppTreeFiles()
    process.exit(code)
  }
  process.once('exit', () => {
    removeHarnessFiles()
    removeStaleAppTreeFiles()
  })
  process.once('SIGINT', () => stop(130))
  process.once('SIGTERM', () => stop(143))
}

installHarnessCleanup()

type ConnectReq = { url?: string }
type ConnectRes = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}
type ViteDevServer = {
  listen: () => Promise<void>
  close: () => Promise<void>
  resolvedUrls: { local: string[] } | null
}
type PluginFactory = () => unknown

function overflowHtml(harnessUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body>
  <div id="root">
    <main id="main-content" class="flex-1 min-h-0 min-w-0 w-full max-w-full overflow-y-auto">
      <div id="panel"></div>
    </main>
  </div>
  <script type="module" src="${harnessUrl}"></script>
</body>
</html>`
}

function overflowPlugin(apiMockPath: string, harnessUrl: string) {
  const html = overflowHtml(harnessUrl)
  return {
    name: 'merge-queue-overflow-mock',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (source === './supabase' && importer?.endsWith('mergeQueue.ts')) return apiMockPath
      return null
    },
    configureServer(server: { middlewares: { use: (fn: (req: ConnectReq, res: ConnectRes, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/overflow') return next()
        res.statusCode = 200
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(html)
      })
    },
  }
}

async function loadDefault(specifier: string): Promise<PluginFactory> {
  const loaded = await import(pathToFileURL(requireFromAdmin.resolve(specifier)).href) as { default?: PluginFactory }
  if (typeof loaded.default !== 'function') throw new Error(`expected a default function export from ${specifier}`)
  return loaded.default
}

async function loadVite(): Promise<{
  createServer: (config: Record<string, unknown>) => Promise<ViteDevServer>
  searchForWorkspaceRoot: (dir: string) => string
}> {
  return import(pathToFileURL(requireFromAdmin.resolve('vite')).href) as Promise<{
    createServer: (config: Record<string, unknown>) => Promise<ViteDevServer>
    searchForWorkspaceRoot: (dir: string) => string
  }>
}

function writeHarnessFiles(harnessPath: string, apiMockPath: string) {
  writeFileSync(
    apiMockPath,
    `const data = ${JSON.stringify(payload.data)}
export async function apiFetch(path: string) {
  if (String(path).includes('/v1/admin/merge-queue')) return { ok: true, data }
  return { ok: false, error: { code: 'TEST', message: 'unused' } }
}
`,
  )
  const panel = path.join(adminRoot, 'src/components/fixes/MergeQueuePanel.tsx')
  const layout = path.join(adminRoot, 'src/lib/pageLayout.ts')
  const css = path.join(adminRoot, 'src/index.css')
  writeFileSync(
    harnessPath,
    `import '@vitejs/plugin-react/preamble'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MergeQueuePanel } from ${JSON.stringify(panel)}
import { PAGE_SHELL_CLASS } from ${JSON.stringify(layout)}
import ${JSON.stringify(css)}

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

async function startPanelServer(): Promise<{ base: string; stop: () => Promise<void> }> {
  removeStaleAppTreeFiles()
  tempRoot = mkdtempSync(path.join(tmpdir(), 'merge-queue-overflow-'))
  const harnessPath = path.join(tempRoot, 'merge-queue-overflow-harness.tsx')
  const apiMockPath = path.join(tempRoot, 'merge-queue-overflow-api.ts')
  // A symlink, not a copy. removeHarnessFiles unlinks it and does not
  // follow it into the admin package.
  symlinkSync(path.join(adminRoot, 'node_modules'), path.join(tempRoot, 'node_modules'), 'dir')
  let server: ViteDevServer | undefined
  try {
    writeHarnessFiles(harnessPath, apiMockPath)
    const vite = await loadVite()
    const react = await loadDefault('@vitejs/plugin-react')
    const tailwindcss = await loadDefault('@tailwindcss/vite')
    // The harness is inside this server's root, so the page can load it
    // as a normal URL. Admin source stays outside and is only fs.allow'd.
    const harnessUrl = '/merge-queue-overflow-harness.tsx'
    server = await vite.createServer({
      root: tempRoot,
      configFile: false,
      cacheDir: path.join(tempRoot, '.vite-cache'),
      appType: 'custom',
      clearScreen: false,
      logLevel: 'error',
      resolve: {
        alias: {
          '@': path.join(adminRoot, 'src'),
          rrweb: path.join(adminRoot, 'src/stubs/rrweb.ts'),
        },
      },
      optimizeDeps: {
        // Crawl the harness only. The admin package root has no entry
        // here, so the scanner must not walk the rest of the app.
        entries: [harnessPath],
        include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'react/jsx-runtime'],
      },
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        hmr: false,
        fs: { allow: [vite.searchForWorkspaceRoot(adminRoot), adminRoot, tempRoot] },
      },
      plugins: [react(), tailwindcss(), overflowPlugin(apiMockPath, harnessUrl)],
    } as Record<string, unknown>)
    await server.listen()
    const listened = server.resolvedUrls?.local[0]
    if (!listened) throw new Error('vite did not report a local url')
    const base = listened.endsWith('/') ? listened : `${listened}/`
    const running = server
    return {
      base,
      stop: async () => {
        await running.close()
        removeHarnessFiles()
        removeStaleAppTreeFiles()
      },
    }
  } catch (err) {
    await server?.close().catch(() => undefined)
    removeHarnessFiles()
    removeStaleAppTreeFiles()
    throw err
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

  test('writes the harness under the OS temp dir, not the admin tree', () => {
    expect(tempRoot.startsWith(`${tmpdir()}${path.sep}`)).toBe(true)
    expect(path.relative(adminRoot, tempRoot).startsWith('..')).toBe(true)
    expect(existsSync(path.join(tempRoot, 'merge-queue-overflow-harness.tsx'))).toBe(true)
    expect(existsSync(path.join(tempRoot, 'merge-queue-overflow-api.ts'))).toBe(true)
    for (const file of STALE_APP_TREE_FILES) expect(existsSync(file), file).toBe(false)
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
