import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSHI_INTERNAL_INIT_MARKER } from '@mushi-mushi/core';
import { setupProactiveTriggers } from './proactive-triggers';

describe('setupProactiveTriggers apiCascade', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('ignores Mushi internal and configured URLs when counting cascades', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 500 }));
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      {
        rageClick: false,
        longTask: false,
        apiEndpoint: 'https://mushi.example.com/functions/v1/api',
        apiCascade: { ignoreUrls: ['analytics.example.com'] },
      },
    );

    await fetch('https://mushi.example.com/functions/v1/api/v1/sdk/config');
    await fetch('https://analytics.example.com/noisy');
    await fetch('https://host.example.com/marked', {
      [MUSHI_INTERNAL_INIT_MARKER]: 'sdk-config',
    } as RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: string });

    expect(onTrigger).not.toHaveBeenCalled();
    cleanup.destroy();
  });

  it('still triggers for repeated host-app failures', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 500 }));
    const onTrigger = vi.fn();
    const cleanup = setupProactiveTriggers(
      { onTrigger },
      { rageClick: false, longTask: false, apiCascade: true },
    );

    await fetch('https://api.example.com/a');
    await fetch('https://api.example.com/b');
    await fetch('https://api.example.com/c');

    expect(onTrigger).toHaveBeenCalledWith('api_cascade', {
      failureCount: 3,
      windowMs: 10000,
    });
    cleanup.destroy();
  });
});
