/**
 * FILE: packages/core/src/analytics-taxonomy.test.ts
 * PURPOSE: Pin the page-view vocabulary. Before 2026-09-22 the SDK's
 *          autoPageviews emitted `pageview`, a name outside MUSHI_EVENTS, and
 *          the docs site tracked only three routes, so visits undercounted
 *          every other docs page.
 */
import { describe, expect, it } from 'vitest';
import { HABIT_EVENTS, MUSHI_EVENTS, isValidEventName } from './analytics-taxonomy';

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

describe('server activation events', () => {
  // emitProductEvent drops any name outside MUSHI_EVENTS with only a warn, so
  // a missing entry here silently empties the funnel step.
  it('first_diagnosis_ready is a server event keyed on its project', () => {
    expect(isValidEventName('first_diagnosis_ready')).toBe(true);
    expect(MUSHI_EVENTS.first_diagnosis_ready.surface).toBe('server');
    expect(MUSHI_EVENTS.first_diagnosis_ready.required).toEqual(['project_id']);
  });
});

describe('console diagnosis events', () => {
  // POST /v1/sdk/events drops every event whose taxonomy surface is only
  // 'server' (SERVER_OWNED_EVENTS), so a console-emitted name must not be one.
  it('diagnosis_viewed is a console event keyed on report, project and surface', () => {
    expect(isValidEventName('diagnosis_viewed')).toBe(true);
    expect(MUSHI_EVENTS.diagnosis_viewed.surface).toBe('console');
    expect(MUSHI_EVENTS.diagnosis_viewed.required).toEqual(['report_id', 'project_id', 'surface']);
  });

  it('a sample diagnosis view is not a habit event', () => {
    expect(HABIT_EVENTS).not.toContain('diagnosis_viewed');
  });
});
