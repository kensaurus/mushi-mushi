// SPDX-License-Identifier: MIT
/**
 * Which browser profile a command opens. `--profile-dir` reuses a cached,
 * signed-in profile (for example one playwright-cli keeps under
 * ~/.playwright-cli-profiles/<app>), so a run never opens a fresh browser that
 * needs a new sign-in. Such a profile was made by Google Chrome, so it opens
 * with the installed Chrome unless `--channel chromium` says otherwise.
 * The path is never shown to a coding agent (ADR 0006).
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

export type BrowserChannel = 'chrome' | 'chromium'

export interface ProfileFlags {
  profileDir?: string
  channel?: string
}

/** Pure: the profile and browser build a command opens, or null for its default. */
export function cachedProfile(o: ProfileFlags, home: string = homedir()): { profileDir: string; channel: BrowserChannel } | null {
  if (!o.profileDir?.trim()) return null
  const raw = o.profileDir.trim()
  const dir = raw === '~' ? home : raw.startsWith('~/') ? resolve(home, raw.slice(2)) : resolve(raw)
  return { profileDir: dir, channel: o.channel === 'chromium' ? 'chromium' : 'chrome' }
}

/** Pure: a `--channel` value, checked. */
export function parseChannel(v: string): BrowserChannel {
  if (v !== 'chrome' && v !== 'chromium') throw new Error('--channel is chrome or chromium')
  return v
}

/**
 * `--profile-dir` help. A cached profile is one browser context, so captures
 * share its storage with each other and with discovery.
 */
export function profileDirHelp(purpose: string): string {
  return `${purpose} Captures are not isolated: they share this profile's localStorage and IndexedDB with each other and with discovery.`
}
