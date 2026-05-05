import type { MushiSelectedElement } from '@mushi-mushi/core';

export interface ElementSelector {
  activate(): Promise<MushiSelectedElement | null>;
  deactivate(): void;
  isActive(): boolean;
}

export function createElementSelector(): ElementSelector {
  let active = false;
  let overlay: HTMLDivElement | null = null;
  let resolvePromise: ((el: MushiSelectedElement | null) => void) | null = null;

  /**
   * Walk up the DOM until we find an ancestor with `data-testid`.
   *
   * Why ascending and not descending: testids in modern apps are placed
   * on the OUTER interactive container ("BuyProButton") rather than on
   * the deepest leaf the click event hit (the SVG inside the icon).
   * Walking up matches authoring intent.
   *
   * Bounded at 20 hops so a misbehaving page can't pin the SDK in a
   * pathological tree.
   */
  function findNearestTestid(el: Element | null): string | null {
    let cur: Element | null = el;
    let hops = 0;
    while (cur && hops < 20) {
      const tid = cur.getAttribute?.('data-testid');
      if (tid) return tid;
      cur = cur.parentElement;
      hops++;
    }
    return null;
  }

  function getXPath(el: Element): string {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== document.body) {
      let index = 1;
      let sibling: Element | null = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index++;
        sibling = sibling.previousElementSibling;
      }
      const tag = current.tagName.toLowerCase();
      parts.unshift(index > 1 ? `${tag}[${index}]` : tag);
      current = current.parentElement;
    }
    return '//' + parts.join('/');
  }

  function captureElement(el: Element): MushiSelectedElement {
    const rect = el.getBoundingClientRect();
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: el.className || undefined,
      textContent: el.textContent?.trim().slice(0, 200) || undefined,
      xpath: getXPath(el),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      // v2 (whitepaper §4.7): the closest ancestor's `data-testid` lets the
      // server map this report → an Action node in the inventory graph
      // without a fuzzy NLP guess. We walk to the body so a deeply nested
      // span inside a button-with-testid still resolves correctly.
      nearestTestid: findNearestTestid(el) || undefined,
      route: typeof window !== 'undefined' ? window.location.pathname : undefined,
    };
  }

  function createOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      border: 2px solid #6366f1;
      background: rgba(99, 102, 241, 0.1);
      border-radius: 4px;
      transition: all 0.1s ease;
      display: none;
    `;
    document.body.appendChild(el);
    return el;
  }

  function positionOverlay(target: Element) {
    if (!overlay) return;
    const rect = target.getBoundingClientRect();
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.display = 'block';
  }

  function handleMouseMove(e: MouseEvent) {
    const target = e.target as Element;
    if (target === overlay) return;
    positionOverlay(target);
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as Element;
    if (target === overlay) return;
    const captured = captureElement(target);
    finish(captured);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      finish(null);
    }
  }

  function finish(result: MushiSelectedElement | null) {
    deactivate();
    resolvePromise?.(result);
    resolvePromise = null;
  }

  function activate(): Promise<MushiSelectedElement | null> {
    if (active) deactivate();

    return new Promise((resolve) => {
      resolvePromise = resolve;
      active = true;
      overlay = createOverlay();
      document.body.style.cursor = 'crosshair';

      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
    });
  }

  function deactivate() {
    if (!active) return;
    active = false;
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);

    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  return { activate, deactivate, isActive: () => active };
}
