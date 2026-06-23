/**
 * FILE: packages/cli/src/console-url.ts
 * PURPOSE: Resolve the Mushi admin console base URL and build CLI deep links (hosted, local, or override).
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadConfig } from './config.js'

/** Canonical hosted admin console (VITE_BASE_PATH=/mushi-mushi/admin/). */
export const HOSTED_CONSOLE_BASE = 'https://kensaur.us/mushi-mushi/admin'

const LOCAL_ADMIN_URL = 'http://localhost:6464'
const LOCAL_PROBE_MS = 800

export function normalizeConsoleBase(url: string): string {
  // Char-by-char trailing-slash trim (not `/\/+$/`) to avoid a ReDoS surface on
  // attacker-controlled console URLs and the CodeQL polynomial-regex alert that
  // flags `+` on a repeatable character. Linear time, no backtracking.
  const trimmed = url.trim()
  let end = trimmed.length
  while (end > 0 && trimmed.charCodeAt(end - 1) === 47 /* '/' */) end--
  return trimmed.slice(0, end)
}

export function consoleUrl(base: string, route: string): string {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  return `${normalizeConsoleBase(base)}${normalizedRoute}`
}

export function resolveConsoleUrlFromEnv(): string | undefined {
  const raw = process.env['MUSHI_CONSOLE_URL']?.trim()
  return raw ? normalizeConsoleBase(raw) : undefined
}

/** Walk up from cwd looking for the mushi-mushi monorepo root package. */
export function isInsideMushiMonorepo(cwd: string): boolean {
  let dir = cwd
  for (let depth = 0; depth < 14; depth += 1) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string }
        if (pkg.name === 'mushi-mushi') return true
      } catch {
        // malformed package.json — keep walking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
}

export async function probeLocalAdminConsole(): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), LOCAL_PROBE_MS)
    const res = await fetch(LOCAL_ADMIN_URL, {
      signal: controller.signal,
      method: 'HEAD',
    })
    clearTimeout(timer)
    if (res.ok || res.status === 404 || res.status === 401) {
      return LOCAL_ADMIN_URL
    }
  } catch {
    // dev server not running
  }
  return null
}

/**
 * Sync resolver for static hint text (no localhost probe).
 * Prefers env → config → monorepo heuristic → hosted default.
 */
export function resolveConsoleUrlSync(cwd = process.cwd()): string {
  const fromEnv = resolveConsoleUrlFromEnv()
  if (fromEnv) return fromEnv

  const config = loadConfig()
  if (config.consoleUrl) return normalizeConsoleBase(config.consoleUrl)

  if (isInsideMushiMonorepo(cwd)) return LOCAL_ADMIN_URL

  return HOSTED_CONSOLE_BASE
}

/**
 * Async resolver used before opening the browser during setup.
 * Probes localhost:6464 whenever the dev server is reachable.
 */
export async function resolveConsoleUrl(options?: { cwd?: string }): Promise<string> {
  const fromEnv = resolveConsoleUrlFromEnv()
  if (fromEnv) return fromEnv

  const config = loadConfig()
  if (config.consoleUrl) return normalizeConsoleBase(config.consoleUrl)

  const local = await probeLocalAdminConsole()
  if (local) return local

  const cwd = options?.cwd ?? process.cwd()
  if (isInsideMushiMonorepo(cwd)) return LOCAL_ADMIN_URL

  return HOSTED_CONSOLE_BASE
}

export function projectIdHint(base: string): string {
  return (
    `Where to find it: ${consoleUrl(base, '/projects')} → select your project → ` +
    'click the UUID chip to copy (or copy it from the panel right after you create the project).'
  )
}

export function apiKeyHint(base: string): string {
  return (
    `Where to find it: ${consoleUrl(base, '/onboarding?tab=verify')} → Generate API key ` +
    `(SDK ingest needs report:write — not Settings → BYOK keys). Treat it like a password — env file only, never commit.`
  )
}

export function cliSetupDeepLink(base: string): string {
  return consoleUrl(base, '/onboarding?tab=steps&setup=cli')
}

export function signInUrl(base: string): string {
  return consoleUrl(base, '/login')
}

export function reportsUrl(base: string, reportId?: string): string {
  return reportId
    ? consoleUrl(base, `/reports/${reportId}`)
    : consoleUrl(base, '/reports')
}

/**
 * Open a URL in the user's default browser.
 *
 * Security: only http(s) URLs are launched, and the URL is passed as a discrete
 * argument via `spawn` (never interpolated into a shell command string). This
 * removes the shell-injection surface CodeQL flags for `exec(\`open "${url}"\`)`
 * — even a URL containing shell metacharacters can't break out of the argv slot.
 */
export async function openInBrowser(url: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return // not a URL — nothing safe to open
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return // refuse file:, data:, javascript:, etc.
  }
  const safeUrl = parsed.toString()

  const { spawn } = await import('node:child_process')
  const [command, args] =
    process.platform === 'win32'
      ? // Open via rundll32's FileProtocolHandler rather than `cmd /c start`.
        // `start` is a cmd builtin, so the URL would be re-parsed by cmd.exe and
        // characters like `&` / `|` / `^` could still break out — exactly the
        // injection surface CodeQL flags. rundll32 never invokes a shell: the URL
        // is handed to the default browser as one opaque argument.
        (['rundll32', ['url.dll,FileProtocolHandler', safeUrl]] as const)
      : process.platform === 'darwin'
        ? (['open', [safeUrl]] as const)
        : (['xdg-open', [safeUrl]] as const)

  await new Promise<void>((resolve) => {
    try {
      const child = spawn(command, [...args], { stdio: 'ignore', shell: false })
      child.on('error', () => resolve())
      child.on('exit', () => resolve())
      child.unref()
    } catch {
      resolve()
    }
  })
}
