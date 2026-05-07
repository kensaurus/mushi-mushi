import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBreadcrumbBuffer } from './breadcrumbs';

describe('createBreadcrumbBuffer', () => {
  afterEach(() => vi.useRealTimers());

  it('returns an empty buffer initially', () => {
    const buf = createBreadcrumbBuffer();
    expect(buf.size()).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it('retains entries in insertion order (oldest first)', () => {
    const buf = createBreadcrumbBuffer();
    buf.add({ category: 'lifecycle', level: 'info', message: 'init' });
    buf.add({ category: 'navigation', level: 'info', message: 'first nav' });
    buf.add({ category: 'ui.click', level: 'info', message: 'click' });
    expect(buf.getAll().map((c) => c.message)).toEqual(['init', 'first nav', 'click']);
  });

  it('caps the buffer at `max` and evicts the oldest', () => {
    const buf = createBreadcrumbBuffer({ max: 3 });
    buf.add({ category: 'custom', level: 'info', message: 'a' });
    buf.add({ category: 'custom', level: 'info', message: 'b' });
    buf.add({ category: 'custom', level: 'info', message: 'c' });
    buf.add({ category: 'custom', level: 'info', message: 'd' });
    expect(buf.size()).toBe(3);
    expect(buf.getAll().map((c) => c.message)).toEqual(['b', 'c', 'd']);
  });

  it('defaults timestamp to Date.now() when omitted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T00:00:00Z'));
    const buf = createBreadcrumbBuffer();
    buf.add({ category: 'custom', level: 'info', message: 'now' });
    expect(buf.getAll()[0]?.timestamp).toBe(new Date('2026-05-07T00:00:00Z').getTime());
  });

  it('preserves an explicit timestamp', () => {
    const buf = createBreadcrumbBuffer();
    buf.add({ category: 'custom', level: 'info', message: 'past', timestamp: 1234 });
    expect(buf.getAll()[0]?.timestamp).toBe(1234);
  });

  it('truncates oversized messages with an ellipsis', () => {
    // The buffer enforces a 50-char floor on `maxMessageLength` to keep
    // breadcrumb messages readable; pass exactly the floor and feed in
    // 100 chars to verify the truncation + ellipsis rule.
    const buf = createBreadcrumbBuffer({ maxMessageLength: 50 });
    const long = 'x'.repeat(100);
    buf.add({ category: 'custom', level: 'info', message: long });
    const out = buf.getAll()[0]!;
    expect(out.message.length).toBe(51); // 50 chars + ellipsis
    expect(out.message.endsWith('…')).toBe(true);
  });

  it('defaults level to info when omitted', () => {
    const buf = createBreadcrumbBuffer();
    // @ts-expect-error — exercising the defensive default; callers
    // shouldn't omit `level`, but we accept it gracefully because
    // breadcrumb adds happen on the user's hot path.
    buf.add({ category: 'custom', message: 'no level' });
    expect(buf.getAll()[0]?.level).toBe('info');
  });

  it('returns a snapshot (mutating the result does not affect the buffer)', () => {
    const buf = createBreadcrumbBuffer();
    buf.add({ category: 'custom', level: 'info', message: 'one' });
    const snap = buf.getAll();
    snap.push({ category: 'custom', level: 'info', message: 'two', timestamp: 0 });
    expect(buf.getAll()).toHaveLength(1);
  });

  it('clear() empties the buffer', () => {
    const buf = createBreadcrumbBuffer();
    buf.add({ category: 'custom', level: 'info', message: 'one' });
    buf.add({ category: 'custom', level: 'info', message: 'two' });
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.getAll()).toEqual([]);
  });

  it('preserves optional `data` payload', () => {
    const buf = createBreadcrumbBuffer();
    buf.add({
      category: 'navigation',
      level: 'info',
      message: 'route change',
      data: { from: '/a', to: '/b' },
    });
    expect(buf.getAll()[0]?.data).toEqual({ from: '/a', to: '/b' });
  });

  it('omits `data` when not supplied (no undefined leakage)', () => {
    const buf = createBreadcrumbBuffer();
    buf.add({ category: 'lifecycle', level: 'info', message: 'init' });
    expect('data' in (buf.getAll()[0] ?? {})).toBe(false);
  });
});
