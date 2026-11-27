// SPDX-License-Identifier: MIT
/**
 * App presets for `mushi-ux fresh-eyes` (ADR 0073): what one app's first-time
 * path needs beyond its start page and goal. Product code knows no app; the
 * person who runs tests keeps their apps' presets in one file on their machine,
 * which a local worker's runs read too (same user, same file):
 *
 *   <config>/mushi/fresh-eyes-presets.json   (config = %LOCALAPPDATA% on Windows,
 *                                            else $XDG_CONFIG_HOME or ~/.config)
 *   [
 *     {
 *       "match": "https://example.com/app",          start page origin + path prefix
 *       "appHosts": ["abcd.supabase.co"],             hosts its sign-in writes to
 *       "successUrl": "/app/dashboard/*",             optional goal checks
 *       "successText": "Your first report",
 *       "terminal": true                              its setup has a CLI step
 *     }
 *   ]
 *
 * `MUSHI_FRESH_EYES_PRESETS_FILE` points elsewhere. A missing file means no
 * presets; a malformed one is an error, so a typo never silently drops a check.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FreshEyesAppPreset } from './fresh-eyes.js'

const HOST_RE = /^[a-z0-9.-]{1,253}$/i

/** Where the presets file lives. */
export function presetsFile(env: NodeJS.ProcessEnv = process.env): string {
  const given = env.MUSHI_FRESH_EYES_PRESETS_FILE?.trim()
  if (given) return given
  const base = env.LOCALAPPDATA ?? env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
  return join(base, 'mushi', 'fresh-eyes-presets.json')
}

/** Pure: the presets in a file's text; throws with the entry and the reason on a malformed one. */
export function parsePresets(text: string): FreshEyesAppPreset[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('The fresh-eyes presets file is not JSON.')
  }
  if (!Array.isArray(raw)) throw new Error('The fresh-eyes presets file must be a JSON array.')
  return raw.map((e, i) => {
    const p = (e ?? {}) as Record<string, unknown>
    const bad = (why: string) => new Error(`Fresh-eyes preset ${i + 1}: ${why}`)
    let match: URL
    try {
      match = new URL(String(p.match))
    } catch {
      throw bad('"match" must be an http(s) address.')
    }
    if (match.protocol !== 'https:' && match.protocol !== 'http:') throw bad('"match" must be an http(s) address.')
    const appHosts = p.appHosts === undefined ? [] : p.appHosts
    if (!Array.isArray(appHosts) || appHosts.some((h) => typeof h !== 'string' || !HOST_RE.test(h))) throw bad('"appHosts" must be a list of host names.')
    for (const k of ['successUrl', 'successText'] as const) {
      if (p[k] !== undefined && (typeof p[k] !== 'string' || !(p[k] as string).trim() || (p[k] as string).length > 300)) throw bad(`"${k}" must be text up to 300 characters.`)
    }
    if (p.terminal !== undefined && typeof p.terminal !== 'boolean') throw bad('"terminal" must be true or false.')
    return {
      match: `${match.origin}${match.pathname}`,
      appHosts: appHosts as string[],
      success: { ...(p.successUrl ? { url: p.successUrl as string } : {}), ...(p.successText ? { text: p.successText as string } : {}) },
      terminal: p.terminal === true,
    }
  })
}

/** The machine's presets: none when the file does not exist. */
export function loadPresets(env: NodeJS.ProcessEnv = process.env): FreshEyesAppPreset[] {
  const file = presetsFile(env)
  return existsSync(file) ? parsePresets(readFileSync(file, 'utf8')) : []
}
