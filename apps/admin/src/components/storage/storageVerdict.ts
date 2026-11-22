/**
 * FILE: apps/admin/src/components/storage/storageVerdict.ts
 * PURPOSE: One storage verdict for the open app (console journeys
 *          2026-10-27). The page used to show "Healthy buckets 0/1 · 1
 *          failing" (every app's own buckets) beside "This project: not
 *          checked yet" (an app on the built-in storage, which has nothing to
 *          check), so the two read as a contradiction. The header chip, the
 *          status line and the readout now all read this verdict. Other apps'
 *          failing buckets are drawn as their own rows at the top of the page
 *          (lib/storageView.ts storageProblems), not a trailing clause
 *          (round-2 review 2026-11-18).
 */

import type { StorageStats } from './types'

type StorageAction = 'configure' | 'probe' | 'reprobe'

export interface StorageVerdict {
  /** neutral: the built-in storage is not something we check, so it gets no green. */
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral'
  /** The header chip: this app's state in two or three words. */
  chip: string
  sentence: string
  action: StorageAction | null
}

export function storageVerdict(stats: StorageStats): StorageVerdict {
  const app = stats.projectName ?? 'This app'
  if (!stats.projectId) {
    return { tone: 'warn', chip: 'No app picked', sentence: 'Pick an app in the header to see where its screenshots are stored.', action: null }
  }
  if (!stats.activeProjectConfigured) {
    return {
      tone: 'neutral',
      chip: 'Built-in storage',
      sentence: `${app} stores screenshots in Mushi Mushi's built-in storage.`,
      action: 'configure',
    }
  }
  const provider = stats.activeProjectProvider
  switch (stats.activeProjectHealthStatus) {
    case 'failing':
      return {
        tone: 'danger',
        chip: 'Failing',
        sentence: `${app}'s ${provider} bucket failed its last check, so screenshots may not be saved.`,
        action: 'reprobe',
      }
    case 'degraded':
      return {
        tone: 'warn',
        chip: 'Having trouble',
        sentence: `${app}'s ${provider} bucket saved screenshots, but recent checks reported errors.`,
        action: 'reprobe',
      }
    case 'healthy':
      return { tone: 'ok', chip: 'Working', sentence: `${app}'s ${provider} bucket is working.`, action: null }
    default:
      return {
        tone: 'info',
        chip: 'Not checked yet',
        sentence: `${app}'s ${provider} bucket is saved but hasn't been checked. Check it before real screenshots go there.`,
        action: 'probe',
      }
  }
}
