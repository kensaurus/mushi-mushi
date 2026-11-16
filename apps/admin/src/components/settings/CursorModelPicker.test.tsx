/**
 * @vitest-environment jsdom
 *
 * FILE: CursorModelPicker.test.tsx
 * PURPOSE: The Cursor model picker writes a spec (`id` or `id?param=value`),
 *          reopens a saved spec, keeps a typed id through Other, and falls
 *          back to a text field when the list fails or is empty.
 */

import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_MODEL_OTHER } from './cursorModelSpec';

const LIST = [
  {
    id: 'grok-4.7',
    displayName: 'Grok 4.7',
    parameters: [
      {
        id: 'reasoning_effort',
        displayName: 'Reasoning effort',
        values: [{ value: 'high' }, { value: 'xhigh' }],
      },
    ],
  },
  { id: 'composer-2.5' },
];

const mocks = vi.hoisted(() => ({
  specs: [] as string[],
  error: null as string | null,
  models: null as unknown[] | null,
}));

vi.mock('../../lib/usePageData', () => ({
  usePageData: () => ({
    data: mocks.error ? null : { models: mocks.models },
    loading: false,
    error: mocks.error,
    reload: vi.fn(),
  }),
}));

import { CursorModelPicker } from './CursorModelPicker';

function Harness({ initial, keyId }: { initial: string; keyId?: string }) {
  const [value, setValue] = useState(initial);
  return createElement(CursorModelPicker, {
    value,
    keyId,
    label: 'Model (optional)',
    emptyLabel: 'Account default',
    onChange: (spec: string) => {
      mocks.specs.push(spec);
      setValue(spec);
    },
  });
}

function selectByLabel(label: string): HTMLSelectElement {
  const lab = Array.from(document.body.querySelectorAll('label')).find(
    (l) => l.textContent?.includes(label) && l.querySelector('select'),
  );
  const sel = lab?.querySelector('select') as HTMLSelectElement | null;
  if (!sel) throw new Error(`no select "${label}"`);
  return sel;
}
function inputByLabel(label: string): HTMLInputElement {
  const lab = Array.from(document.body.querySelectorAll('label')).find((l) =>
    l.textContent?.includes(label),
  );
  const input = lab?.querySelector('input') as HTMLInputElement | null;
  if (!input) throw new Error(`no input "${label}"`);
  return input;
}
function change(el: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(
    new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  );
}

describe('CursorModelPicker', () => {
  let container: HTMLDivElement;
  let root: Root;
  async function render(initial: string, keyId?: string) {
    await act(async () => {
      root.render(createElement(Harness, { initial, keyId }));
    });
  }
  beforeEach(() => {
    mocks.specs = [];
    mocks.error = null;
    mocks.models = LIST;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  it('writes a model and its setting', async () => {
    await render('');
    await act(async () => change(selectByLabel('Model'), 'grok-4.7'));
    await act(async () => change(selectByLabel('Reasoning effort'), 'xhigh'));
    expect(mocks.specs.at(-1)).toBe('grok-4.7?reasoning_effort=xhigh');
  });

  it('reopens a saved spec on the same controls', async () => {
    await render('grok-4.7?reasoning_effort=xhigh');
    expect(selectByLabel('Model').value).toBe('grok-4.7');
    expect(selectByLabel('Reasoning effort').value).toBe('xhigh');
    expect(mocks.specs).toEqual([]);
  });

  it('keeps a listed spec when Other is chosen, then takes a typed id', async () => {
    await render('grok-4.7?reasoning_effort=xhigh');
    await act(async () => change(selectByLabel('Model'), CURSOR_MODEL_OTHER));
    expect(mocks.specs).toEqual([]);
    expect(inputByLabel('Model id').value).toBe('grok-4.7?reasoning_effort=xhigh');
    await act(async () => change(inputByLabel('Model id'), 'custom-1'));
    expect(mocks.specs.at(-1)).toBe('custom-1');
    expect(selectByLabel('Model').value).toBe(CURSOR_MODEL_OTHER);
  });

  it('shows a saved id the list does not have as Other', async () => {
    await render('custom-1');
    expect(selectByLabel('Model').value).toBe(CURSOR_MODEL_OTHER);
    expect(inputByLabel('Model id').value).toBe('custom-1');
    await act(async () => change(selectByLabel('Model'), 'composer-2.5'));
    expect(mocks.specs.at(-1)).toBe('composer-2.5');
    expect(document.body.querySelector('input')).toBeNull();
  });

  it('drops Other when the Cursor key changes, so a listed id is selected again', async () => {
    await render('grok-4.7', 'key-a');
    await act(async () => change(selectByLabel('Model'), CURSOR_MODEL_OTHER));
    expect(inputByLabel('Model id').value).toBe('grok-4.7');
    await act(async () => {
      root.render(createElement(Harness, { initial: 'grok-4.7', keyId: 'key-b' }));
    });
    expect(selectByLabel('Model').value).toBe('grok-4.7');
    expect(document.body.querySelector('input')).toBeNull();
  });

  it('falls back to a text field when the list fails or is empty', async () => {
    mocks.error = 'down';
    await render('composer-2.5');
    expect(document.body.textContent).toContain("Cursor's model list did not load");
    await act(async () => change(inputByLabel('Model'), 'custom-1?effort=high'));
    expect(mocks.specs.at(-1)).toBe('custom-1?effort=high');

    mocks.error = null;
    mocks.models = [];
    mocks.specs = [];
    await render('');
    expect(document.body.querySelector('select')).toBeNull();
    await act(async () => change(inputByLabel('Model'), 'composer-2.5'));
    expect(mocks.specs.at(-1)).toBe('composer-2.5');
  });
});
