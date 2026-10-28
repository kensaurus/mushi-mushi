/**
 * FILE: apps/admin/src/components/storage/storageVerdict.ts
 * PURPOSE: One storage verdict for the open app (console journeys
 *          2026-10-27). The page used to show "Healthy buckets 0/1 · 1
 *          failing" (every app's own buckets) beside "This project: not
 *          checked yet" (an app on the built-in storage, which has nothing to
 *          check), so the two read as a contradiction. The header chip, the
 *          status line and the readout now all read this verdict; other apps'
 *          failing buckets are a separate clause.
 */

import type { StorageStats } from './types'

type StorageAction = 'configure' | 'probe' | 'reprobe'

export interface StorageVerdict {
  tone: 'ok' | 'warn' | 'danger' | 'info'
  /** The header chip: this app's state in two or three words. */
  chip: string
  sentence: string
  action: StorageAction | null
}

function others(stats: StorageStats): string {
  // failingCount counts every app's own bucket, this one's included.
  const n = stats.failingCount - (stats.activeProjectHealthStatus === 'failing' ? 1 : 0)
  return n > 0 ? ` ${n} other app${n === 1 ? "'s" : "s'"} own bucket${n === 1 ? ' is' : 's are'} failing.` : ''
}

export function storageVerdict(stats: StorageStats): StorageVerdict {
  const app = stats.projectName ?? 'This app'
  if (!stats.projectId) {
    return { tone: 'warn', chip: 'No app picked', sentence: 'Pick an app in the header to see where its screenshots are stored.', action: null }
  }
  if (!stats.activeProjectConfigured) {
    return {
      tone: 'ok',
      chip: 'Built-in storage',
      sentence: `${app} stores screenshots in Mushi's built-in storage. There's nothing to check.${others(stats)}`,
      action: 'configure',
    }
  }
  const provider = stats.activeProjectProvider
  switch (stats.activeProjectHealthStatus) {
    case 'failing':
      return {
        tone: 'danger',
        chip: 'Failing',
        sentence: `${app}'s ${provider} bucket failed its last check, so screenshots may not be saved.${others(stats)}`,
        action: 'reprobe',
      }
    case 'degraded':
      return {
        tone: 'warn',
        chip: 'Having trouble',
        sentence: `${app}'s ${provider} bucket saved screenshots, but recent checks reported errors.${others(stats)}`,
        action: 'reprobe',
      }
    case 'healthy':
      return { tone: 'ok', chip: 'Working', sentence: `${app}'s ${provider} bucket is working.${others(stats)}`, action: null }
    default:
      return {
        tone: 'info',
        chip: 'Not checked yet',
        sentence: `${app}'s ${provider} bucket is saved but hasn't been checked. Check it before real screenshots go there.${others(stats)}`,
        action: 'probe',
      }
  }
}
