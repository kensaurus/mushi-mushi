/**
 * FILE: storage/reporter-flags.ts
 * PURPOSE: Two tiny per-project flags in AsyncStorage (optional peer):
 * - `has_reports`: set after the first successful report, so a device that
 *   never reported anything never checks for updates (Plan 018 §4.4).
 * - `toast_shown_at`: the next-visit toast shows at most once a day (§4.2).
 * Without AsyncStorage every read is null and every write a no-op.
 */

export type ReporterFlag = 'has_reports' | 'toast_shown_at'

export async function readReporterFlag(projectId: string, flag: ReporterFlag): Promise<string | null> {
  try {
    const store = (await import('@react-native-async-storage/async-storage')).default
    return await store.getItem(`@mushi:${flag}:${projectId}`)
  } catch {
    return null
  }
}

export async function writeReporterFlag(projectId: string, flag: ReporterFlag, value: string): Promise<void> {
  try {
    const store = (await import('@react-native-async-storage/async-storage')).default
    await store.setItem(`@mushi:${flag}:${projectId}`, value)
  } catch {
    /* best effort */
  }
}
