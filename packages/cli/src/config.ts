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

import { randomUUID } from 'crypto'
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { tryLoadKeyFromKeychain } from './keychain.js'

export interface CliConfig {
  apiKey?: string
  endpoint?: string
  projectId?: string
  /** URL of the Mushi admin console (e.g. http://localhost:6464 for local dev). */
  consoleUrl?: string
  /**
   * Random per-machine identifier sent with device-auth /start so the server
   * can supersede this machine's earlier pending sign-in requests (a stale
   * approval tab must not be approvable while the terminal polls a new code).
   * Not a secret — it only groups requests from the same machine.
   */
  clientId?: string
  /**
   * True once the one-time telemetry-transparency notice has been shown.
   * Persisted so the notice only appears on first run.
   */
  telemetryNoticeShown?: boolean
}

/**
 * Multi-profile config file (v2). Introduced so a single machine can hold
 * credentials for several environments (`default`, `staging`, a client's org)
 * and switch with `--profile <name>` / `MUSHI_PROFILE` / `mushi profile use`.
 *
 * Backwards compatible: a legacy flat `CliConfig` file (no `profiles` key) is
 * transparently read as the `default` profile, and is only rewritten into this
 * shape the first time a profile-scoped save happens — so existing single-
 * profile users never see their file change.
 */
export interface MultiProfileConfigFile {
  version: 2
  /** Which profile is used when no `--profile` / `MUSHI_PROFILE` is given. */
  activeProfile: string
  profiles: Record<string, CliConfig>
}

/** The default profile name used when none is specified. */
export const DEFAULT_PROFILE = 'default'

/** Type guard: is this parsed file the v2 multi-profile shape? */
function isMultiProfileFile(value: unknown): value is MultiProfileConfigFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'profiles' in value &&
    typeof (value as { profiles: unknown }).profiles === 'object' &&
    (value as { profiles: unknown }).profiles !== null
  )
}

/**
 * Resolve which profile name to use. Precedence (highest first):
 *   1. explicit argument (from the `--profile` flag)
 *   2. `MUSHI_PROFILE` env var
 *   3. the file's persisted `activeProfile`
 *   4. `DEFAULT_PROFILE`
 */
export function resolveProfileName(explicit?: string, fileActive?: string): string {
  const fromEnv = process.env['MUSHI_PROFILE']?.trim()
  return explicit?.trim() || fromEnv || fileActive || DEFAULT_PROFILE
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
 *   MUSHI_ENDPOINT      — Alias for MUSHI_API_ENDPOINT (connect scripts)
 */
export function loadConfig(path = CONFIG_PATH, opts: { profile?: string } = {}): CliConfig {
  let file: CliConfig = {}
  if (existsSync(path)) {
    tightenPermissions(path)
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      if (isMultiProfileFile(parsed)) {
        // v2 multi-profile file — pick the requested/active profile.
        const name = resolveProfileName(opts.profile, parsed.activeProfile)
        file = parsed.profiles[name] ?? {}
      } else {
        // Legacy flat file — the whole object IS the default profile.
        file = (parsed ?? {}) as CliConfig
      }
    } catch {
      // malformed rc — fall back to env vars
    }
  } else if (path === CONFIG_PATH && existsSync(LEGACY_CONFIG_PATH)) {
    // First load after upgrading from CLI < 0.9: the user has a
    // ~/.mushirc but no XDG file. Migrate by moving (not copying) so
    // we never have two stale credential files on disk.
    file = migrateLegacyConfig() ?? {}
  }
  // OS keychain overlay: if the keychain has a key for this profile, prefer it
  // over the file value (belt-and-suspenders: both stores are written on save,
  // but the keychain is used first on read so the raw key isn't read from disk
  // unless the keychain is unavailable). Env var still wins over both.
  const profile = resolveProfileName(opts.profile, undefined)
  const keychainKey = tryLoadKeyFromKeychain(profile)
  if (keychainKey) {
    file = { ...file, apiKey: keychainKey }
  }

  // Env vars overlay the file: a set env var always wins.
  const endpointFromEnv =
    process.env['MUSHI_API_ENDPOINT'] ?? process.env['MUSHI_ENDPOINT'] ?? undefined
  const fromEnv: CliConfig = {
    ...(process.env['MUSHI_API_KEY'] ? { apiKey: process.env['MUSHI_API_KEY'] } : {}),
    ...(process.env['MUSHI_PROJECT_ID'] ? { projectId: process.env['MUSHI_PROJECT_ID'] } : {}),
    ...(endpointFromEnv ? { endpoint: endpointFromEnv } : {}),
    ...(process.env['MUSHI_CONSOLE_URL']
      ? { consoleUrl: process.env['MUSHI_CONSOLE_URL'].trim() }
      : {}),
  }
  return { ...file, ...fromEnv }
}

/**
 * Return the persistent per-machine client id, minting and saving one on
 * first use. Best-effort: if the config file cannot be written (read-only
 * home, sandbox), a fresh id is still returned so device-auth works — it
 * just won't supersede across runs.
 */
export function ensureClientId(path = CONFIG_PATH): string {
  const existing = loadConfig(path)
  if (existing.clientId && /^[A-Za-z0-9_-]{8,64}$/.test(existing.clientId)) {
    return existing.clientId
  }
  const clientId = `cli_${randomUUID().replace(/-/g, '')}`
  try {
    saveConfig({ ...existing, clientId }, path)
  } catch {
    // best-effort — a non-persisted id still works for this run
  }
  return clientId
}

/**
 * Show a one-time telemetry notice on first CLI run and persist that it
 * was shown. Subsequent runs skip it entirely.
 *
 * Matches the production CLI pattern (Supabase, sentry-cli, gh) where
 * the user sees a clear opt-out path on first use rather than a buried
 * env-var note in the README.
 */
export function maybeShowTelemetryNotice(config: CliConfig, path = CONFIG_PATH): void {
  if (config.telemetryNoticeShown) return
  if (process.env.MUSHI_NO_TELEMETRY) {
    // Opted out via env before first run — still mark as shown to avoid noise
    saveConfig({ ...config, telemetryNoticeShown: true }, path)
    return
  }

  console.log('')
  console.log('  📊 Mushi collects minimal anonymous usage data to improve the CLI')
  console.log('  (funnel step + error category — never your code or bug content).')
  console.log('  To opt out: export MUSHI_NO_TELEMETRY=1')
  console.log('')

  saveConfig({ ...config, telemetryNoticeShown: true }, path)
}

export function saveConfig(config: CliConfig, path = CONFIG_PATH, opts: { profile?: string } = {}): void {
  // mkdir -p the parent so first-run on a clean machine succeeds.
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE })
  } else {
    tightenDirPermissions(dir)
  }

  // Read the existing file to decide the on-disk shape. We only write the v2
  // multi-profile format when the caller targets a profile OR the file is
  // already v2 — so single-profile users keep the flat format forever.
  // Try-catch without a prior existsSync avoids a TOCTOU race: we always
  // overwrite on the write path; the read is purely informational.
  let existing: unknown = null
  try {
    existing = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    existing = null
  }

  const wantsProfile =
    opts.profile !== undefined ||
    process.env['MUSHI_PROFILE'] !== undefined ||
    isMultiProfileFile(existing)

  if (!wantsProfile) {
    // Legacy flat write — unchanged behaviour for the common single-profile case.
    writeFileSync(path, JSON.stringify(config, null, 2), { mode: SECURE_FILE_MODE })
    tightenPermissions(path)
    return
  }

  // Build/patch the v2 structure, preserving every other profile.
  const file: MultiProfileConfigFile = isMultiProfileFile(existing)
    ? { version: 2, activeProfile: existing.activeProfile || DEFAULT_PROFILE, profiles: { ...existing.profiles } }
    : {
        version: 2,
        activeProfile: DEFAULT_PROFILE,
        // A pre-existing flat file becomes the default profile.
        profiles: { [DEFAULT_PROFILE]: (existing as CliConfig) ?? {} },
      }

  const target = resolveProfileName(opts.profile, file.activeProfile)
  file.profiles[target] = config
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: SECURE_FILE_MODE })
  tightenPermissions(path)
}

/**
 * List profile names in the config file and the active one. Returns a single
 * synthetic `default` for a legacy flat file (or an empty file).
 */
export function listProfiles(path = CONFIG_PATH): { active: string; profiles: string[] } {
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
      if (isMultiProfileFile(parsed)) {
        const names = Object.keys(parsed.profiles)
        return {
          active: resolveProfileName(undefined, parsed.activeProfile),
          profiles: names.length > 0 ? names : [DEFAULT_PROFILE],
        }
      }
    } catch {
      // fall through to default
    }
  }
  return { active: resolveProfileName(), profiles: [DEFAULT_PROFILE] }
}

/**
 * Set the persisted `activeProfile`. Creates an empty profile if it doesn't
 * exist yet (so `mushi profile use staging && mushi login` works). Upgrades a
 * flat file to v2 in the process.
 */
export function setActiveProfile(name: string, path = CONFIG_PATH): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: SECURE_DIR_MODE })

  // Try-catch without existsSync avoids a TOCTOU race on the write below.
  let existing: unknown = null
  try {
    existing = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    existing = null
  }

  const file: MultiProfileConfigFile = isMultiProfileFile(existing)
    ? { version: 2, activeProfile: name, profiles: { ...existing.profiles } }
    : {
        version: 2,
        activeProfile: name,
        profiles: { [DEFAULT_PROFILE]: (existing as CliConfig) ?? {} },
      }
  if (!file.profiles[name]) file.profiles[name] = {}
  writeFileSync(path, JSON.stringify(file, null, 2), { mode: SECURE_FILE_MODE })
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
    try { unlinkSync(legacyPath) } catch { /* best-effort */ }
  }
  tightenPermissions(destPath)
  tightenDirPermissions(dir)
  return parsed
}

function tightenPermissions(path: string): void {
  if (process.platform === 'win32') {
    // chmod is a no-op on Windows. Use icacls to grant only the current user
    // (and SYSTEM for kernel access) and remove inherited permissive ACLs.
    // This is the Windows equivalent of 0o600 for a credential file.
    tightenWindowsAcl(path, 'file')
    return
  }
  try {
    const current = statSync(path).mode & 0o777
    if (current !== SECURE_FILE_MODE) chmodSync(path, SECURE_FILE_MODE)
  } catch {
    // best-effort — a failed chmod should not break the CLI
  }
}

function tightenDirPermissions(path: string): void {
  if (process.platform === 'win32') {
    tightenWindowsAcl(path, 'dir')
    return
  }
  try {
    const current = statSync(path).mode & 0o777
    if (current !== SECURE_DIR_MODE) chmodSync(path, SECURE_DIR_MODE)
  } catch {
    // best-effort — a failed chmod should not break the CLI
  }
}

/**
 * On Windows, apply restrictive ACLs to the config file or directory.
 *
 * Equivalent of chmod 0600/0700:
 *  /inheritance:r  — remove inherited ACEs (disables default permissive ACLs)
 *  /grant:r        — replace any existing grant for this user with F (Full Control)
 *  SYSTEM:F        — kernel/system access needed for file integrity checks
 *
 * This is best-effort; failure is logged but never throws so the CLI keeps
 * working even on locked-down enterprise environments that restrict icacls.
 */
// Cache the whoami result so repeated `saveConfig` calls in the same process
// (e.g. profile writes during tests or `mushi login → set active profile`)
// only shell out once instead of once-per-write.
let _cachedWindowsUser: string | null | undefined = undefined

// Track paths that have already had ACLs tightened this process so we don't
// re-run icacls on every subsequent save to the same file. ACLs don't drift
// between saves within a process lifetime.
const _aclTightened = new Set<string>()

function getWindowsUser(): string | null {
  if (_cachedWindowsUser !== undefined) return _cachedWindowsUser
  try {
    const result = spawnSync('whoami', [], { encoding: 'utf8', timeout: 500 })
    _cachedWindowsUser = result.stdout?.trim() || null
  } catch {
    _cachedWindowsUser = null
  }
  return _cachedWindowsUser
}

function tightenWindowsAcl(path: string, type: 'file' | 'dir'): void {
  // Skip if already tightened for this path in this process (e.g., repeated
  // profile saves during a single CLI invocation or test suite run).
  if (_aclTightened.has(path)) return
  try {
    const user = getWindowsUser()
    if (!user) return // can't determine user — skip

    const args = [path, '/inheritance:r', `/grant:r`, `${user}:F`, `SYSTEM:F`]
    if (type === 'dir') args.push('/T') // apply to all files in dir too
    spawnSync('icacls', args, { encoding: 'utf8', timeout: 1_000 })
    _aclTightened.add(path)
  } catch {
    // best-effort — a failed icacls should not break the CLI
  }
}
