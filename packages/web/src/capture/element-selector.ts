import type { MushiSelectedElement } from '@mushi-mushi/core';
import { MUSHI_COLORS_LIGHT } from '@mushi-mushi/core';

export interface ElementSelector {
  activate(): Promise<MushiSelectedElement | null>;
  deactivate(): void;
  isActive(): boolean;
}

export function createElementSelector(): ElementSelector {
  let active = false;
  let overlay: HTMLDivElement | null = null;
  let captureLayer: HTMLDivElement | null = null;
  let hoveredElement: Element | null = null;
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
    // SVG elements expose className as SVGAnimatedString, not string —
    // icons are common click targets, so read the attribute instead.
    const className =
      typeof el.className === 'string' ? el.className : el.getAttribute('class') ?? '';
    return {
      tagName: el.tagName.toLowerCase(),
      id: el.id || undefined,
      className: className || undefined,
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
      border: 2px solid ${MUSHI_COLORS_LIGHT.accent};
      background: ${MUSHI_COLORS_LIGHT.accentWash};
      border-radius: 4px;
      transition: all 0.1s ease;
      display: none;
    `;
    document.body.appendChild(el);
    return el;
  }

  /**
   * Full-viewport transparent layer that owns every pointer event while the
   * picker is active. Hit-testing the page is done via elementsFromPoint()
   * underneath it instead of relying on `e.target`, which fixes two dead
   * zones the old listener-on-document approach had:
   * - <iframe>: mouse events inside a frame never reach the parent document,
   *   so hover did nothing and a click was swallowed — the picker hung with
   *   the panel hidden. With the layer, the frame element itself is pickable.
   * - Shadow DOM: `e.target` is retargeted to the shadow host; we descend
   *   into open shadow roots to capture the element the user actually sees.
   * It also stops the page's own handlers from firing mid-pick (the old code
   * only cancelled `click`, so mousedown/pointerdown still leaked through).
   */
  function createCaptureLayer(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      cursor: crosshair;
      background: transparent;
    `;
    document.body.appendChild(el);
    return el;
  }

  function resolveTargetAt(x: number, y: number): Element | null {
    const stack = document.elementsFromPoint(x, y);
    let target: Element | null = null;
    for (const el of stack) {
      if (el === captureLayer || el === overlay) continue;
      if (el.id === 'mushi-mushi-widget' || el.closest('#mushi-mushi-widget')) return null;
      target = el;
      break;
    }
    // Descend through open shadow roots to the rendered element.
    let hops = 0;
    while (target?.shadowRoot && hops < 20) {
      const inner = target.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === target) break;
      target = inner;
      hops++;
    }
    return target;
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
    const target = resolveTargetAt(e.clientX, e.clientY);
    if (!target) {
      hoveredElement = null;
      if (overlay) overlay.style.display = 'none';
      return;
    }
    hoveredElement = target;
    positionOverlay(target);
  }

  function swallow(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = resolveTargetAt(e.clientX, e.clientY);
    // Click landed on the Mushi widget host — ignore, keep picking.
    if (!target) return;
    finish(captureElement(target));
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      finish(null);
    }
  }

  function handleScroll() {
    // Keep the highlight glued to the hovered element while the page scrolls.
    if (hoveredElement?.isConnected) positionOverlay(hoveredElement);
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
      captureLayer = createCaptureLayer();

      captureLayer.addEventListener('mousemove', handleMouseMove);
      captureLayer.addEventListener('click', handleClick);
      captureLayer.addEventListener('pointerdown', swallow);
      captureLayer.addEventListener('mousedown', swallow);
      captureLayer.addEventListener('mouseup', swallow);
      document.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    });
  }

  function deactivate() {
    if (!active) return;
    active = false;
    hoveredElement = null;
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('scroll', handleScroll, { capture: true });

    // Capture-layer listeners die with the node.
    if (captureLayer) {
      captureLayer.remove();
      captureLayer = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
  }

  return { activate, deactivate, isActive: () => active };
}
