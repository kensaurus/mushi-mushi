import { describe, it, expect, afterEach } from 'vitest';
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
