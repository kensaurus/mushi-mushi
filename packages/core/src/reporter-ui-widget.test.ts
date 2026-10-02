/**
 * Plan 018 widget rules shared by web and React Native: free text first with
 * optional chips, a few words (or an attachment) to send, timeline text from
 * the shared templates, and the once-a-day next-visit toast.
 */
import { describe, it, expect } from 'vitest';
import {
  REPORTER_MIN_DESCRIPTION,
  REPORTER_TOAST_INTERVAL_MS,
  isPlausibleReporterEmail,
  isReporterConversation,
  reporterCanSend,
  reporterChipToReport,
  reporterRequiredLength,
  reporterShouldShowToast,
  reporterTimelineEntryText,
  reporterToastMessage,
} from './reporter-ui';

describe('sending a report', () => {
  it('needs 8 characters by default, none with an attachment', () => {
    expect(REPORTER_MIN_DESCRIPTION).toBe(8);
    expect(reporterCanSend('too short', false)).toBe(true);
    expect(reporterCanSend('short', false)).toBe(false);
    expect(reporterCanSend('   ', false)).toBe(false);
    expect(reporterCanSend('', true)).toBe(true);
    expect(reporterCanSend('x', false, 0)).toBe(true);
    expect(reporterCanSend('twenty characters!!', false, 20)).toBe(false);
    expect(reporterRequiredLength(-3, false)).toBe(8);
  });

  it('chips are optional; Idea files a feature request', () => {
    expect(reporterChipToReport(null)).toEqual({ category: 'other' });
    expect(reporterChipToReport('bug')).toEqual({ category: 'bug' });
    expect(reporterChipToReport('idea')).toEqual({ category: 'other', userCategory: 'feature' });
  });
});

describe('timeline entries', () => {
  it('render pipeline events from the templates in the reporter locale', () => {
    expect(reporterTimelineEntryText({ kind: 'released', text: 'x', version: '1.4' }, 'en')).toBe(
      'Shipped in v1.4 — update to get it',
    );
    expect(reporterTimelineEntryText({ kind: 'fixed', text: 'ignored' }, 'ja')).not.toBe('ignored');
    expect(reporterTimelineEntryText({ kind: 'closed', text: '', closed_reason: 'not_reproducible' })).toMatch(
      /couldn't reproduce/,
    );
  });

  it('show developer / project wording as is', () => {
    expect(reporterTimelineEntryText({ kind: 'fixed', text: 'Fixed for Acme users!', custom: true }, 'ja')).toBe(
      'Fixed for Acme users!',
    );
    expect(reporterTimelineEntryText({ kind: 'comment', text: 'Which page?', body: 'Which page?' })).toBe('Which page?');
  });

  it('separate conversation from pipeline events', () => {
    expect(isReporterConversation({ kind: 'comment' })).toBe(true);
    expect(isReporterConversation({ kind: 'reporter_comment' })).toBe(true);
    expect(isReporterConversation({ kind: 'info_requested' })).toBe(true);
    expect(isReporterConversation({ kind: 'released' })).toBe(false);
  });
});

describe('next-visit toast', () => {
  const now = 1_800_000_000_000;
  const base = { enabled: true, unreadTotal: 1, shownThisSession: false, lastShownAt: null, now };

  it('shows once per session and at most once a day, only with something unread', () => {
    expect(reporterShouldShowToast(base)).toBe(true);
    expect(reporterShouldShowToast({ ...base, shownThisSession: true })).toBe(false);
    expect(reporterShouldShowToast({ ...base, unreadTotal: 0 })).toBe(false);
    expect(reporterShouldShowToast({ ...base, enabled: false })).toBe(false);
    expect(reporterShouldShowToast({ ...base, lastShownAt: now - REPORTER_TOAST_INTERVAL_MS + 1 })).toBe(false);
    expect(reporterShouldShowToast({ ...base, lastShownAt: now - REPORTER_TOAST_INTERVAL_MS })).toBe(true);
  });

  it('says what happened, or collapses several updates', () => {
    const one = (kind: string) => ({ unread_total: 1, latest: [{ kind }] });
    expect(reporterToastMessage(one('comment'))).toBe('The developer replied to your report');
    expect(reporterToastMessage(one('released'))).toBe('Your bug is fixed');
    expect(reporterToastMessage({ unread_total: 3, latest: [{ kind: 'comment' }] })).toBe('3 updates on your reports');
    expect(reporterToastMessage(one('comment'), 'ja')).toBe('開発者があなたの報告に返信しました');
  });
});

describe('email opt-in', () => {
  it('screens obvious typos only', () => {
    expect(isPlausibleReporterEmail(' reporter@example.com ')).toBe(true);
    expect(isPlausibleReporterEmail('nope')).toBe(false);
    expect(isPlausibleReporterEmail('a@b')).toBe(false);
  });
});

describe('ideas', () => {
  it('reads every spelling of a feature request as an idea (web and ingest send "feature")', async () => {
    const { isReporterIdea, reporterStatus } = await import('./reporter-ui');
    for (const user_category of ['feature', 'Feature request', 'feature_request', 'idea', 'Feature-Request']) {
      expect(isReporterIdea({ user_category })).toBe(true);
    }
    expect(isReporterIdea({ user_category: 'bug' })).toBe(false);
    expect(reporterStatus({ status: 'new', user_category: 'feature' }).label).toBe('Thanks for the idea');
  });
});
