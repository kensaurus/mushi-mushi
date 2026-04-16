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
});
