/**
 * FILE: packages/server/supabase/functions/_shared/sdk-health.ts
 * PURPOSE: The pure half of SDK health (GET /v1/admin/projects/:id/sdk-health):
 *          what is wrong with an app's Mushi SDK and which one-click fix
 *          applies, plus the task reports the console files for the fixes an
 *          agent has to make in the repo (installing the SDK, allowing the API
 *          in the site's Content-Security-Policy).
 *
 * Inputs are already read (package.json texts, Actions secret names, key
 * heartbeats, the npm catalogue, the site's CSP). A read that failed arrives
 * as a reason and becomes a note: never a problem, and never "all good".
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

import { buildCiVars, stackFromPackageJsons, type SdkStack } from './sdk-diagnostics.ts'
import { archivedDirsFrom, computeBumpPlan, isUnderArchivedDir } from './sdk-upgrade-plan.ts'

export type SdkHealthProblemId = 'not_installed' | 'ci_secrets_missing' | 'never_seen' | 'outdated' | 'csp_blocks_api' | 'stale'
export type SdkHealthFixKind = 'install_task' | 'sync_ci_secrets' | 'upgrade_pr' | 'csp_task'
export type SdkHealthSeverity = 'error' | 'warn' | 'info'

export interface SdkHealthProblem {
  id: SdkHealthProblemId
  severity: SdkHealthSeverity
  title: string
  detail: string
  fix: { kind: SdkHealthFixKind; label: string } | null
}

/** A check that could not run. Shown as "not checked", so a failed read never looks healthy. */
export interface SdkHealthNote {
  check: 'repo' | 'ci_secrets' | 'site_csp' | 'versions'
  detail: string
}

/** A heartbeat older than this is stale. */
const SDK_STALE_DAYS = 14

/** The task kinds POST /sdk-health/tasks files. */
export const SDK_HEALTH_TASK_KINDS = ['install', 'csp'] as const
export type SdkHealthTaskKind = (typeof SDK_HEALTH_TASK_KINDS)[number]

/** The `component` a task report carries; the dedupe key for "one open task per kind". */
export function taskComponent(kind: SdkHealthTaskKind): string {
  return `sdk-health:${kind}`
}

/** Report statuses that still count as open work (same list as vuln-watch). */
export const OPEN_REPORT_STATUSES = ['new', 'pending', 'submitted', 'queued', 'classified', 'grouped', 'fixing', 'triaged', 'in_progress', 'reopened']

// ── package.json files ───────────────────────────────────────────────────────

export interface PackageJsonFile {
  path: string
  text: string
}

/** Build output, fixtures, examples and vendored code carry package.json files nobody ships. */
const SKIP_DIR_RE = /(?:^|\/)(?:node_modules|dist|build|out|\.next|\.turbo|\.output|coverage|vendor|\.git|fixtures|__fixtures__|testdata|__mocks__|examples?|templates?|e2e)\//
const MAX_PACKAGE_JSON_FILES = 40
const MAX_PACKAGE_JSON_DEPTH = 4

/**
 * The package.json files worth reading from a repo tree: shallow ones first,
 * nothing under node_modules, fixtures, examples or a directory marked
 * retired with an ARCHIVED.md.
 */
export function packageJsonPaths(treePaths: readonly string[]): string[] {
  const archived = archivedDirsFrom([...treePaths])
  return treePaths
    .filter((p) => (p === 'package.json' || p.endsWith('/package.json')) && !SKIP_DIR_RE.test(p))
    .filter((p) => p.split('/').length <= MAX_PACKAGE_JSON_DEPTH + 1)
    .filter((p) => !isUnderArchivedDir(p, archived))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_PACKAGE_JSON_FILES)
}

function parseDeps(text: string): Record<string, string> | null {
  let pkg: unknown
  try {
    pkg = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof pkg !== 'object' || pkg === null) return null
  const out: Record<string, string> = {}
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const v = (pkg as Record<string, unknown>)[section]
    if (typeof v !== 'object' || v === null || Array.isArray(v)) continue
    for (const [name, spec] of Object.entries(v)) if (typeof spec === 'string') out[name] = spec
  }
  return out
}

/** Packages that put the bug-report widget or reporter in an app (not the CLI, MCP or server tools). */
const SDK_PACKAGES = new Set([
  '@mushi-mushi/web',
  '@mushi-mushi/react',
  '@mushi-mushi/react-native',
  '@mushi-mushi/capacitor',
  '@mushi-mushi/vue',
  '@mushi-mushi/svelte',
  '@mushi-mushi/angular',
  '@mushi-mushi/core',
])

export function isSdkPackage(name: string): boolean {
  return SDK_PACKAGES.has(name)
}

/** False for an Expo app without the web SDK: no browser request to block. */
function cspApplies(files: readonly PackageJsonFile[]): boolean {
  const target = detectAppTarget(files)
  return !(target?.stack === 'expo' && !mushiDeps(files).some((d) => d.name === '@mushi-mushi/web'))
}

export interface MushiDep {
  path: string
  name: string
  spec: string
  /** The pinned version for a registry range (`^0.24.0` → 0.24.0); null for workspace:, file:, git and tags. */
  version: string | null
}

/** Every @mushi-mushi/* dependency declared in the files. */
export function mushiDeps(files: readonly PackageJsonFile[]): MushiDep[] {
  const out: MushiDep[] = []
  for (const f of files) {
    const deps = parseDeps(f.text)
    if (!deps) continue
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith('@mushi-mushi/')) continue
      const m = /^[\^~>=<\s]*(\d+\.\d+\.\d+)/.exec(spec)
      out.push({ path: f.path, name, spec, version: m ? m[1] : null })
    }
  }
  return out
}

export interface AppTarget {
  stack: SdkStack
  /** A Capacitor shell: the same web bundle also ships as a store app. */
  capacitor: boolean
  /** The package.json the SDK belongs in. */
  path: string
  /** Its directory ('' for the repo root). */
  dir: string
  sdkPackage: '@mushi-mushi/web' | '@mushi-mushi/react-native'
}

const STACK_MARKERS: Record<SdkStack, readonly string[]> = {
  expo: ['expo', 'react-native'],
  nextjs: ['next'],
  nuxt: ['nuxt'],
  vite: ['vite'],
}

/**
 * Which app the SDK goes into, and its framework. The stack follows
 * stackFromPackageJsons (Expo over Next over Nuxt over Vite, files that
 * already use a Mushi package first); the file is the shallowest one that
 * names that stack. null when no file names a known framework.
 */
export function detectAppTarget(files: readonly PackageJsonFile[]): AppTarget | null {
  const stack = stackFromPackageJsons(files.map((f) => f.text))
  if (!stack) return null
  const parsed = files.flatMap((f) => {
    const deps = parseDeps(f.text)
    return deps ? [{ path: f.path, deps }] : []
  })
  const markers = STACK_MARKERS[stack]
  const matching = parsed.filter((p) => markers.some((m) => m in p.deps))
  const withSdk = matching.filter((p) => Object.keys(p.deps).some((n) => n.startsWith('@mushi-mushi/')))
  const pick = (withSdk.length > 0 ? withSdk : matching).sort((a, b) => a.path.split('/').length - b.path.split('/').length)[0]
  if (!pick) return null
  return {
    stack,
    capacitor: '@capacitor/core' in pick.deps,
    path: pick.path,
    dir: pick.path === 'package.json' ? '' : pick.path.slice(0, -'/package.json'.length),
    sdkPackage: stack === 'expo' ? '@mushi-mushi/react-native' : '@mushi-mushi/web',
  }
}

// ── Content-Security-Policy ──────────────────────────────────────────────────

export type CspPolicy = Map<string, string[]>

/**
 * Parse CSP header (or meta) values. Several policies arrive comma-joined
 * (Headers.get joins repeated headers with ", "); each is enforced, so a
 * request must pass every one. Directive names are case-insensitive and the
 * first of a repeated directive wins.
 */
export function parseCspPolicies(values: readonly string[]): CspPolicy[] {
  const policies: CspPolicy[] = []
  for (const value of values) {
    for (const raw of value.split(',')) {
      const policy: CspPolicy = new Map()
      for (const part of raw.split(';')) {
        const tokens = part.trim().split(/\s+/).filter(Boolean)
        if (tokens.length === 0) continue
        const name = tokens[0].toLowerCase()
        if (!policy.has(name)) policy.set(name, tokens.slice(1))
      }
      if (policy.size > 0) policies.push(policy)
    }
  }
  return policies
}

/** `<meta http-equiv="Content-Security-Policy" content="…">` values in a page (SPAs often set CSP this way). */
export function metaCspValues(html: string): string[] {
  const out: string[] = []
  const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/http-equiv\s*=\s*["']?content-security-policy["'\s/>]/i.test(tag)) continue
    const m = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
    const content = m ? (m[1] ?? m[2] ?? '') : ''
    if (content.trim()) out.push(decode(content))
  }
  return out
}

/** CSP3 scheme-part matching: `http:` also allows https, `ws:` allows wss and http(s), `wss:` allows https. */
function schemeMatches(expr: string, actual: string): boolean {
  const a = expr.toLowerCase()
  const b = actual.toLowerCase()
  if (a === b) return true
  if (a === 'http' && b === 'https') return true
  if (a === 'ws' && (b === 'wss' || b === 'http' || b === 'https')) return true
  if (a === 'wss' && b === 'https') return true
  return false
}

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443', ws: '80', wss: '443' }
const HOST_SOURCE_RE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|\*\.[^:/]+|[^:/*]+)(?::(\d+|\*))?(\/[^?#]*)?$/i

/**
 * Whether one source expression allows `url` on a page served from `page`.
 * @internal Exported for unit tests.
 */
export function sourceMatches(source: string, url: URL, page: URL): boolean {
  const s = source.trim()
  const scheme = url.protocol.replace(/:$/, '')
  if (s === '*') return ['http', 'https', 'ws', 'wss'].includes(scheme) || scheme === page.protocol.replace(/:$/, '')
  if (s.toLowerCase() === "'self'") {
    const pageScheme = page.protocol.replace(/:$/, '')
    const port = (u: URL) => u.port || DEFAULT_PORTS[u.protocol.replace(/:$/, '')] || ''
    return url.hostname === page.hostname && schemeMatches(pageScheme, scheme) && (port(url) === port(page) || (pageScheme === 'http' && scheme === 'https'))
  }
  // Other keywords, nonces and hashes say nothing about where fetch may connect.
  if (s.startsWith("'")) return false
  const schemeOnly = /^([a-z][a-z0-9+.-]*):$/i.exec(s)
  if (schemeOnly) return schemeMatches(schemeOnly[1], scheme)
  const m = HOST_SOURCE_RE.exec(s)
  if (!m) return false
  const [, exprScheme, exprHost, exprPort, exprPath] = m
  if (!schemeMatches(exprScheme ?? page.protocol.replace(/:$/, ''), scheme)) return false
  const host = url.hostname.toLowerCase()
  const want = exprHost.toLowerCase()
  if (want === '*') return true
  if (want.startsWith('*.')) {
    if (!host.endsWith(want.slice(1))) return false
  } else if (host !== want) {
    return false
  }
  const actualPort = url.port || DEFAULT_PORTS[scheme] || ''
  if (exprPort === undefined) {
    // No port: the scheme's default (or, after an http→https upgrade, 443).
    if (actualPort !== (DEFAULT_PORTS[scheme] ?? '')) return false
  } else if (exprPort !== '*' && exprPort !== actualPort) {
    return false
  }
  if (exprPath && exprPath !== '/') {
    const path = decodeURIComponent(url.pathname)
    const want = decodeURIComponent(exprPath)
    if (want.endsWith('/') ? !path.startsWith(want) : path !== want) return false
  }
  return true
}

export interface CspVerdict {
  allowed: boolean
  /** The directive that decided it ('connect-src', or 'default-src' when connect-src is absent). */
  directive: 'connect-src' | 'default-src' | null
  /** That directive's sources, for the task text. */
  sources: string[]
}

/**
 * Whether the page's policies let the SDK `fetch` the Mushi API. fetch is
 * governed by connect-src and, when a policy has none, by default-src
 * (CSP3 fallback). No policy, or neither directive, allows it.
 */
export function cspAllowsConnect(policies: readonly CspPolicy[], apiUrl: URL, pageUrl: URL): CspVerdict {
  for (const policy of policies) {
    const directive = policy.has('connect-src') ? 'connect-src' : policy.has('default-src') ? 'default-src' : null
    if (!directive) continue
    const sources = policy.get(directive) ?? []
    if (!sources.some((src) => sourceMatches(src, apiUrl, pageUrl))) return { allowed: false, directive, sources }
  }
  return { allowed: true, directive: null, sources: [] }
}

/** https site URLs a recipe manifest declares as deploy targets (mirrors radar targetFromManifest). */
export function siteUrlsFromManifest(manifest: unknown): string[] {
  const targets = (manifest as { deploy?: { targets?: unknown } } | null)?.deploy?.targets
  const out: string[] = []
  for (const t of Array.isArray(targets) ? targets.slice(0, 20) : []) {
    const raw = (t as { url?: unknown } | null)?.url
    if (typeof raw !== 'string') continue
    try {
      const u = new URL(raw)
      if (u.protocol === 'https:') out.push(u.toString())
    } catch {
      // not a URL
    }
  }
  return out
}

// ── the verdict ──────────────────────────────────────────────────────────────

export type Read<T> = { ok: true; value: T } | { ok: false; reason: string }

export interface SdkHealthInput {
  /** owner/repo, for the copy. */
  repoLabel: string | null
  /** package.json files at the default-branch head. */
  packages: Read<PackageJsonFile[]>
  /** Required Mushi CI names absent from the repo's Actions secrets and variables. */
  missingCiVars: Read<string[]>
  /** Freshest heartbeat across the app's active SDK keys. */
  lastSeenAt: string | null
  nativeEverSeen: boolean
  /** Latest published version per @mushi-mushi package (sdk_versions). */
  latest: Read<Record<string, string>>
  /** The live site's CSP verdict; null when no site address is known. */
  csp: Read<{ url: string; apiOrigin: string; verdict: CspVerdict }> | null
  now: Date
}

export interface SdkHealthResult {
  problems: SdkHealthProblem[]
  notes: SdkHealthNote[]
  installed: boolean | null
  lastSeenAt: string | null
}

const SEVERITY_RANK: Record<SdkHealthSeverity, number> = { error: 0, warn: 1, info: 2 }

function list(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000)
}

export function sdkHealthProblems(input: SdkHealthInput): SdkHealthResult {
  const problems: SdkHealthProblem[] = []
  const notes: SdkHealthNote[] = []
  const repo = input.repoLabel ?? 'your repo'
  const files = input.packages.ok ? input.packages.value : []
  const deps = mushiDeps(files)
  // The CLI or MCP alone in a repo is not the SDK: nothing reports bugs from the app.
  const sdkDeps = deps.filter((d) => isSdkPackage(d.name))
  const target = detectAppTarget(files)
  const seen = input.lastSeenAt != null
  // A heartbeat proves an install, wherever its package.json lives.
  const installed = sdkDeps.length > 0 || seen ? true : input.packages.ok && files.length > 0 ? false : null

  if (!input.packages.ok) notes.push({ check: 'repo', detail: `Could not read ${repo}: ${input.packages.reason}` })
  else if (files.length === 0 && !seen) notes.push({ check: 'repo', detail: `No package.json found in ${repo}, so Mushi cannot tell whether the SDK is installed.` })

  if (installed === false) {
    problems.push({
      id: 'not_installed',
      severity: 'error',
      title: "The SDK isn't in your app yet",
      detail: `No package.json in ${repo} lists a Mushi SDK package (such as @mushi-mushi/web or @mushi-mushi/react-native), so the app sends no bug reports.`,
      fix: { kind: 'install_task', label: 'File install task' },
    })
  }

  // Missing CI names matter when no build has checked in, or a native app
  // has never checked in from a store build: a live web heartbeat means the
  // app gets its env from somewhere else (Vercel, Netlify, a .env).
  let ciProblem = false
  if (!input.missingCiVars.ok) {
    notes.push({ check: 'ci_secrets', detail: `Could not check the GitHub Actions secrets: ${input.missingCiVars.reason}` })
  } else if (input.missingCiVars.value.length > 0 && installed !== null) {
    const native = target?.stack === 'expo' || target?.capacitor === true
    if (!seen || (native && !input.nativeEverSeen)) {
      ciProblem = true
      const names = input.missingCiVars.value
      problems.push({
        id: 'ci_secrets_missing',
        severity: seen ? 'warn' : 'error',
        title: 'GitHub Actions is missing the Mushi keys',
        detail: `${list(names)} ${names.length === 1 ? 'is' : 'are'} not set in ${repo}. Builds made there ship without them, so the widget stays off.`,
        fix: { kind: 'sync_ci_secrets', label: 'Write CI secrets' },
      })
    }
  }

  if (sdkDeps.length > 0 && !seen) {
    const where = sdkDeps[0].path
    problems.push({
      id: 'never_seen',
      severity: 'error',
      title: 'The SDK has never checked in',
      detail: ciProblem
        ? `The SDK is in ${where}, but no build has reached Mushi. The missing CI keys above are the likely cause: write them, then ship a new build.`
        : `The SDK is in ${where}, but no build has reached Mushi. Check that the Mushi key and project id are set where the app builds, deploy, then open the app once.`,
      fix: null,
    })
  }

  if (!input.latest.ok) {
    if (deps.length > 0) notes.push({ check: 'versions', detail: `Could not read the latest SDK versions: ${input.latest.reason}` })
  } else {
    // The bumps the upgrade PR would make (same plan, same guards), so its
    // button never ends in "already up to date".
    const latest = input.latest.value
    const behind = files.flatMap((f) => {
      let pkg: unknown
      try {
        pkg = JSON.parse(f.text)
      } catch {
        return []
      }
      if (typeof pkg !== 'object' || pkg === null) return []
      return computeBumpPlan(pkg as Record<string, unknown>, latest).bumps.map((b) => ({ ...b, path: f.path }))
    })
    if (behind.length > 0) {
      problems.push({
        id: 'outdated',
        severity: 'warn',
        title: behind.length === 1 ? 'An SDK update is out' : 'SDK updates are out',
        detail: behind.map((b) => `${b.package} ${b.from} → ${b.to} (${b.path})`).join('; ') + '.',
        fix: { kind: 'upgrade_pr', label: 'Open upgrade PR' },
      })
    }
  }

  // An Expo app with no web SDK sends nothing from a browser: a site's CSP cannot block it.
  const csp = cspApplies(files) ? input.csp : undefined
  if (csp === null) {
    notes.push({ check: 'site_csp', detail: "No live site address is known, so the site's security policy was not checked. Add the address in Site watch or the site audit." })
  } else if (csp && !csp.ok) {
    notes.push({ check: 'site_csp', detail: `Could not check the site's security policy: ${csp.reason}` })
  } else if (csp && !csp.value.verdict.allowed) {
    const { url, apiOrigin, verdict } = csp.value
    problems.push({
      id: 'csp_blocks_api',
      severity: 'error',
      title: "Your site's security policy blocks Mushi",
      detail: `${url} sends a Content-Security-Policy whose ${verdict.directive} does not allow ${apiOrigin}, so the browser blocks every bug report.`,
      fix: { kind: 'csp_task', label: 'File CSP task' },
    })
  }

  if (input.lastSeenAt) {
    const days = daysBetween(input.now, new Date(input.lastSeenAt))
    if (days >= SDK_STALE_DAYS) {
      problems.push({
        id: 'stale',
        severity: 'info',
        title: `No check-in for ${days} days`,
        detail: `The SDK last reached Mushi on ${input.lastSeenAt.slice(0, 10)}. If the app is still live, check that its key is active and the latest build still includes the SDK.`,
        fix: null,
      })
    }
  }

  problems.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
  return { problems, notes, installed, lastSeenAt: input.lastSeenAt }
}

// ── task reports ─────────────────────────────────────────────────────────────

export interface TaskReport {
  title: string
  summary: string
  description: string
  severity: 'high' | 'medium'
  component: string
  tags: string[]
  environment: Record<string, unknown>
}

export interface InstallTaskInput {
  appName: string
  repoLabel: string
  repoUrl: string
  /** null when no package.json names a framework; `fallbackStack` is used then. */
  target: AppTarget | null
  fallbackStack: SdkStack
  projectId: string
  endpoint: string
  /** .github/workflows files, to name where the env lines go. */
  workflows: string[]
  commitSha: string
}

const TEMPLATE_REPO = 'kensaurus/the-wanting-mind'

const STACK_LABEL: Record<SdkStack, string> = { nextjs: 'Next.js', nuxt: 'Nuxt', vite: 'Vite', expo: 'Expo / React Native' }

function envNames(stack: SdkStack): { projectId: string; apiKey: string; endpoint: string } {
  const [projectId, apiKey, endpoint] = buildCiVars({ stack, projectId: '', endpoint: '', mintedKey: '' }).map((v) => v.name)
  return { projectId, apiKey, endpoint }
}

function webSteps(stack: SdkStack, dir: string, capacitor: boolean, env: ReturnType<typeof envNames>): string[] {
  const at = (p: string) => (dir ? `${dir}/${p}` : p)
  const read = stack === 'vite' ? (n: string) => `import.meta.env.${n}` : (n: string) => `process.env.${n}`
  const steps: string[] = []
  steps.push(`Install the SDK in ${dir || 'the repo root'}: \`@mushi-mushi/web\`, with the repo's package manager (commit the lockfile).`)
  steps.push(
    `Add \`${at('src/lib/mushi-env.ts')}\` with \`readMushiEnv(raw)\` (trims, and treats '', '-', 'undefined' and 'null' as unset; CI can bake a secret placeholder as '-') and \`readMushiEndpoint(raw)\` (only absolute http(s) URLs). Copy ${TEMPLATE_REPO} src/lib/mushi-env.ts.`,
  )
  steps.push(
    `Add \`${at('src/lib/mushi.ts')}\` with \`initMushi()\`: read ${env.projectId}, ${env.apiKey} and ${env.endpoint} through \`${read(env.apiKey)}\` and the helpers above, return early when the key or project id is missing, and call \`Mushi.init({ projectId, apiKey, ...(apiEndpoint ? { apiEndpoint } : {}), widget: { trigger }, runtimeConfig })\` inside try/catch so a failure never breaks the first paint. Copy the shape of ${TEMPLATE_REPO} src/lib/mushi.ts; leave out its i18n, Sentry and category code unless this app has them.`,
  )
  if (stack === 'nextjs') {
    steps.push("Call `initMushi()` once on the client: a small `'use client'` component that runs it in `useEffect`, mounted in the root layout. Never call it during server rendering.")
  } else if (stack === 'nuxt') {
    steps.push('Call `initMushi()` once from a client-only plugin (`plugins/mushi.client.ts`).')
  } else {
    steps.push('Call `initMushi()` once at app start (the entry file, e.g. `src/main.tsx`), after the first render is scheduled.')
  }
  if (capacitor) {
    steps.push(
      `This app also ships as a store app (Capacitor). Add \`${at('src/lib/mushi-launcher.ts')}\` from ${TEMPLATE_REPO}: in a native shell the widget launches \`trigger: 'manual'\` with \`runtimeConfig: false\`, opened only from Settings or Account, never a persistent banner or floating button. App Review rejected a persistent report bar under guideline 2.2. On the web the banner stays until the reader dismisses it; remember the dismissal in localStorage.`,
    )
  } else {
    steps.push("Launch the widget as `trigger: 'banner'` with `runtimeConfig: true` on the web.")
  }
  return steps
}

function nativeSteps(dir: string, env: ReturnType<typeof envNames>): string[] {
  return [
    `Install the SDK in ${dir || 'the repo root'}: \`npx expo install @mushi-mushi/react-native\` (commit the lockfile).`,
    `Wrap the root layout in \`<MushiProvider projectId={…} apiKey={…} config={{ apiEndpoint, widget: { trigger: 'manual' } }}>\`, reading ${env.projectId}, ${env.apiKey} and ${env.endpoint} from \`process.env\`. Render the children without the provider when the key or project id is missing.`,
    "Keep the trigger `'manual'`: no floating button, shake or banner. App Review rejected a persistent report bar under guideline 2.2. Add a \"Report a problem\" row in Settings (and Account, if there is one) that calls `useMushiWidget().open()`.",
    'The EXPO_PUBLIC_ values are baked in at build time: an OTA update cannot add them to a store build that lacks them. Ship a new store build after this merges.',
  ]
}

/** The `install` task: add the SDK to the app, framework-aware, in the shape of the twm integration. */
export function installTaskReport(input: InstallTaskInput): TaskReport {
  const stack = input.target?.stack ?? input.fallbackStack
  const dir = input.target?.dir ?? ''
  const capacitor = input.target?.capacitor ?? false
  const env = envNames(stack)
  const origin = new URL(input.endpoint).origin
  const steps = stack === 'expo' ? nativeSteps(dir, env) : webSteps(stack, dir, capacitor, env)
  const workflows = input.workflows.length > 0 ? input.workflows.map((w) => `\`${w}\``).join(', ') : 'the workflow that builds and deploys the app'
  steps.push(
    `Pass the values to every build. In ${workflows}, add to the build step's \`env:\` block: \`${env.projectId}: \${{ vars.${env.projectId} }}\`, \`${env.apiKey}: \${{ secrets.${env.apiKey} }}\` and \`${env.endpoint}: \${{ vars.${env.endpoint} }}\`. If the app builds on a host (Vercel, Netlify, EAS), set the same three there.`,
  )
  if (stack !== 'expo') {
    steps.push(`If the site sends a Content-Security-Policy (a header or a <meta> tag), add \`${origin}\` to its connect-src.`)
  }
  steps.push(`Add the three names, without values, to the app's .env.example.`)
  const lines: string[] = [
    `Add the Mushi bug-report SDK to ${input.appName} (${STACK_LABEL[stack]}${capacitor ? ' + Capacitor' : ''}, ${input.target ? `\`${input.target.path}\`` : 'no framework found in package.json; check where the app lives'}).`,
    '',
    `No package.json in ${input.repoLabel} lists a @mushi-mushi package, so the app sends no bug reports.`,
    '',
    'How to fix:',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    `${steps.length + 1}. Run the app's tests and build.`,
    '',
    'Values:',
    `- ${env.projectId} = ${input.projectId}`,
    `- ${env.endpoint} = ${input.endpoint}`,
    `- ${env.apiKey}: never commit it. It is the GitHub Actions secret ${env.apiKey}; if it is missing, use "Write CI secrets" on Mushi's Connect page.`,
    '',
    'Done when:',
    '- After the PR merges and the app deploys, opening it once makes Mushi show an SDK check-in (Connect → SDK health, or the SDK heartbeat in the app switcher).',
    '- The diff contains no key value.',
    "- The app's tests and build pass.",
    '',
    `Filed by Mushi SDK health from ${input.repoUrl} at ${input.commitSha.slice(0, 7)}. Template: ${TEMPLATE_REPO} (src/lib/mushi.ts, src/lib/mushi-env.ts, src/lib/mushi-launcher.ts).`,
  ]
  const summary = `Add the Mushi SDK to ${input.appName}`
  return {
    title: summary,
    summary,
    description: lines.join('\n').slice(0, 10_000),
    severity: 'high',
    component: taskComponent('install'),
    tags: ['sdk_health', 'sdk_install', stack],
    environment: {
      source: 'sdk-health',
      kind: 'install',
      stack,
      capacitor,
      packageJson: input.target?.path ?? null,
      sdkPackage: stack === 'expo' ? '@mushi-mushi/react-native' : '@mushi-mushi/web',
      commitSha: input.commitSha,
    },
  }
}

export interface CspTaskInput {
  appName: string
  repoLabel: string | null
  siteUrl: string
  apiOrigin: string
  verdict: CspVerdict
}

/** The `csp` task: let the site's CSP connect-src reach the Mushi API. */
export function cspTaskReport(input: CspTaskInput): TaskReport {
  const directive = input.verdict.directive ?? 'connect-src'
  const lines: string[] = [
    `${input.siteUrl} sends a Content-Security-Policy whose ${directive} does not allow ${input.apiOrigin}. The browser blocks the Mushi SDK's requests, so no bug report from the site reaches Mushi.`,
    '',
    `Current ${directive}: ${input.verdict.sources.length > 0 ? input.verdict.sources.join(' ') : '(empty)'}`,
    '',
    'How to fix:',
    `1. Find where ${input.repoLabel ?? 'the repo'} sets the policy: the host's headers config (\`vercel.json\`, \`netlify.toml\`, \`_headers\`, \`next.config.*\` headers(), a CloudFront or Lambda@Edge function) and any \`<meta http-equiv="Content-Security-Policy">\` in index.html. Change every copy; a CSP parity check, if the repo has one, must stay green.`,
    directive === 'default-src'
      ? `2. Add a connect-src directive: the current default-src sources plus \`${input.apiOrigin}\`. Leave default-src as it is.`
      : `2. Add \`${input.apiOrigin}\` to connect-src. Do not add \`*\`, \`https:\` or a broader wildcard.`,
    "3. Run the app's tests and build.",
    '',
    'Done when:',
    `- After deploy, ${input.siteUrl} sends a policy whose ${directive === 'default-src' ? 'connect-src' : directive} includes ${input.apiOrigin} (Connect → SDK health no longer lists this problem).`,
    '- No other directive changed.',
    '',
    'Filed by Mushi SDK health from the live site headers.',
  ]
  const summary = `Allow the Mushi API in ${input.appName}'s Content-Security-Policy`
  return {
    title: summary.slice(0, 200),
    summary: summary.slice(0, 200),
    description: lines.join('\n').slice(0, 10_000),
    severity: 'high',
    component: taskComponent('csp'),
    tags: ['sdk_health', 'csp'],
    environment: { source: 'sdk-health', kind: 'csp', siteUrl: input.siteUrl, apiOrigin: input.apiOrigin, directive, sources: input.verdict.sources },
  }
}
