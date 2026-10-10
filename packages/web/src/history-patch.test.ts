import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  subscribeHistory,
  uninstallHistoryPatchForce,
  __historyPatchDebug,
} from './history-patch';

describe('history-patch hub', () => {
  afterEach(() => {
    uninstallHistoryPatchForce();
  });

  it('100× pushState + 100× replaceState without stack overflow', () => {
    let pushCount = 0;
    let replaceCount = 0;
    subscribeHistory({
      onPush: () => { pushCount++; },
      onReplace: () => { replaceCount++; },
    });

    expect(() => {
      for (let i = 0; i < 100; i++) {
        history.pushState({}, '', `/push-${i}`);
      }
      for (let i = 0; i < 100; i++) {
        history.replaceState({}, '', `/replace-${i}`);
      }
    }).not.toThrow();

    expect(pushCount).toBe(100);
    expect(replaceCount).toBe(100);
    expect(__historyPatchDebug().patched).toBe(true);
  });

  it('double subscribe/unsubscribe leaves single wrapper', () => {
    const nativePush = History.prototype.pushState;
    const unsub1 = subscribeHistory({ onPush: () => undefined });
    const wrapped = history.pushState;
    expect(wrapped).not.toBe(nativePush);

    const unsub2 = subscribeHistory({ onReplace: () => undefined });
    expect(history.pushState).toBe(wrapped);

    unsub1();
    expect(__historyPatchDebug().patched).toBe(true);
    expect(history.pushState).toBe(wrapped);

    unsub2();
    expect(__historyPatchDebug().patched).toBe(false);
    expect(history.pushState).toBe(nativePush);
  });

  it('notifies all subscribers on each navigation', () => {
    const a: string[] = [];
    const b: string[] = [];
    subscribeHistory({ onPush: () => a.push('a') });
    subscribeHistory({ onPush: () => b.push('b') });

    history.pushState({}, '', '/multi');
    expect(a).toEqual(['a']);
    expect(b).toEqual(['b']);
  });

  it('keeps a host wrapper installed before it and restores that wrapper on uninstall', () => {
    const native = history.pushState;
    const seen: string[] = [];
    const hostWrapper = function hostPushState(this: History, ...args: Parameters<History['pushState']>) {
      seen.push(String(args[2]));
      return native.apply(this, args);
    } as History['pushState'];
    history.pushState = hostWrapper;
    try {
      const pushes: string[] = [];
      const unsub = subscribeHistory({ onPush: () => pushes.push(location.pathname) });
      history.pushState({}, '', '/host-wrapped');
      expect(seen).toEqual(['/host-wrapped']);
      expect(pushes).toEqual(['/host-wrapped']);

      unsub();
      expect(history.pushState).toBe(hostWrapper);
    } finally {
      history.pushState = native;
    }
  });

  it('a wrapper left under another tool forwards without notifying after re-install', () => {
    let count = 0;
    const unsub = subscribeHistory({ onPush: () => { count++; } });
    const ours = history.pushState;
    const outer = function outerPushState(this: History, ...args: Parameters<History['pushState']>) {
      return ours.apply(this, args);
    } as History['pushState'];
    history.pushState = outer;
    unsub(); // ours stays under `outer`

    subscribeHistory({ onPush: () => { count++; } });
    history.pushState({}, '', '/layered');
    expect(count).toBe(1);
    uninstallHistoryPatchForce();
    expect(history.pushState).toBe(outer);
    history.pushState = History.prototype.pushState;
  });

  it('keeps no subscriber when there is no window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    try {
      const unsub = subscribeHistory({ onPush: () => undefined });
      expect(__historyPatchDebug()).toEqual({ patched: false, subscriberCount: 0 });
      expect(() => unsub()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('popstate fan-out does not throw when subscriber errors', () => {
    subscribeHistory({
      onPop: () => { throw new Error('boom'); },
    });
    subscribeHistory({
      onPop: () => undefined,
    });

    expect(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    }).not.toThrow();
  });
});
