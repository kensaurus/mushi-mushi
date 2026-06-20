/**
 * FILE: packages/cli/src/console-url.ts
 * PURPOSE: Resolve the Mushi admin console base URL for CLI hints, browser
 *          opens, and deep links — hosted cloud, local :6464, or override.
 *
 * OVERVIEW:
 * - `resolveConsoleUrl()` async: env → saved config → localhost probe → hosted
 * - `resolveConsoleUrlSync()` for copy-only hints without network
 * - Path helpers build onboarding/projects/connect deep links
 *
 * DEPENDENCIES:
 * - `./config.js` for persisted `consoleUrl`
 *
 * USAGE:
 * - Imported by `init.ts`, `commands/account.ts`, and tests
 *
 * NOTES:
 * - Local dev serves admin at http://localhost:6464 (no /admin prefix)
 * - Hosted production uses https://kensaur.us/mushi-mushi/admin
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { loadConfig } from './config.js'

/** Canonical hosted admin console (VITE_BASE_PATH=/mushi-mushi/admin/). */
export const HOSTED_CONSOLE_BASE = 'https://kensaur.us/mushi-mushi/admin'

const LOCAL_ADMIN_URL = 'http://localhost:6464'
const LOCAL_PROBE_MS = 800

export function normalizeConsoleBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
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

export async function openInBrowser(url: string): Promise<void> {
  const { exec } = await import('node:child_process')
  const openCmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`
  await new Promise<void>((resolve) => {
    exec(openCmd, () => resolve())
  })
}
