import { describe, it, expect, afterEach } from 'vitest';
import {
  createDiscoveryCapture,
  deriveRoute,
  normalizeRoute,
  normalizeSegment,
  type DiscoveryEvent,
} from './discovery';

describe('normalizeSegment', () => {
  it('collapses opaque ids, keeps human slugs', () => {
    expect(normalizeSegment('123')).toBe('[id]');
    expect(normalizeSegment('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe('[id]');
    expect(normalizeSegment('thai-language')).toBe('thai-language');
  });
});

describe('deriveRoute (hash-router awareness)', () => {
  it('uses the pathname when there is no hash route', () => {
    expect(deriveRoute('/articles/42', '', undefined)).toBe('/articles/[id]');
  });

  it('ignores pure anchors and keeps the pathname', () => {
    expect(deriveRoute('/docs/setup', '#install', undefined)).toBe('/docs/setup');
  });

  it('derives the route from a RealWorld-style hash route', () => {
    expect(deriveRoute('/', '#/login', undefined)).toBe('/#/login');
    expect(deriveRoute('/', '#/', undefined)).toBe('/#/');
    expect(deriveRoute('/', '#/article/12345', undefined)).toBe('/#/article/[id]');
  });

  it('strips the hash query before templating', () => {
    expect(deriveRoute('/', '#/?tag=dragons', undefined)).toBe('/#/');
    expect(deriveRoute('/', '#/search?q=x', undefined)).toBe('/#/search');
  });

  it('matches host templates authored with or without the /# prefix', () => {
    expect(
      deriveRoute('/', '#/article/how-to-train', ['/#/article/[slug]']),
    ).toBe('/#/article/[slug]');
    expect(
      deriveRoute('/', '#/profile/jake', ['/profile/[username]']),
    ).toBe('/#/profile/[username]');
  });

  it('normalizeRoute is unchanged for path routers', () => {
    expect(normalizeRoute('/practice/abc-123/', ['/practice/[id]'])).toBe('/practice/[id]');
  });
});

describe('createDiscoveryCapture (hashchange subscription)', () => {
  let capture: ReturnType<typeof createDiscoveryCapture> | null = null;

  afterEach(() => {
    capture?.destroy();
    capture = null;
    history.pushState({}, '', '/');
  });

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('emits a new inventory event when the hash route changes', async () => {
    history.pushState({}, '', '/#/');
    const events: DiscoveryEvent[] = [];
    capture = createDiscoveryCapture({
      config: { enabled: true, throttleMs: 0 },
      getRecentNetworkPaths: () => [],
      getUserId: () => null,
      getSessionId: () => 'sess-1',
      onEvent: (e) => events.push(e),
    });
    await wait(150); // initial 100ms debounce
    history.pushState({}, '', '/#/article/98765');
    window.dispatchEvent(new Event('hashchange'));
    await wait(150);

    const routes = events.map((e) => e.route);
    expect(routes).toContain('/#/');
    expect(routes).toContain('/#/article/[id]');
  });

  it('collects query-param keys from inside the hash fragment (keys only)', async () => {
    history.pushState({}, '', '/#/?tag=dragons&limit=10');
    const events: DiscoveryEvent[] = [];
    capture = createDiscoveryCapture({
      config: { enabled: true, throttleMs: 0 },
      getRecentNetworkPaths: () => [],
      getUserId: () => null,
      getSessionId: () => 'sess-2',
      onEvent: (e) => events.push(e),
    });
    await wait(150);

    expect(events.length).toBeGreaterThan(0);
    const e = events[events.length - 1]!;
    expect(e.query_param_keys).toEqual(['limit', 'tag']);
    expect(JSON.stringify(e)).not.toContain('dragons');
  });
});
