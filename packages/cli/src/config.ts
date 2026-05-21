/**
 * FILE: packages/cli/src/config.ts
 * PURPOSE: CLI configuration read/write — manages persistent credentials.
 *
 * v0.9 — XDG Base Directory Specification compliance.
 * The canonical config now lives at:
 *   - Linux/macOS: $XDG_CONFIG_HOME/mushi/config.json
 *                  (defaults to ~/.config/mushi/config.json)
 *   - Windows:     %APPDATA%/mushi/config.json
 *                  (defaults to ~/AppData/Roaming/mushi/config.json)
 *   - Anywhere:    falls back to ~/.mushirc when neither exists, and
 *                  one-way-migrates a legacy ~/.mushirc into the new
 *                  XDG path on first run after the upgrade.
 *
 * Security: the file is written with 0o600 (owner read/write only) so
 * other local users on a shared box cannot read the API key. On load,
 * if an existing config was written before this change (0o644), we
 * proactively chmod it down. The containing directory inherits 0o700.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'

export interface CliConfig {
  apiKey?: string
  endpoint?: string
  projectId?: string
}

const SECURE_FILE_MODE = 0o600
const SECURE_DIR_MODE = 0o700

/**
 * Resolve the XDG-compliant config path for `mushi/config.json`.
 *
 *   XDG_CONFIG_HOME (env)         → $XDG_CONFIG_HOME/mushi/config.json
 *   APPDATA (Windows env)         → %APPDATA%/mushi/config.json
 *   default Linux/macOS           → ~/.config/mushi/config.json
 *
 * SOURCE: https://specifications.freedesktop.org/basedir-spec/latest/
 */
export function resolveXdgConfigPath(): string {
  // Per the XDG spec, $XDG_CONFIG_HOME may be set by the user; if unset
  // OR empty, fall back to the platform default.
  const xdg = process.env['XDG_CONFIG_HOME']
  if (xdg && xdg.length > 0) {
    return join(xdg, 'mushi', 'config.json')
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA']
    if (appData && appData.length > 0) {
      return join(appData, 'mushi', 'config.json')
    }
  }
  return join(homedir(), '.config', 'mushi', 'config.json')
}

/** Path to the legacy single-file config maintained by CLI < 0.9. */
export const LEGACY_CONFIG_PATH = join(homedir(), '.mushirc')

/**
 * Default config path. Resolves at module-init time so calls that
 * don't supply an explicit path get the XDG location every time.
 *
 * Kept exported for backward-compat with code that imports `CONFIG_PATH`
 * directly — that constant now points at the XDG path. Callers who
 * specifically want the legacy `~/.mushirc` should import
 * `LEGACY_CONFIG_PATH`.
 */
export const CONFIG_PATH = resolveXdgConfigPath()

/**
 * Load CLI config. Read precedence (highest wins):
 *   1. Environment variables (MUSHI_API_KEY, MUSHI_PROJECT_ID, MUSHI_API_ENDPOINT)
 *   2. The XDG config file (or `path` arg if explicitly provided)
 *   3. Legacy ~/.mushirc — if found, migrated to the XDG path on first
 *      load so subsequent reads use the canonical location.
 *
 * Env vars overlay the file so CI can pin a different project without
 * touching the dev's saved config.
 *
 * Supported env vars:
 *   MUSHI_API_KEY       — API key (matches the SDK's env var name)
 *   MUSHI_PROJECT_ID    — Project UUID
 *   MUSHI_API_ENDPOINT  — Backend edge-function URL
 */
export function loadConfig(path = CONFIG_PATH): CliConfig {
  let file: CliConfig = {}
  if (existsSync(path)) {
    tightenPermissions(path)
    try {
      file = JSON.parse(readFileSync(path, 'utf-8')) as CliConfig
    } catch {
      // malformed rc — fall back to env vars
    }
  } else if (path === CONFIG_PATH && existsSync(LEGACY_CONFIG_PATH)) {
    // First load after upgrading from CLI < 0.9: the user has a
    // ~/.mushirc but no XDG file. Migrate by moving (not copying) so
    // we never have two stale credential files on disk.
    file = migrateLegacyConfig() ?? {}
  }
  // Env vars overlay the file: a set env var always wins.
  const fromEnv: CliConfig = {
    ...(process.env['MUSHI_API_KEY'] ? { apiKey: process.env['MUSHI_API_KEY'] } : {}),
    ...(process.env['MUSHI_PROJECT_ID'] ? { projectId: process.env['MUSHI_PROJECT_ID'] } : {}),
    ...(process.env['MUSHI_API_ENDPOINT'] ? { endpoint: process.env['MUSHI_API_ENDPOINT'] } : {}),
  }
  return { ...file, ...fromEnv }
}

export function saveConfig(config: CliConfig, path = CONFIG_PATH): void {
  // mkdir -p the parent so first-run on a clean machine succeeds.
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE })
  } else {
    tightenDirPermissions(dir)
  }
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: SECURE_FILE_MODE })
  tightenPermissions(path)
}

/**
 * Move a pre-XDG `~/.mushirc` into the canonical XDG path.
 * Returns the parsed config so the caller can use it without a
 * second read. Idempotent: if migration has already happened, does
 * nothing and returns null.
 *
 * On read failure (malformed JSON), the legacy file is left in place
 * so the user can recover it manually — we never silently drop creds.
 */
export function migrateLegacyConfig(
  legacyPath = LEGACY_CONFIG_PATH,
  destPath = CONFIG_PATH,
): CliConfig | null {
  if (!existsSync(legacyPath)) return null
  let parsed: CliConfig
  try {
    parsed = JSON.parse(readFileSync(legacyPath, 'utf-8')) as CliConfig
  } catch {
    // Malformed legacy file. Don't move it — leave it for the user to
    // inspect. Fall through with no migration.
    return null
  }
  const dir = dirname(destPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE })
  }
  // Use rename (atomic on the same filesystem) so we never have two
  // copies of the API key on disk simultaneously. If the rename fails
  // (cross-device link, permission issue), we fall back to write-and-
  // delete with the same end state.
  try {
    renameSync(legacyPath, destPath)
  } catch {
    writeFileSync(destPath, JSON.stringify(parsed, null, 2), { mode: SECURE_FILE_MODE })
    try { require('fs').unlinkSync(legacyPath) } catch { /* best-effort */ }
  }
  tightenPermissions(destPath)
  tightenDirPermissions(dir)
  return parsed
}

function tightenPermissions(path: string): void {
  if (process.platform === 'win32') return
  try {
    const current = statSync(path).mode & 0o777
    if (current !== SECURE_FILE_MODE) chmodSync(path, SECURE_FILE_MODE)
  } catch {
    // best-effort — a failed chmod should not break the CLI
  }
}

function tightenDirPermissions(path: string): void {
  if (process.platform === 'win32') return
  try {
    const current = statSync(path).mode & 0o777
    if (current !== SECURE_DIR_MODE) chmodSync(path, SECURE_DIR_MODE)
  } catch {
    // best-effort — a failed chmod should not break the CLI
  }
}
