import type { MushiSentryConfig } from '@mushi-mushi/core';

export interface SentryContext {
  eventId?: string;
  replayId?: string;
  traceId?: string;
  release?: string;
  environment?: string;
}

interface SentryHub {
  getClient?(): { getOptions?(): { release?: string; environment?: string } } | undefined;
  getScope?(): { getLastEventId?(): string | undefined } | undefined;
}

interface SentryReplayIntegration {
  getReplayId?(): string | undefined;
}

function getSentryGlobal(): SentryHub | undefined {
  try {
    const win = globalThis as Record<string, unknown>;
    if (win.__SENTRY__) {
      const sentry = win.__SENTRY__ as Record<string, unknown>;
      const hub = sentry.hub as SentryHub | undefined;
      return hub;
    }

    if (win.Sentry) {
      return win.Sentry as SentryHub;
    }
  } catch {
    // Sentry not available
  }
  return undefined;
}

export function captureSentryContext(_config: MushiSentryConfig): SentryContext {
  const context: SentryContext = {};

  try {
    const hub = getSentryGlobal();
    if (!hub) return context;

    const scope = hub.getScope?.();
    if (scope) {
      context.eventId = scope.getLastEventId?.() ?? undefined;
    }

    const client = hub.getClient?.();
    if (client) {
      const options = client.getOptions?.();
      context.release = options?.release;
      context.environment = options?.environment;
    }

    const win = globalThis as Record<string, unknown>;
    if (win.__SENTRY_REPLAY__) {
      const replay = win.__SENTRY_REPLAY__ as SentryReplayIntegration;
      context.replayId = replay.getReplayId?.() ?? undefined;
    }
  } catch {
    // Sentry access failed silently
  }

  return context;
}

export interface SentryFeedbackInterceptor {
  start(): void;
  stop(): void;
}

export function createSentryFeedbackInterceptor(
  _config: MushiSentryConfig,
  onFeedback: (feedback: { eventId?: string; message: string; email?: string; name?: string }) => void,
): SentryFeedbackInterceptor {
  let observer: MutationObserver | null = null;

  function start() {
    if (typeof MutationObserver === 'undefined') return;

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.getAttribute('data-sentry-feedback')) {
            interceptFeedbackForm(node);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function interceptFeedbackForm(container: HTMLElement) {
    const form = container.querySelector('form');
    if (!form) return;

    form.addEventListener('submit', () => {
      const formData = new FormData(form);
      onFeedback({
        message: formData.get('message') as string ?? '',
        email: formData.get('email') as string ?? undefined,
        name: formData.get('name') as string ?? undefined,
      });
    });
  }

  function stop() {
    observer?.disconnect();
    observer = null;
  }

  return { start, stop };
}
