import { describe, it, expect, beforeEach } from 'vitest';
import { createElementSelector } from './element-selector';

describe('createElementSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"><button class="btn">Click me</button></div>';
  });

  it('creates a selector that is initially inactive', () => {
    const selector = createElementSelector();
    expect(selector.isActive()).toBe(false);
  });

  it('becomes active after activate()', () => {
    const selector = createElementSelector();
    selector.activate();
    expect(selector.isActive()).toBe(true);
    selector.deactivate();
  });

  it('becomes inactive after deactivate()', () => {
    const selector = createElementSelector();
    selector.activate();
    selector.deactivate();
    expect(selector.isActive()).toBe(false);
  });

  it('returns null when Escape is pressed', async () => {
    const selector = createElementSelector();
    const promise = selector.activate();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const result = await promise;

    expect(result).toBeNull();
    expect(selector.isActive()).toBe(false);
  });

  it('cleans up overlay on deactivate', () => {
    const selector = createElementSelector();
    selector.activate();
    const overlays = document.querySelectorAll('div[style*="pointer-events: none"]');
    expect(overlays.length).toBeGreaterThan(0);

    selector.deactivate();
    const overlaysAfter = document.querySelectorAll('div[style*="pointer-events: none"]');
    expect(overlaysAfter.length).toBe(0);
  });

  describe('the text of the picked element', () => {
    const PRIVATE = '[data-private],.secret';

    async function pick(target: Element, ...args: Parameters<typeof createElementSelector>) {
      document.elementsFromPoint = () => [target];
      const selector = createElementSelector(...args);
      const result = selector.activate();
      const layer = [...document.body.children].at(-1) as HTMLElement;
      layer.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
      return result;
    }

    it('is kept, scrubbed, outside private areas', async () => {
      document.body.innerHTML = '<button id="b">Mail jake@example.com</button>';
      const el = await pick(document.getElementById('b')!, () => PRIVATE, (t) => t.replace('jake@example.com', '[EMAIL]'));
      expect(el?.textContent).toBe('Mail [EMAIL]');
    });

    it('is dropped inside a private area', async () => {
      document.body.innerHTML = '<section data-private><p id="p">members-only post</p></section>';
      const el = await pick(document.getElementById('p')!, () => PRIVATE);
      expect(el?.tagName).toBe('p');
      expect(el?.textContent).toBeUndefined();
    });

    it('is dropped when the element holds a private area', async () => {
      document.body.innerHTML = '<div id="d"><span class="secret">members-only post</span></div>';
      const el = await pick(document.getElementById('d')!, () => PRIVATE);
      expect(el?.textContent).toBeUndefined();
    });

    it('is dropped when the private selector is invalid', async () => {
      document.body.innerHTML = '<p id="p">text</p>';
      const el = await pick(document.getElementById('p')!, () => '[[bad');
      expect(el?.textContent).toBeUndefined();
    });
  });
});
