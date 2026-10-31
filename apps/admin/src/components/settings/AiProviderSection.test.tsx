/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/settings/AiProviderSection.test.tsx
 * PURPOSE: "Run AI on" follows what the user wants:
 *   - with an OpenAI key, choosing OpenAI switches every app and says so;
 *   - without one, choosing OpenAI opens the add-key form instead of failing;
 *   - a member who cannot change it sees the setting but cannot press it.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  data: null as unknown,
  reload: vi.fn(),
  apiFetch: vi.fn(async () => ({ ok: true, data: { aiProvider: 'openai' } })),
}));

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({ data: state.data, loading: false, error: null, reload: state.reload }),
}));
vi.mock('../../lib/supabase', () => ({ apiFetch: (...args: unknown[]) => state.apiFetch(...(args as [])) }));

import { AiProviderSection } from './AiProviderSection';

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onNeedOpenAiKey = vi.fn();

function render() {
  act(() => root.render(createElement(AiProviderSection, { keysToken: '', onNeedOpenAiKey })));
}

function openAiButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('OpenAI'))!;
}

beforeEach(() => {
  state.apiFetch.mockClear();
  state.reload.mockClear();
  onNeedOpenAiKey.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AiProviderSection', () => {
  it('switches to OpenAI when the organization has an OpenAI key', async () => {
    state.data = { organizationId: 'o1', aiProvider: 'anthropic', canManage: true, hasOpenAiKey: true };
    render();
    await act(async () => openAiButton().click());
    expect(state.apiFetch).toHaveBeenCalledWith('/v1/admin/byok/ai-provider', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ aiProvider: 'openai' }) }));
    expect(state.reload).toHaveBeenCalled();
    expect(container.textContent).toContain('Your apps now run AI on OpenAI.');
  });

  it('opens the add-key form instead of failing when there is no OpenAI key', async () => {
    state.data = { organizationId: 'o1', aiProvider: 'anthropic', canManage: true, hasOpenAiKey: false };
    render();
    await act(async () => openAiButton().click());
    expect(onNeedOpenAiKey).toHaveBeenCalledTimes(1);
    expect(state.apiFetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Add an OpenAI key, then choose OpenAI again.');
  });

  it('shows the setting to a member without letting them change it', async () => {
    state.data = { organizationId: 'o1', aiProvider: 'openai', canManage: false, hasOpenAiKey: true };
    render();
    expect(container.textContent).toContain('No Claude key is used.');
    expect(container.textContent).toContain('An organization owner or admin can change this.');
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute('aria-disabled')).toBe('true');
  });
});
