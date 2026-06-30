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

let capturedPushState: History['pushState'] | null = null;
let capturedReplaceState: History['replaceState'] | null = null;
/** Unbound natives — restored on uninstall (avoids bound-vs-bound mismatch in jsdom). */
let nativePushState: History['pushState'] | null = null;
let nativeReplaceState: History['replaceState'] | null = null;
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

  nativePushState = History.prototype.pushState;
  nativeReplaceState = History.prototype.replaceState;
  capturedPushState = nativePushState.bind(history);
  capturedReplaceState = nativeReplaceState.bind(history);

  pushWrapper = function historyPatchPushState(
    ...args: Parameters<History['pushState']>
  ) {
    // Fall back to prototype if capturedPushState was nulled by a concurrent
    // uninstall (e.g. an outer third-party wrapper still holds this reference
    // after Mushi.destroy() — avoids crashing navigation post-teardown).
    const call = capturedPushState ?? History.prototype.pushState.bind(history);
    const ret = call(...args);
    notifyPush();
    return ret;
  } as typeof history.pushState;

  replaceWrapper = function historyPatchReplaceState(
    ...args: Parameters<History['replaceState']>
  ) {
    const call = capturedReplaceState ?? History.prototype.replaceState.bind(history);
    const ret = call(...args);
    notifyReplace();
    return ret;
  } as typeof history.replaceState;

  history.pushState = pushWrapper;
  history.replaceState = replaceWrapper;

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
  if (pushWrapper && history.pushState === pushWrapper && nativePushState) {
    history.pushState = nativePushState;
  }
  if (replaceWrapper && history.replaceState === replaceWrapper && nativeReplaceState) {
    history.replaceState = nativeReplaceState;
  }

  pushWrapper = null;
  replaceWrapper = null;
  capturedPushState = null;
  capturedReplaceState = null;
  nativePushState = null;
  nativeReplaceState = null;
  patched = false;
}

/** Register for history changes. Installs the shared patch on first subscriber. */
export function subscribeHistory(sub: HistorySubscriber): () => void {
  // ensurePatch first — if it throws (sandboxed iframe with locked History API)
  // the subscriber must not be added, so callers can recover a clean state.
  ensurePatch();
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
