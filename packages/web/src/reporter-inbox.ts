/**
 * FILE: packages/web/src/reporter-inbox.ts
 * PURPOSE: Device-side rules for the reporter inbox (Plan 018 §4.2, §4.4):
 *          never poll from a device that never filed a report, show at most
 *          one update toast per session and per 24 hours. (The toast text
 *          itself is picked in widget-views.ts, loaded on demand.)
 *
 * All storage access is guarded: private mode, blocked storage or a quota
 * error must never break the host page, so a failure reads as "no flag".
 */

const DAY_MS = 24 * 60 * 60 * 1000;


function read(store: 'localStorage' | 'sessionStorage', key: string): string | null {
  try {
    return globalThis[store]?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: 'localStorage' | 'sessionStorage', key: string, value: string): void {
  try {
    globalThis[store]?.setItem(key, value);
  } catch {
    // Storage unavailable: the rule degrades to "ask again next time".
  }
}

/** Set on the first successful submit (or when the list shows a report). */
export function markDeviceHasReports(projectId: string): void {
  write('localStorage', `mushi_has_reports_${projectId}`, '1');
}

export function deviceHasReports(projectId: string): boolean {
  return read('localStorage', `mushi_has_reports_${projectId}`) === '1';
}

/** At most one toast per session and one per 24 hours. */
export function toastAllowed(projectId: string, now = Date.now()): boolean {
  if (read('sessionStorage', `mushi_toast_${projectId}`)) return false;
  const last = Number(read('localStorage', `mushi_toast_at_${projectId}`) ?? 0);
  return !(last && now - last < DAY_MS);
}

export function recordToastShown(projectId: string, now = Date.now()): void {
  write('sessionStorage', `mushi_toast_${projectId}`, '1');
  write('localStorage', `mushi_toast_at_${projectId}`, String(now));
}
