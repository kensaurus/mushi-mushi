import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  REPORTER_CANONICAL_STATUSES,
  REPORTER_LOCALES,
  REPORTER_TIMELINE_KINDS,
  REPORTER_CLOSED_REASONS,
  reporterStatus,
  reporterTimelineText,
  reporterCopy,
  resolveReporterLocale,
  type ReporterCopy,
} from './reporter-ui';

/** The server's list mirrors `reports_status_check`; core must agree with it. */
function serverCanonicalStatuses(): string[] {
  const src = readFileSync(
    resolve(__dirname, '../../server/supabase/functions/_shared/report-status.ts'),
    'utf8',
  );
  const block = src.split('CANONICAL_REPORT_STATUSES = [')[1]?.split(']')[0] ?? '';
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function flatten(copy: ReporterCopy): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(copy);
  return out;
}

describe('reporterStatus', () => {
  it('covers exactly the server status list', () => {
    expect([...REPORTER_CANONICAL_STATUSES].sort()).toEqual(serverCanonicalStatuses().sort());
    expect(REPORTER_CANONICAL_STATUSES).toHaveLength(14);
  });

  it.each(REPORTER_LOCALES)('maps every canonical status to a non-raw label (%s)', (locale) => {
    for (const status of REPORTER_CANONICAL_STATUSES) {
      const view = reporterStatus({ status }, locale);
      expect(view.label).toBeTruthy();
      expect(view.label).not.toBe(status);
      expect(view.label).not.toContain('_');
      expect(view.detail).toBeTruthy();
    }
  });

  it('never echoes an unknown status', () => {
    for (const status of ['dispatched', 'completed', '', 'weird_new_state']) {
      const view = reporterStatus({ status });
      expect(view.key).toBe('received');
      expect(view.label).toBe('Received');
    }
  });

  it('maps the base statuses per the spec table', () => {
    const label = (status: string) => reporterStatus({ status }).label;
    expect(['new', 'pending', 'submitted', 'queued'].map(label)).toEqual(Array(4).fill('Received'));
    expect(['classified', 'triaged', 'grouped'].map(label)).toEqual(Array(3).fill('Looking into it'));
    expect(label('reopened')).toBe('Looking into it again');
    expect(['fixing', 'in_progress'].map(label)).toEqual(['Fix in progress', 'Fix in progress']);
    expect(label('verified')).toBe('Confirmed fixed');
    expect(label('fixed')).toBe('Fixed — coming in the next update');
    expect(label('resolved')).toBe('Fixed');
    expect(label('dismissed')).toBe('Closed');
  });

  it('uses the version variant for fixed and resolved', () => {
    for (const status of ['fixed', 'resolved']) {
      const view = reporterStatus({ status, fixed_in_version: '1.4.0' });
      expect(view.key).toBe('fixed_version');
      expect(view.label).toBe('Fixed in v1.4.0');
      expect(view.detail).toBe('Update to v1.4.0. Does it work for you now?');
      expect(view.canVerify).toBe(true);
    }
  });

  it('only offers verification on fixed states', () => {
    for (const status of REPORTER_CANONICAL_STATUSES) {
      const view = reporterStatus({ status });
      expect(view.canVerify).toBe(['fixed', 'resolved'].includes(status));
    }
  });

  it('applies the waiting overlay to open statuses only', () => {
    expect(reporterStatus({ status: 'classified', awaiting_reporter: true }).label).toBe('Waiting on you');
    expect(reporterStatus({ status: 'fixing', awaiting_reporter_at: '2026-10-02T00:00:00Z' }).tone).toBe(
      'attention',
    );
    expect(reporterStatus({ status: 'fixed', awaiting_reporter: true }).key).toBe('fixed_next');
    expect(reporterStatus({ status: 'dismissed', awaiting_reporter: true }).key).toBe('closed');
  });

  it('adds a bucketed others note, never a number', () => {
    expect(reporterStatus({ status: 'grouped', group_bucket: 'few' }).othersNote).toBe(
      'You and a few others reported this',
    );
    expect(reporterStatus({ status: 'classified', group_bucket: 'many' }).othersNote).toBe(
      'Many people reported this',
    );
    expect(reporterStatus({ status: 'classified', group_bucket: 'none' }).othersNote).toBeNull();
    expect(reporterStatus({ status: 'fixed', group_bucket: 'many' }).othersNote).toBeNull();
  });

  it('gives every closed reason its copy and hides spam', () => {
    for (const reason of REPORTER_CLOSED_REASONS) {
      const view = reporterStatus({ status: 'dismissed', closed_reason: reason });
      expect(view.hidden).toBe(reason === 'spam');
      expect(view.detail).toBeTruthy();
    }
    expect(reporterStatus({ status: 'dismissed', closed_reason: 'duplicate' }).detail).toContain(
      "we'll update you there",
    );
    expect(reporterStatus({ status: 'dismissed' }).detail).toBe('Closed.');
  });

  it('switches to the feature-request labels', () => {
    const idea = (status: string, v?: string) =>
      reporterStatus({ status, user_category: 'Feature request', fixed_in_version: v }).label;
    expect(idea('new')).toBe('Thanks for the idea');
    expect(idea('classified')).toBe('Under consideration');
    expect(idea('fixing')).toBe('Being built');
    expect(idea('fixed')).toBe('Shipped');
    expect(idea('resolved', '2.0')).toBe('Shipped in v2.0');
  });
});

describe('reporterTimelineText', () => {
  it('renders every kind in every locale without leftover placeholders', () => {
    for (const locale of REPORTER_LOCALES) {
      for (const kind of REPORTER_TIMELINE_KINDS) {
        const text = reporterTimelineText(kind, { text: 'hi', version: '1.2' }, locale);
        expect(text).toBeTruthy();
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('passes developer text through verbatim and ignores it for pipeline kinds', () => {
    expect(reporterTimelineText('comment', { text: 'Can you send the URL?' })).toBe('Can you send the URL?');
    expect(reporterTimelineText('reviewing', { text: 'classified as bug/high' })).toBe(
      'The developer is looking into it',
    );
    expect(reporterTimelineText('released', { version: '1.4' })).toBe('Shipped in v1.4 — update to get it');
    expect(reporterTimelineText('closed', { closed_reason: 'wont_fix' })).toBe('We decided not to change this.');
  });
});

describe('copy tables', () => {
  it('has the same keys in every locale', () => {
    const keys = (c: ReporterCopy) => JSON.stringify(c, (_k, v) => (typeof v === 'string' ? '' : v));
    for (const locale of REPORTER_LOCALES) {
      expect(keys(reporterCopy(locale))).toBe(keys(reporterCopy('en')));
    }
  });

  it('never mentions severity, category, PRs or agents', () => {
    for (const locale of REPORTER_LOCALES) {
      for (const s of flatten(reporterCopy(locale))) {
        expect(s).not.toMatch(/severity|pull request|agent|critical|high\/|bug\/\w/i);
        expect(s).not.toMatch(/(^|\s)PR(\s|$)/);
      }
    }
  });

  it('resolves locale tags', () => {
    expect(resolveReporterLocale('ja-JP')).toBe('ja');
    expect(resolveReporterLocale('es_419')).toBe('es');
    expect(resolveReporterLocale('fr')).toBe('en');
    expect(resolveReporterLocale(undefined)).toBe('en');
  });
});
