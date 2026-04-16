/**
 * FILE: packages/cli/src/config.ts
 * PURPOSE: CLI configuration read/write — manages ~/.mushirc credentials file.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface CliConfig {
  apiKey?: string
  endpoint?: string
  projectId?: string
}

export const CONFIG_PATH = join(homedir(), '.mushirc')

export function loadConfig(path = CONFIG_PATH): CliConfig {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveConfig(config: CliConfig, path = CONFIG_PATH): void {
  writeFileSync(path, JSON.stringify(config, null, 2))
}
