import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MushiConfig, MushiReporterReport } from '@mushi-mushi/core';
import { Mushi } from './mushi';
import { deviceHasReports, markDeviceHasReports, pickUpdateToast, recordToastShown, toastAllowed } from './reporter-inbox';

const PID = '00000000-0000-0000-0000-0000000000aa';
const row = (r: Partial<MushiReporterReport>): MushiReporterReport =>
  ({ id: 'r1', status: 'classified', created_at: '2026-10-01T00:00:00Z', ...r }) as MushiReporterReport;

describe('reporter inbox device rules', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('remembers that this device filed a report', () => {
    expect(deviceHasReports(PID)).toBe(false);
    markDeviceHasReports(PID);
    expect(deviceHasReports(PID)).toBe(true);
    expect(deviceHasReports('other-project')).toBe(false);
  });

  it('allows one toast per session and one per 24 hours', () => {
    const now = Date.UTC(2026, 9, 2, 12);
    expect(toastAllowed(PID, now)).toBe(true);
    recordToastShown(PID, now);
    expect(toastAllowed(PID, now + 1000)).toBe(false);
    // A new session the same day: still blocked by the 24 h cap.
    sessionStorage.clear();
    expect(toastAllowed(PID, now + 60 * 60 * 1000)).toBe(false);
    expect(toastAllowed(PID, now + 25 * 60 * 60 * 1000)).toBe(true);
  });

  it('never throws when storage is blocked', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => markDeviceHasReports(PID)).not.toThrow();
    expect(deviceHasReports(PID)).toBe(false);
    expect(toastAllowed(PID)).toBe(true);
    spy.mockRestore();
    set.mockRestore();
  });

  it('picks the toast text from what changed', () => {
    const replied = 'The developer replied to your report';
    expect(pickUpdateToast([row({ unread_count: 0 })], 'en', replied)).toBeNull();
    expect(pickUpdateToast([row({ unread_count: 1, last_admin_reply_at: '2026-10-02T00:00:00Z' })], 'en', replied))
      .toEqual({ text: replied, reportId: 'r1' });
    expect(pickUpdateToast([row({ status: 'resolved', fixed_in_version: '1.4', unread_count: 1 })], 'en', replied))
      .toEqual({ text: 'Fixed in v1.4', reportId: 'r1' });
    expect(pickUpdateToast([row({ awaiting_reporter: true, unread_count: 1 })], 'ja', replied)!.text).toBe('あなたの返信待ち');
    expect(pickUpdateToast([row({ unread_count: 2 }), row({ id: 'r2', unread_count: 1 })], 'en', replied))
      .toEqual({ text: '3 updates on your reports', reportId: null });
    // A report hidden from the reporter (spam) never produces a toast.
    expect(pickUpdateToast([row({ status: 'dismissed', closed_reason: 'spam', unread_count: 1 })], 'en', replied)).toBeNull();
  });
});

describe('Mushi.init — reporter polling (Plan 018 §4.4)', () => {
  const CONFIG: MushiConfig = { projectId: PID, apiKey: 'mushi_test_key_abcdefghijklmnop', runtimeConfig: false };
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const reporterCalls = () =>
    fetchSpy.mock.calls.filter(([url]) => String(url instanceof Request ? url.url : url).includes('/v1/reporter/reports')).length;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ ok: true, data: { reports: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  });
  afterEach(() => {
    try { Mushi.destroy(); } catch { /* no instance */ }
    vi.restoreAllMocks();
  });

  it('never asks for reports from a device that has not filed one', async () => {
    Mushi.init(CONFIG);
    await new Promise((r) => setTimeout(r, 50));
    expect(reporterCalls()).toBe(0);
  });

  it('checks for updates on a device that has reports', async () => {
    markDeviceHasReports(PID);
    Mushi.init(CONFIG);
    await vi.waitFor(() => expect(reporterCalls()).toBeGreaterThan(0));
  });
});
