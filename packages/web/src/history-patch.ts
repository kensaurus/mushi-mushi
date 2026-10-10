/**
 * Single history API monkey-patch with subscriber fan-out.
 *
 * Timeline, discovery, breadcrumbs, rewards, and proactive-triggers previously
 * each wrapped `pushState` / `replaceState` independently, which stacked
 * wrappers and could recurse if any layer re-bound to its own wrapper on
 * re-init. One patch + subscribers avoids that class of bug entirely.
 */

export interface HistorySubscriber {
  onPush?: () => void;
  onReplace?: () => void;
  onPop?: () => void;
}

/**
 * What `history.pushState` / `replaceState` were when the patch went on — the
 * native method or a host wrapper installed before Mushi (an analytics or
 * router hook). Ours call through to it and uninstall restores it.
 */
let prevPushState: History['pushState'] | null = null;
let prevReplaceState: History['replaceState'] | null = null;
let pushWrapper: typeof history.pushState | null = null;
let replaceWrapper: typeof history.replaceState | null = null;
let popListener: (() => void) | null = null;
let patched = false;

const subscribers = new Set<HistorySubscriber>();

function notifyPush(): void {
  for (const sub of subscribers) {
    try {
      sub.onPush?.();
    } catch {
      /* never break navigation */
    }
  }
}

function notifyReplace(): void {
  for (const sub of subscribers) {
    try {
      sub.onReplace?.();
    } catch {
      /* never break navigation */
    }
  }
}

function notifyPop(): void {
  for (const sub of subscribers) {
    try {
      sub.onPop?.();
    } catch {
      /* never break navigation */
    }
  }
}

function ensurePatch(): void {
  if (patched || typeof window === 'undefined') return;

  // Each wrapper keeps its own `prev`, so a stale wrapper from an earlier
  // install (still held by a tool that wrapped over it) forwards to what it
  // wrapped, never back to a newer wrapper, and only the live one notifies.
  const prevPush = history.pushState;
  const prevReplace = history.replaceState;
  prevPushState = prevPush;
  prevReplaceState = prevReplace;

  const push = function historyPatchPushState(
    ...args: Parameters<History['pushState']>
  ) {
    const ret = prevPush.apply(history, args);
    if (pushWrapper === push) notifyPush();
    return ret;
  } as typeof history.pushState;

  const replace = function historyPatchReplaceState(
    ...args: Parameters<History['replaceState']>
  ) {
    const ret = prevReplace.apply(history, args);
    if (replaceWrapper === replace) notifyReplace();
    return ret;
  } as typeof history.replaceState;

  pushWrapper = push;
  replaceWrapper = replace;
  history.pushState = push;
  history.replaceState = replace;

  popListener = () => notifyPop();
  window.addEventListener('popstate', popListener);
  patched = true;
}

function uninstallPatch(): void {
  if (!patched || typeof window === 'undefined') return;

  if (popListener) {
    window.removeEventListener('popstate', popListener);
    popListener = null;
  }
  // Restore only while ours is still on top; a tool that wrapped over us keeps
  // its wrapper, and ours underneath goes inert (forwards, never notifies).
  if (pushWrapper && history.pushState === pushWrapper && prevPushState) {
    history.pushState = prevPushState;
  }
  if (replaceWrapper && history.replaceState === replaceWrapper && prevReplaceState) {
    history.replaceState = prevReplaceState;
  }

  pushWrapper = null;
  replaceWrapper = null;
  prevPushState = null;
  prevReplaceState = null;
  patched = false;
}

/** Register for history changes. Installs the shared patch on first subscriber. */
export function subscribeHistory(sub: HistorySubscriber): () => void {
  // ensurePatch first — if it throws (sandboxed iframe with locked History API)
  // the subscriber must not be added, so callers can recover a clean state.
  ensurePatch();
  // No window (SSR, non-DOM tests): nothing to observe, so keep nothing.
  if (!patched) return () => {};
  subscribers.add(sub);
  return () => {
    subscribers.delete(sub);
    if (subscribers.size === 0) {
      uninstallPatch();
    }
  };
}

/** Force-remove all subscribers and restore native history (SDK destroy). */
export function uninstallHistoryPatchForce(): void {
  subscribers.clear();
  uninstallPatch();
}

/** @internal test helper */
export function __historyPatchDebug(): { patched: boolean; subscriberCount: number } {
  return { patched, subscriberCount: subscribers.size };
}
