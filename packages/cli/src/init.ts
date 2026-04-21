/**
 * FILE: packages/cli/src/init.ts
 * PURPOSE: `mushi init` wizard — detects framework, asks for credentials,
 *          installs the right SDK, writes env vars, prints next-step snippet.
 *
 * Modeled on the Sentry / PostHog wizard pattern: one shell command, minimal
 * prompts, transparent about every file it touches.
 */

import * as p from '@clack/prompts'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectFramework,
  detectPackageManager,
  envVarsToWrite,
  FRAMEWORKS,
  installCommand,
  readPackageJson,
  type Framework,
  type FrameworkId,
  type PackageManager,
} from './detect.js'
import { loadConfig, saveConfig } from './config.js'
import { normalizeEndpoint, TEST_REPORT_FETCH_TIMEOUT_MS } from './endpoint.js'
import { checkFreshness } from './freshness.js'
import { detectWorkspaceHint, type WorkspaceHint } from './monorepo.js'
import { MUSHI_CLI_VERSION } from './version.js'

export interface InitOptions {
  cwd?: string
  projectId?: string
  apiKey?: string
  framework?: FrameworkId
  skipInstall?: boolean
  yes?: boolean
  endpoint?: string
  sendTestReport?: boolean
}

const ENV_FILES = ['.env.local', '.env'] as const

const PROJECT_ID_PATTERN = /^proj_[A-Za-z0-9_-]{10,}$/
const API_KEY_PATTERN = /^mushi_[A-Za-z0-9_-]{10,}$/

export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd()

  ensureInteractiveOrBailOut(options)

  p.intro('🐛 Mushi Mushi setup wizard')

  await printFreshnessHint()
  warnIfWorkspaceRoot(cwd)

  const pkg = readPackageJson(cwd)
  if (!pkg) {
    p.log.warn('No package.json found in this directory.')
    const cont = await p.confirm({
      message: 'Continue anyway? (Mushi will install into the current folder)',
      initialValue: false,
    })
    if (p.isCancel(cont) || !cont) {
      p.cancel('Aborted. Run from your project root and try again.')
      process.exit(0)
    }
  }

  const detected = detectFramework(cwd, pkg)
  const framework = await chooseFramework(detected, options)

  const credentials = await collectCredentials(options)

  const pm = detectPackageManager(cwd)
  const packagesToInstall = framework.needsWebPackage
    ? [framework.packageName, '@mushi-mushi/web']
    : [framework.packageName]

  if (!options.skipInstall) {
    await installPackages(pm, packagesToInstall, cwd)
  } else {
    p.log.info(`Skipped install. Run \`${installCommand(pm, packagesToInstall)}\` yourself.`)
  }

  writeEnvFile(cwd, credentials.apiKey, credentials.projectId, framework)
  persistCliConfig(credentials.apiKey, credentials.projectId)

  printNextSteps(framework, credentials.apiKey, credentials.projectId)

  await maybeSendTestReport(credentials, options)

  p.outro('Setup complete. Happy bug squashing 🐛')
}

/**
 * Non-interactive guard. When stdin is not a TTY (CI, shell pipelines,
 * Docker builds) `@clack/prompts` hangs forever on the first prompt. Bail
 * out with a clear error unless the user supplied enough flags to skip
 * every prompt.
 */
function ensureInteractiveOrBailOut(options: InitOptions): void {
  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  if (isTTY) return

  const hasAllFlags = Boolean(
    (options.framework || options.yes) && options.projectId && options.apiKey,
  )
  if (hasAllFlags) return

  process.stderr.write(
    'mushi-mushi: non-interactive terminal detected.\n' +
      'Pass all of --yes (or --framework), --project-id, and --api-key to run unattended.\n' +
      'Example: npx mushi-mushi --yes --project-id proj_xxx --api-key mushi_xxx\n',
  )
  process.exit(1)
}

async function chooseFramework(detected: Framework, options: InitOptions): Promise<Framework> {
  if (options.framework) {
    const explicit = FRAMEWORKS[options.framework]
    if (!explicit) throw new Error(`Unknown framework: ${options.framework}`)
    p.log.step(`Using framework: ${explicit.label} (from --framework)`)
    return explicit
  }

  if (options.yes) {
    p.log.step(`Detected ${detected.label} → installing ${detected.packageName}`)
    return detected
  }

  const confirmed = await p.select({
    message: `Detected ${detected.label}. Use this?`,
    initialValue: detected.id,
    options: Object.values(FRAMEWORKS).map((fw) => ({
      value: fw.id,
      label: `${fw.id === detected.id ? '✓ ' : '  '}${fw.label}`,
      hint: fw.packageName,
    })),
  })

  if (p.isCancel(confirmed)) {
    p.cancel('Aborted.')
    process.exit(0)
  }

  return FRAMEWORKS[confirmed]
}

async function collectCredentials(options: InitOptions): Promise<{ apiKey: string; projectId: string }> {
  const existing = loadConfig()

  const rawProjectId =
    options.projectId ??
    existing.projectId ??
    (await promptText({
      message: 'Project ID',
      placeholder: 'proj_xxxxxxxxxxxx',
      hint: 'Find this at https://kensaur.us/mushi-mushi/projects',
      validate: (v) =>
        PROJECT_ID_PATTERN.test(v)
          ? undefined
          : 'Expected format: proj_ followed by 10+ alphanumeric characters',
    }))

  const rawApiKey =
    options.apiKey ??
    existing.apiKey ??
    (await promptText({
      message: 'API key',
      placeholder: 'mushi_xxxxxxxxxxxx',
      hint: 'Treat this like a password — it goes in your env file, not in source.',
      validate: (v) =>
        API_KEY_PATTERN.test(v)
          ? undefined
          : 'Expected format: mushi_ followed by 10+ alphanumeric characters',
    }))

  const projectId = sanitizeSecret(rawProjectId)
  const apiKey = sanitizeSecret(rawApiKey)

  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(
      `Invalid project ID. Expected format: proj_[A-Za-z0-9_-]{10,}. Got: ${redact(projectId)}`,
    )
  }
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new Error(
      `Invalid API key. Expected format: mushi_[A-Za-z0-9_-]{10,}. Got: ${redact(apiKey)}`,
    )
  }

  return { projectId, apiKey }
}

/**
 * Strip whitespace, quotes, and any control characters a user might paste by
 * accident. Prevents env-file injection via newlines in a pasted secret.
 * Exported for test coverage of the env-file-injection defense.
 */
export function sanitizeSecret(raw: string): string {
  return raw
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/[\r\n\0]/g, '')
}

function redact(value: string): string {
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}…${value.slice(-2)}`
}

async function promptText(opts: {
  message: string
  placeholder?: string
  hint?: string
  validate?: (value: string) => string | undefined
}): Promise<string> {
  const value = await p.text({
    message: opts.message,
    placeholder: opts.placeholder,
    validate: (v) => {
      const clean = sanitizeSecret(v)
      if (clean.length === 0) return 'Required'
      return opts.validate ? opts.validate(clean) : undefined
    },
  })
  if (p.isCancel(value)) {
    p.cancel('Aborted.')
    process.exit(0)
  }
  if (opts.hint) p.log.info(opts.hint)
  return value
}

async function installPackages(pm: PackageManager, packages: string[], cwd: string): Promise<void> {
  const command = installCommand(pm, packages)
  const spinner = p.spinner()
  spinner.start(`Installing ${packages.join(', ')} via ${pm}…`)

  try {
    await runCommand(pm, packages, cwd)
    spinner.stop(`Installed ${packages.join(', ')}`)
  } catch (err) {
    spinner.stop(`Install failed — run \`${command}\` manually.`)
    // Surface only the terse error shape — never leak the full command with
    // secrets that might have landed in argv via --api-key.
    p.log.error(err instanceof Error ? err.name + ': ' + err.message : String(err))
  }
}

/**
 * Spawn the package manager safely across platforms without relying on
 * `shell: true`. On Windows npm / pnpm / yarn / bun ship as `.cmd` shims, so
 * we resolve the platform-specific executable name up-front.
 */
function runCommand(pm: PackageManager, packages: string[], cwd: string): Promise<void> {
  const verb = pm === 'npm' ? 'install' : 'add'
  const command = process.platform === 'win32' ? `${pm}.cmd` : pm

  return new Promise((resolve, reject) => {
    const child = spawn(command, [verb, ...packages], {
      stdio: 'inherit',
      shell: false,
      cwd,
      env: process.env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${pm} exited with code ${code ?? 'null'}`))
    })
  })
}

function writeEnvFile(cwd: string, apiKey: string, projectId: string, framework: Framework): void {
  const target = ENV_FILES.find((f) => existsSync(join(cwd, f))) ?? ENV_FILES[0]
  const targetPath = join(cwd, target)
  const newVars = envVarsToWrite(apiKey, projectId, framework)

  const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf-8') : ''
  if (existing.includes('MUSHI_PROJECT_ID')) {
    p.log.warn(`Existing MUSHI_* vars found in ${target} — leaving them untouched.`)
    return
  }

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  appendFileSync(targetPath, `${prefix}\n# Mushi Mushi\n${newVars}\n`)

  p.log.success(`Wrote env vars to ${target}`)
  warnIfMissingFromGitignore(cwd, target)
}

/**
 * Return true when any line in the user's `.gitignore` actually matches the
 * env file we just wrote. Subtle point: `.env` in gitignore does NOT cover
 * `.env.local` — gitignore matches by filename, not prefix. We build a tiny
 * glob matcher (only `*` as wildcard, gitignore's common case) and test each
 * non-comment line. `!`-prefixed negations are treated as "not covered" to
 * stay on the safe side — better a false warning than a silent leak.
 */
export function isEnvFileCoveredByGitignore(
  gitignoreContent: string,
  envFile: string,
): boolean {
  const lines = gitignoreContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  let covered = false
  for (const line of lines) {
    if (line.startsWith('!')) {
      if (matchesGitignorePattern(line.slice(1), envFile)) covered = false
      continue
    }
    if (matchesGitignorePattern(line, envFile)) covered = true
  }
  return covered
}

/**
 * Minimal gitignore-style matcher:
 *   - leading "/" anchors to the root (we always match against a single
 *     filename, so we just strip it)
 *   - trailing "/" means directory-only — does not match a file
 *   - "*" matches any run of characters except "/"
 *   - all other characters are literal
 * Good enough for the half-dozen env-file patterns users actually write.
 */
function matchesGitignorePattern(pattern: string, filename: string): boolean {
  if (pattern.endsWith('/')) return false
  const normalized = pattern.startsWith('/') ? pattern.slice(1) : pattern
  const regexSource = normalized
    .split('')
    .map((ch) => (ch === '*' ? '[^/]*' : escapeRegexChar(ch)))
    .join('')
  return new RegExp(`^${regexSource}$`).test(filename)
}

function escapeRegexChar(ch: string): string {
  return /[-/\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch
}

function warnIfMissingFromGitignore(cwd: string, envFile: string): void {
  const gitignorePath = join(cwd, '.gitignore')
  if (!existsSync(gitignorePath)) {
    p.log.warn(`No .gitignore found — make sure ${envFile} is not committed.`)
    return
  }
  const content = readFileSync(gitignorePath, 'utf-8')
  if (!isEnvFileCoveredByGitignore(content, envFile)) {
    p.log.warn(`${envFile} is not in .gitignore — add it before committing.`)
  }
}

function persistCliConfig(apiKey: string, projectId: string): void {
  const existing = loadConfig()
  saveConfig({ ...existing, apiKey, projectId })
}

function printNextSteps(framework: Framework, apiKey: string, projectId: string): void {
  p.note(framework.snippet(apiKey, projectId), 'Add this to your app:')

  p.log.message('Verify the install:')
  p.log.message('  • Start your dev server')
  p.log.message('  • Look for the 🐛 button in the bottom-right corner (or shake on mobile)')
  p.log.message('  • Submit a test report — it should appear at https://kensaur.us/mushi-mushi/reports')
}

/**
 * Close the loop: send a real report through the public ingest endpoint so
 * the user immediately sees their first classified bug in the console.
 * Opt-in via prompt (or `--yes` auto-accepts it).
 */
async function maybeSendTestReport(
  credentials: { apiKey: string; projectId: string },
  options: InitOptions,
): Promise<void> {
  if (options.sendTestReport === false) return

  let shouldSend: boolean
  if (options.sendTestReport === true || options.yes) {
    shouldSend = true
  } else {
    const answer = await p.confirm({
      message: 'Send a test report now to verify the pipeline?',
      initialValue: true,
    })
    if (p.isCancel(answer)) return
    shouldSend = answer
  }

  if (!shouldSend) return

  const spinner = p.spinner()
  spinner.start('Sending test report…')

  const endpoint = normalizeEndpoint(options.endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TEST_REPORT_FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(`${endpoint}/v1/reports`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': credentials.apiKey,
        'X-Mushi-Project': credentials.projectId,
      },
      body: JSON.stringify({
        projectId: credentials.projectId,
        description: 'Test report from the mushi-mushi setup wizard',
        category: 'other',
        reporterToken: `wizard-${randomUUID()}`,
        createdAt: new Date().toISOString(),
        environment: {
          url: 'cli://wizard',
          userAgent: `mushi-wizard/${process.platform}-${process.arch}`,
          platform: process.platform,
          language: 'en',
          viewport: { width: 0, height: 0 },
          referrer: '',
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    })

    if (!res.ok) {
      spinner.stop(`Test report rejected (HTTP ${res.status}).`)
      p.log.warn(
        res.status === 401 || res.status === 403
          ? 'Credentials did not authenticate — double-check the project ID and API key.'
          : 'Skipping test report. You can retry with `mushi test`.',
      )
      return
    }

    spinner.stop('Test report sent.')
    p.log.success('View it at https://kensaur.us/mushi-mushi/reports')
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    spinner.stop(aborted ? 'Timed out reaching the Mushi API.' : 'Could not reach the Mushi API.')
    p.log.warn(err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}

async function printFreshnessHint(): Promise<void> {
  const result = await checkFreshness('mushi-mushi', MUSHI_CLI_VERSION)
  if (!result || !result.isOutdated) return
  p.log.info(
    `A newer version of mushi-mushi is available: ${result.current} → ${result.latest}. ` +
      'Run `npx mushi-mushi@latest` to get the freshest wizard.',
  )
}

function warnIfWorkspaceRoot(cwd: string): void {
  let hint: WorkspaceHint | null
  try {
    hint = detectWorkspaceHint(cwd)
  } catch {
    return
  }
  if (!hint || hint.apps.length === 0) return

  const hasFrameworkAtCwd = hint.apps.some((app) =>
    isSameDirectory(cwd, resolveWorkspaceAppPath(hint!.root, app.relativePath)),
  )
  if (hasFrameworkAtCwd) return

  const apps = hint.apps
    .slice(0, 5)
    .map((app) => `  • ${app.relativePath} (${app.framework})`)
    .join('\n')
  p.log.warn(
    `You appear to be at a workspace root (source: ${hint.source}). Mushi will install into the current directory, ` +
      'which has no framework dep. You probably meant one of these sub-packages:\n' +
      `${apps}\n` +
      'Run `mushi init --cwd <path>` — or re-run the wizard from inside that package.',
  )
}

function resolveWorkspaceAppPath(root: string, relativePath: string): string {
  return `${root}/${relativePath}`.replace(/\\/g, '/')
}

function isSameDirectory(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').replace(/\/+$/, '') === b.replace(/\\/g, '/').replace(/\/+$/, '')
}
