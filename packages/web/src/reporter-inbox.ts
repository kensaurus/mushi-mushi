/**
 * FILE: packages/web/src/reporter-inbox.ts
 * PURPOSE: Device-side rules for the reporter inbox (Plan 018 §4.2, §4.4):
 *          never poll from a device that never filed a report, show at most
 *          one update toast per session and per 24 hours, and pick the toast
 *          text from what changed.
 *
 * All storage access is guarded: private mode, blocked storage or a quota
 * error must never break the host page, so a failure reads as "no flag".
 */
import type { MushiReporterReport } from '@mushi-mushi/core';
import { reporterCopy, reporterStatus, fillReporterTemplate } from '@mushi-mushi/core/reporter-ui';

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

/**
 * The toast for unread updates, or null when there are none. One report:
 * what happened to it ("Waiting on you", "Fixed in v1.4", "The developer
 * replied…"). Several: "3 updates on your reports".
 */
export function pickUpdateToast(
  reports: MushiReporterReport[],
  lang: string,
  repliedText: string,
): { text: string; reportId: string | null; detail?: string } | null {
  const unread = reports.filter((r) => (r.unread_count ?? 0) > 0 && !reporterStatus(r, lang).hidden);
  const total = unread.reduce((n, r) => n + (r.unread_count ?? 0), 0);
  if (!total) return null;
  if (unread.length > 1) return { text: fillReporterTemplate(reporterCopy(lang).ui.updates, { n: total }), reportId: null };
  const report = unread[0]!;
  const status = reporterStatus(report, lang);
  // A fix (or work on one) is the news; a question or any other update is the
  // developer talking. The report's own title says which report it is.
  const statusNews = status.key === 'fixing' || status.canVerify || (!report.last_admin_reply_at && status.key !== 'waiting');
  const detail = report.title ?? report.summary ?? undefined;
  return { text: statusNews ? status.label : repliedText, reportId: report.id, ...(detail ? { detail } : {}) };
}
