// SPDX-License-Identifier: MIT
/**
 * The terminal part of a fresh-eyes run (ADR 0053), for apps whose setup is a
 * CLI (Mushi's is `npx mushi-mushi`). Model-free, each phase timed:
 *
 *   scaffold  a tiny sample web app in a temp folder
 *   setup     the setup command, non-interactive, with the supplied project id and key
 *   env       the values the setup wrote (.env.local / .env)
 *   start     the sample served on 127.0.0.1 with the widget's script tag
 *   report    one report sent through the widget, answered by the API
 *
 * The browser then goes back to the console to see the diagnosis. A phase
 * that fails ends the run there and says why: that is the finding.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { openSession } from './capture.js'
import { run, type RunResult } from './proc.js'

/** `{projectId}` and `{apiKey}` are replaced; each is one whitespace-free word. */
export const DEFAULT_SETUP_COMMAND = 'npx --yes mushi-mushi@latest --yes --project-id {projectId} --api-key {apiKey}'
/** Where the hosted widget sends reports when no endpoint is given. */
const HOSTED_API_ORIGIN = 'https://dxptnwrhwsqckaftyymj.supabase.co'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/

export type PhaseName = 'scaffold' | 'setup' | 'env' | 'start' | 'report'

export interface Phase {
  name: PhaseName
  ms: number
  ok: boolean
  detail: string
}

export interface TerminalResult {
  ok: boolean
  phases: Phase[]
  failedAt: PhaseName | null
  sampleUrl: string | null
}

/** @internal Exported for tests only. Pure: the setup command as argv, values checked so nothing else reaches the shell. */
export function setupArgv(template: string, v: { projectId: string; apiKey: string }): { cmd: string; args: string[] } {
  if (!UUID_RE.test(v.projectId)) throw new Error('The project id is not a UUID.')
  if (!KEY_RE.test(v.apiKey)) throw new Error('The key has characters a key never has.')
  const words = template.trim().split(/\s+/).map((w) => w.replace('{projectId}', v.projectId).replace('{apiKey}', v.apiKey))
  if (!words.length || !words[0]) throw new Error('Empty setup command.')
  return { cmd: words[0], args: words.slice(1) }
}

const ENV_LINE = (name: string) => new RegExp(`^\\s*(?:NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|REACT_APP_)?${name}\\s*=\\s*["']?([^"'\\s]+)["']?\\s*$`, 'im')

/** @internal Exported for tests only. Pure: the project id and key a setup wrote to an env file. */
export function parseSetupEnv(text: string): { projectId: string | null; apiKey: string | null } {
  const pid = text.match(ENV_LINE('MUSHI_PROJECT_ID'))?.[1] ?? null
  const key = text.match(ENV_LINE('MUSHI_API_KEY'))?.[1] ?? null
  return { projectId: pid && UUID_RE.test(pid) ? pid : null, apiKey: key && KEY_RE.test(key) ? key : null }
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** @internal Exported for tests only. Pure: the sample page, with the widget's script tag (docs: quickstart/web, "No bundler"). */
export function sampleHtml(v: { projectId: string; apiKey: string; endpoint?: string }): string {
  const endpoint = v.endpoint ? ` data-endpoint="${attr(v.endpoint)}"` : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sample app</title>
<script async src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js" data-project="${attr(v.projectId)}" data-key="${attr(v.apiKey)}"${endpoint}></script>
</head><body><main><h1>Sample app</h1><p>A tiny page a first-time user might have. The Save button below does nothing.</p><button type="button">Save</button></main></body></html>`
}

const scrub = (s: string, key: string) => (key ? s.split(key).join('{{apiKey}}') : s)

export interface TerminalOptions {
  projectId: string
  apiKey: string
  /** Work folder (created): the sample app lives in sample/. */
  dir: string
  setupCommand?: string
  /** A self-hosted API (data-endpoint); default the hosted one. */
  endpoint?: string
  setupTimeoutMs?: number
  reportTimeoutMs?: number
  /** Tests: run a command. */
  runCommand?: (cmd: string, args: readonly string[], cwd: string) => Promise<RunResult>
  /** Tests: send the report from the sample page. */
  sendReport?: (sampleUrl: string) => Promise<{ ok: boolean; detail: string }>
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = performance.now()
  const value = await fn()
  return { value, ms: Math.max(0, Math.round(performance.now() - t)) }
}

/**
 * Environment for the setup command: no MUSHI_* of this run, no agent keys;
 * CI=1 so it never prompts; and a home of its own. A setup wizard saves the
 * credentials it was given (`mushi-mushi` writes ~/.config/mushi/config.json
 * and the keychain), which on the operator's machine would replace their own
 * CLI login with the test app's ingest key. The npm cache stays shared.
 * @internal Exported for tests only.
 */
export function setupEnv(home: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) {
    if (/^(MUSHI_|CURSOR_API_KEY$|ANTHROPIC_API_KEY$|OPENAI_API_KEY$|GITHUB_TOKEN$|GH_TOKEN$|XDG_CONFIG_HOME$|XDG_DATA_HOME$|XDG_STATE_HOME$|DBUS_SESSION_BUS_ADDRESS$)/.test(k)) continue
    env[k] = v
  }
  const realHome = base.HOME ?? base.USERPROFILE ?? ''
  const npmCache = base.npm_config_cache ?? (realHome ? join(realHome, process.platform === 'win32' ? 'AppData/Local/npm-cache' : '.npm') : undefined)
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(home, '.local', 'state'),
    ...(npmCache ? { npm_config_cache: npmCache } : {}),
    CI: '1',
    MUSHI_TELEMETRY: '0',
  }
}

export async function runTerminalSetup(o: TerminalOptions): Promise<TerminalResult> {
  const phases: Phase[] = []
  const out: TerminalResult = { ok: false, phases, failedAt: null, sampleUrl: null }
  const fail = (name: PhaseName, ms: number, detail: string) => {
    phases.push({ name, ms, ok: false, detail: scrub(detail, o.apiKey).slice(0, 400) })
    out.failedAt = name
    return out
  }
  const sample = join(o.dir, 'sample')

  // scaffold
  const sc = await timed(async () => {
    mkdirSync(sample, { recursive: true })
    writeFileSync(join(sample, 'package.json'), JSON.stringify({ name: 'fresh-eyes-sample', version: '0.0.0', private: true, type: 'module' }, null, 2))
    writeFileSync(join(sample, 'index.html'), '<!doctype html><title>Sample app</title><h1>Sample app</h1>')
  })
  phases.push({ name: 'scaffold', ms: sc.ms, ok: true, detail: 'A plain HTML app with a package.json.' })

  // setup
  let argv: { cmd: string; args: string[] }
  try {
    argv = setupArgv(o.setupCommand ?? DEFAULT_SETUP_COMMAND, o)
  } catch (err) {
    return fail('setup', 0, (err as Error).message)
  }
  const exec =
    o.runCommand ??
    ((cmd: string, args: readonly string[], cwd: string) => {
      const home = join(o.dir, 'home')
      mkdirSync(join(home, '.config'), { recursive: true })
      return run(cmd, args, { cwd, env: setupEnv(home), shell: process.platform === 'win32', timeoutMs: o.setupTimeoutMs ?? 300_000 })
    })
  const st = await timed(() => exec(argv.cmd, argv.args, sample))
  if (st.value.timedOut) return fail('setup', st.ms, `The setup command did not finish in ${Math.round((o.setupTimeoutMs ?? 300_000) / 1000)} s: ${st.value.tail.slice(-200)}`)
  if (st.value.exitCode !== 0) return fail('setup', st.ms, `The setup command exited ${st.value.exitCode}: ${st.value.tail.trim().slice(-300)}`)
  phases.push({ name: 'setup', ms: st.ms, ok: true, detail: `${argv.cmd} ${argv.args.join(' ')}`.replace(o.apiKey, '{{apiKey}}').slice(0, 300) })

  // env
  const en = await timed(async () => {
    const text = ['.env.local', '.env'].map((f) => join(sample, f)).filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8')).join('\n')
    return parseSetupEnv(text)
  })
  if (!en.value.projectId || !en.value.apiKey) return fail('env', en.ms, 'The setup finished but wrote no project id and key to .env.local or .env.')
  phases.push({ name: 'env', ms: en.ms, ok: true, detail: 'The setup wrote the project id and key.' })

  // start
  let server: Server | null = null
  const sv = await timed(async () => {
    const html = sampleHtml({ projectId: en.value.projectId!, apiKey: en.value.apiKey!, endpoint: o.endpoint })
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/`
  })
  out.sampleUrl = sv.value
  phases.push({ name: 'start', ms: sv.ms, ok: true, detail: 'The sample app is up with the widget script.' })

  // report
  try {
    const send = o.sendReport ?? ((url: string) => sendReportThroughWidget(url, o.endpoint ? new URL(o.endpoint).origin : HOSTED_API_ORIGIN, o.reportTimeoutMs ?? 90_000))
    const rp = await timed(() => send(sv.value))
    if (!rp.value.ok) return fail('report', rp.ms, rp.value.detail)
    phases.push({ name: 'report', ms: rp.ms, ok: true, detail: rp.value.detail })
  } finally {
    await new Promise<void>((r) => (server ? (server as Server).close(() => r()) : r()))
  }
  out.ok = true
  return out
}

/**
 * Open the sample in a guarded browser (writes only to the sample and the
 * Mushi API), open the widget, type a report and send it; ok once the API
 * answers the report with a 2xx.
 */
async function sendReportThroughWidget(sampleUrl: string, apiOrigin: string, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  const session = await openSession({ headless: true, policy: { writes: 'same-origin', appOrigins: [new URL(sampleUrl).origin, apiOrigin] } })
  try {
    const ctx = await session.freshContext()
    const page = await ctx.newPage()
    const answered = page.waitForResponse((r) => r.request().method() === 'POST' && /\/v1\/reports\b/.test(r.url()), { timeout: timeoutMs }).catch(() => null)
    await page.goto(sampleUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const launcher = page.getByRole('button', { name: /report|bug|feedback|issue|mushi/i }).first()
    try {
      await launcher.click({ timeout: 30_000 })
    } catch {
      return { ok: false, detail: 'The widget did not show a button to report a bug within 30 s.' }
    }
    try {
      await page.getByRole('radio').first().click({ timeout: 5000 }).catch(() => {})
      await page.getByRole('textbox').first().fill('Fresh-eyes test report: the Save button does nothing.', { timeout: 10_000 })
      await page.getByRole('button', { name: /send|submit/i }).first().click({ timeout: 10_000 })
    } catch (err) {
      return { ok: false, detail: `The widget opened but the report could not be sent: ${(err as Error).message.split('\n')[0]!.slice(0, 160)}` }
    }
    const res = await answered
    if (!res) return { ok: false, detail: `No report reached the API within ${Math.round(timeoutMs / 1000)} s.` }
    if (res.status() >= 300) return { ok: false, detail: `The API answered the report with ${res.status()}.` }
    const id = ((await res.json().catch(() => null)) as { data?: { reportId?: string } } | null)?.data?.reportId
    return { ok: true, detail: id ? `Report ${id.slice(0, 8)} sent through the widget.` : 'A report was sent through the widget.' }
  } finally {
    await session.close().catch(() => {})
  }
}
