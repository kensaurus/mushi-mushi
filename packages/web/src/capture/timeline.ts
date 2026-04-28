import type { MushiConsoleEntry, MushiNetworkEntry, MushiTimelineEntry } from '@mushi-mushi/core';

const MAX_TIMELINE_ENTRIES = 120;

export interface TimelineCapture {
  setScreen(screen: { name: string; route?: string; feature?: string }): void;
  getEntries(input?: {
    consoleLogs?: MushiConsoleEntry[] | null;
    networkLogs?: MushiNetworkEntry[] | null;
  }): MushiTimelineEntry[];
  clear(): void;
  destroy(): void;
}

export function createTimelineCapture(): TimelineCapture {
  const entries: MushiTimelineEntry[] = [];
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const handlePopState = () => recordRoute('popstate');
  const handleHashChange = () => recordRoute('hashchange');

  recordRoute('initial');

  function record(entry: MushiTimelineEntry): void {
    entries.push(entry);
    if (entries.length > MAX_TIMELINE_ENTRIES) entries.shift();
  }

  function recordRoute(source: string): void {
    if (typeof location === 'undefined') return;
    record({
      ts: Date.now(),
      kind: 'route',
      payload: {
        source,
        route: `${location.pathname}${location.search}${location.hash}`,
        href: location.href,
      },
    });
  }

  function handleClick(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const el = target.closest('button,a,[role="button"],input,textarea,select,[data-mushi-track]') ?? target;
    record({
      ts: Date.now(),
      kind: 'click',
      payload: {
        tag: el.tagName.toLowerCase(),
        id: (el as HTMLElement).id || undefined,
        text: textSnippet(el),
      },
    });
  }

  history.pushState = function mushiPushState(this: History, ...args) {
    const result = originalPushState.apply(this, args);
    recordRoute('pushState');
    return result;
  } as typeof history.pushState;

  history.replaceState = function mushiReplaceState(this: History, ...args) {
    const result = originalReplaceState.apply(this, args);
    recordRoute('replaceState');
    return result;
  } as typeof history.replaceState;

  window.addEventListener('popstate', handlePopState);
  window.addEventListener('hashchange', handleHashChange);
  document.addEventListener('click', handleClick, true);

  return {
    setScreen(screen) {
      record({
        ts: Date.now(),
        kind: 'screen',
        payload: screen,
      });
    },
    getEntries(input = {}) {
      const merged = [
        ...entries,
        ...(input.consoleLogs ?? []).map((log): MushiTimelineEntry => ({
          ts: log.timestamp,
          kind: 'log',
          payload: {
            level: log.level,
            message: log.message,
          },
        })),
        ...(input.networkLogs ?? []).map((network): MushiTimelineEntry => ({
          ts: network.timestamp,
          kind: 'request',
          payload: {
            method: network.method,
            url: network.url,
            status: network.status,
            duration: network.duration,
            error: network.error,
          },
        })),
      ].sort((a, b) => a.ts - b.ts);
      return merged.slice(-MAX_TIMELINE_ENTRIES);
    },
    clear() {
      entries.length = 0;
    },
    destroy() {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handleHashChange);
      document.removeEventListener('click', handleClick, true);
    },
  };
}

function textSnippet(el: Element): string | undefined {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 80) : undefined;
}
