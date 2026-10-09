// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: reporter-channels.ts
 * PURPOSE: Typed calls for the reporter loop v2 routes (Plan 018 §4, §6.2):
 *          the badge / toast feed, mark-read, the report timeline, and the
 *          reporter's own email / push opt-in.
 *
 * USAGE:
 *   import { reporterChannels } from '@mushi-mushi/core/reporter-channels'
 *   const rc = reporterChannels(apiClient)
 *   const res = await rc.getUpdates(reporterToken)
 *
 * Shipped as a subpath so the main `@mushi-mushi/core` entry stays inside
 * its size budget. Every call goes through `apiClient.reporterRequest`, which
 * signs the reporter digest headers, times out, retries once and never
 * rejects: failures resolve as `{ ok: false }`.
 *
 * Email and push are opt-in. The server refuses a channel the project has
 * not turned on, or cannot send (`EMAIL_NOT_AVAILABLE` / `PUSH_NOT_AVAILABLE`
 * with `reason: 'not_configured' | 'project_disabled'`), so never show an
 * opt-in control unless `GET /v1/sdk/config` → `reporter.emailEnabled` /
 * `reporter.pushEnabled` is true.
 */

import type { MushiApiClient, MushiApiResponse } from './types';

/** `GET /v1/reporter/updates` — the unread badge and the next-visit toast. */
export interface MushiReporterUpdates {
  unread_total: number;
  /** Up to 3 newest unread events, `report_id` is always the reporter's own report. */
  latest: Array<{ report_id: string; kind: string | null; preview: string; at: string }>;
  server_time: string;
}

export type MushiReporterChannelUnavailable = 'not_configured' | 'project_disabled';

/** `GET|PUT /v1/reporter/notification-prefs`. The address is always masked. */
export interface MushiReporterNotificationPrefs {
  email: string | null;
  email_verified: boolean;
  /** An address was given; the confirmation link has not been clicked yet. */
  email_pending: boolean;
  unsubscribed: boolean;
  channels: { in_app: boolean; email: boolean; push: boolean };
  push_subscriptions: number;
  available: { email: boolean; push: boolean };
  unavailable_reason: { email: MushiReporterChannelUnavailable | null; push: MushiReporterChannelUnavailable | null };
  /** PUT only: a confirmation email went out. */
  verification_sent?: boolean;
}

/** `email`: a new address starts double opt-in; `null` forgets the address. */
export interface MushiReporterPrefsUpdate {
  email?: string | null;
  channels?: { email?: boolean; push?: boolean };
}

/** `PushSubscription.toJSON()` shape. */
export interface MushiPushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** One entry of `GET /v1/reporter/reports/:id` → `timeline`. */
export interface MushiReporterTimelineItem {
  kind: string;
  at: string;
  /** English text; pipeline kinds can be re-rendered per locale unless `custom`. */
  text: string;
  /** Developer- or project-written text: show `text` as is. */
  custom?: boolean;
  body?: string;
  version?: string;
  closed_reason?: string;
  comment_id?: number | string;
}

export interface MushiReporterReportDetail {
  report: Record<string, unknown> & { id: string; status: string };
  timeline: MushiReporterTimelineItem[];
  can_verify: boolean;
}

export interface MushiReporterChannels {
  getUpdates(reporterToken: string, since?: string): Promise<MushiApiResponse<MushiReporterUpdates>>;
  getReport(reportId: string, reporterToken: string): Promise<MushiApiResponse<MushiReporterReportDetail>>;
  /** Mark one report's updates read; resolves the new unread total. */
  markReportRead(reportId: string, reporterToken: string): Promise<MushiApiResponse<{ marked_read: number; unread_total: number | null }>>;
  markAllRead(reporterToken: string): Promise<MushiApiResponse<{ marked_read: number; unread_total: number }>>;
  getPrefs(reporterToken: string): Promise<MushiApiResponse<MushiReporterNotificationPrefs>>;
  setPrefs(reporterToken: string, update: MushiReporterPrefsUpdate): Promise<MushiApiResponse<MushiReporterNotificationPrefs>>;
  subscribePush(reporterToken: string, subscription: MushiPushSubscriptionJSON): Promise<MushiApiResponse<{ subscribed: boolean }>>;
  unsubscribePush(reporterToken: string, endpoint: string): Promise<MushiApiResponse<{ removed: number }>>;
}

export function reporterChannels(client: Pick<MushiApiClient, 'reporterRequest'>): MushiReporterChannels {
  const r = client.reporterRequest;
  const id = (reportId: string) => encodeURIComponent(reportId);
  return {
    getUpdates: (token, since) =>
      r('GET', `/v1/reporter/updates${since ? `?since=${encodeURIComponent(since)}` : ''}`, token),
    getReport: (reportId, token) => r('GET', `/v1/reporter/reports/${id(reportId)}`, token),
    markReportRead: (reportId, token) => r('POST', `/v1/reporter/reports/${id(reportId)}/read`, token, {}),
    markAllRead: (token) => r('POST', '/v1/reporter/notifications/read-all', token, {}),
    getPrefs: (token) => r('GET', '/v1/reporter/notification-prefs', token),
    setPrefs: (token, update) => r('PUT', '/v1/reporter/notification-prefs', token, update),
    subscribePush: (token, subscription) => r('POST', '/v1/reporter/push-subscriptions', token, subscription),
    unsubscribePush: (token, endpoint) => r('DELETE', '/v1/reporter/push-subscriptions', token, { endpoint }),
  };
}

/**
 * Browser push for a reporter: permission prompt, service worker, push
 * subscription, then `subscribePush`. Call it from a click ("Notify me"):
 * browsers only show the permission prompt after a user action. Never throws.
 *
 * `serviceWorkerPath` is a worker on the host app's own origin that shows
 * the push payload (`{ title, body, tag, url? }`); `vapidPublicKey` comes
 * from `GET /v1/sdk/config` → `reporter.vapidPublicKey` (null = not offered).
 */
export async function subscribeBrowserPush(
  channels: Pick<MushiReporterChannels, 'subscribePush'>,
  reporterToken: string,
  serviceWorkerPath: string | null | undefined,
  vapidPublicKey: string | null | undefined,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    if (!serviceWorkerPath || typeof Notification === 'undefined' || !navigator.serviceWorker) {
      return { ok: false, reason: 'unsupported' };
    }
    if (!vapidPublicKey) return { ok: false, reason: 'not_available' };
    if ((await Notification.requestPermission()) !== 'granted') return { ok: false, reason: 'denied' };
    const reg = await navigator.serviceWorker.register(serviceWorkerPath);
    const b64 = vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(raw, (ch) => ch.charCodeAt(0)),
    });
    const res = await channels.subscribePush(reporterToken, sub.toJSON() as MushiPushSubscriptionJSON);
    return res.ok ? { ok: true } : { ok: false, reason: res.error?.code ?? 'error' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.name || 'error' : 'error' };
  }
}
