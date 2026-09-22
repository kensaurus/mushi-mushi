/**
 * FILE: packages/core/src/analytics-taxonomy.test.ts
 * PURPOSE: Pin the page-view vocabulary. Before 2026-09-22 the SDK's
 *          autoPageviews emitted `pageview`, a name outside MUSHI_EVENTS, and
 *          the docs site tracked only three routes, so visits undercounted
 *          every other docs page.
 */
import { describe, expect, it } from 'vitest';
import { MUSHI_EVENTS, isValidEventName } from './analytics-taxonomy';

describe('page-view events', () => {
  it('page_view is a taxonomy event for every surface that auto-tracks pages', () => {
    expect(isValidEventName('page_view')).toBe(true);
    expect(MUSHI_EVENTS.page_view.surface).toEqual(['web', 'docs', 'console']);
    expect(MUSHI_EVENTS.page_view.required).toEqual([]);
  });

  it('docs_page_view is a docs event that requires its route', () => {
    expect(MUSHI_EVENTS.docs_page_view.surface).toBe('docs');
    expect(MUSHI_EVENTS.docs_page_view.required).toEqual(['route']);
  });

  it('the pre-rename name stays out of the taxonomy', () => {
    expect('pageview' in MUSHI_EVENTS).toBe(false);
  });
});
