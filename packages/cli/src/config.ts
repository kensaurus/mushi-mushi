/**
 * FILE: packages/cli/src/config.ts
 * PURPOSE: CLI configuration read/write — manages ~/.mushirc credentials file.
 *
 * Security: the file is written with 0o600 (owner read/write only) so other
 * local users on a shared box cannot read the API key. On load, if an existing
 * config was written before this change (0o644), we proactively chmod it down.
 */

import { chmodSync, readFileSync, statSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface CliConfig {
  apiKey?: string
  endpoint?: string
  projectId?: string
}

export const CONFIG_PATH = join(homedir(), '.mushirc')

const SECURE_FILE_MODE = 0o600

/**
 * Load CLI config from ~/.mushirc, then overlay env vars so operators
 * can configure the CLI via environment without writing a config file.
 * Env var precedence: env vars WIN over the saved file (so CI can pin
 * a different project without touching the dev's ~/.mushirc).
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
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: SECURE_FILE_MODE })
  tightenPermissions(path)
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
