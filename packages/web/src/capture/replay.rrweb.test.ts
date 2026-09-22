/**
 * Replay loading and masking against the REAL rrweb (a dev dependency here),
 * not a mock. replay.test.ts pins the options the SDK passes; this file proves
 * rrweb honours them — the earlier `maskAllText: true` passed a mock-based
 * test for months while rrweb ignored it and recorded text in clear.
 *
 * Also covers where rrweb comes from: the host loader (`capture.rrweb`), a
 * global from the UMD script tag, and the one-time warning when neither works.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// Every test re-imports ./replay — and the real rrweb, about 1 MB — through
// vi.resetModules(). On a loaded runner that cold import alone can pass the
// 5 s default; the timed-out test then warns late, inside the next test's
// console spy, which is why a timeout here showed up as "warn called twice".
vi.setConfig({ testTimeout: 30_000 });

async function freshReplay() {
  vi.resetModules();
  return import('./replay');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock('rrweb');
  delete (globalThis as { rrweb?: unknown }).rrweb;
  document.body.innerHTML = '';
});

describe('replay with the real rrweb', () => {
  it('records through the host loader and masks every text node and input', async () => {
    document.body.innerHTML =
      '<main><h1>Alice Example</h1><p>alice@example.com</p><input value="hunter2-secret"></main>';
    const { createReplayCapture } = await freshReplay();
    const loader = vi.fn(() => import('rrweb'));
    const replay = await createReplayCapture({ enabled: true, loadRrweb: loader });
    replay.start();
    const serialized = JSON.stringify(replay.flush());
    replay.destroy();

    expect(loader).toHaveBeenCalledOnce();
    // A full snapshot (type 2) was recorded, so the assertions below are about real output.
    expect(serialized).toContain('"type":2');
    expect(serialized).not.toContain('Alice Example');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('hunter2-secret');
  });
});

describe('replay rrweb sources', () => {
  it('uses a global rrweb from the UMD script tag when there is no loader', async () => {
    vi.doMock('rrweb', () => {
      throw new Error('rrweb is not installed');
    });
    const record = vi.fn(() => () => {});
    (globalThis as { rrweb?: unknown }).rrweb = { record };
    const { createReplayCapture } = await freshReplay();
    const replay = await createReplayCapture({ enabled: true });
    replay.start();
    expect(record).toHaveBeenCalledOnce();
    replay.destroy();
  });

  it('accepts a loader that resolves to a CommonJS-interop { default } module', async () => {
    const record = vi.fn(() => () => {});
    const { createReplayCapture } = await freshReplay();
    const replay = await createReplayCapture({ enabled: true, loadRrweb: async () => ({ default: { record } }) });
    replay.start();
    expect(record).toHaveBeenCalledOnce();
    replay.destroy();
  });

  it('warns once and records clicks only when rrweb cannot be loaded', async () => {
    vi.doMock('rrweb', () => {
      throw new Error('rrweb is not installed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createReplayCapture } = await freshReplay();
    const first = await createReplayCapture({
      enabled: true,
      loadRrweb: async () => {
        throw new Error('chunk failed to load');
      },
    });
    const second = await createReplayCapture({ enabled: true });

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("capture: { rrweb: () => import('rrweb') }");

    first.start();
    document.body.click();
    expect(first.flush()).toEqual([expect.objectContaining({ type: 'lite_click' })]);
    first.destroy();
    second.destroy();
  });
});
