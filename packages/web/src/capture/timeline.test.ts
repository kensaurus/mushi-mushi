import { describe, it, expect, afterEach } from 'vitest';
import { createTimelineCapture } from './timeline';

describe('createTimelineCapture', () => {
  let capture: ReturnType<typeof createTimelineCapture> | null = null;

  afterEach(() => {
    capture?.destroy();
    capture = null;
    history.pushState({}, '', '/');
  });

  it('records route entries for pushState navigations', () => {
    capture = createTimelineCapture();
    history.pushState({}, '', '/articles/my-slug');
    const routes = capture.getEntries().filter((e) => e.kind === 'route');
    const last = routes[routes.length - 1]!;
    expect(last.payload.source).toBe('pushState');
    expect(last.payload.route).toBe('/articles/my-slug');
  });

  it('scrubs query values in route payloads (route + href)', () => {
    capture = createTimelineCapture();
    history.pushState({}, '', '/reset?token=abc123&tag=cats');
    const routes = capture.getEntries().filter((e) => e.kind === 'route');
    const last = routes[routes.length - 1]!;
    expect(last.payload.route).toBe('/reset?token=[Scrubbed]&tag=cats');
    expect(String(last.payload.href)).not.toContain('abc123');
    expect(String(last.payload.href)).toContain('token=[Scrubbed]');
  });

  it('records hashchange navigations with hash-fragment query scrubbed', () => {
    capture = createTimelineCapture();
    history.pushState({}, '', '/#/login?token=secret99');
    window.dispatchEvent(new Event('hashchange'));
    const routes = capture.getEntries().filter((e) => e.kind === 'route');
    const last = routes[routes.length - 1]!;
    expect(last.payload.route).toContain('#/login?token=[Scrubbed]');
    expect(JSON.stringify(last.payload)).not.toContain('secret99');
  });
});
