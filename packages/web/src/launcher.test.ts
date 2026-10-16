/**
 * FILE: packages/web/src/launcher.test.ts
 * PURPOSE: The floating launcher's footprint rules (owner report 2026-10-16:
 *          the launcher covered content and the host's bottom tab bar).
 *          - phones draw a slim edge tab for `trigger: 'auto'`
 *          - the launcher lifts above fixed / sticky host bars at the bottom
 *          - safe-area insets and reduced motion in the stylesheet
 *          - scroll tuck toggles a class on the live element (no rebuild)
 *          - the edge tab drags along its edge; position persists per site
 *            and survives blocked storage
 *          - "Hide the bug button for this visit"
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MushiWidget, type WidgetCallbacks } from './widget';
import { getWidgetStyles } from './styles';

const noopCallbacks: WidgetCallbacks = {
  onSubmit: () => {},
  onOpen: () => {},
  onClose: () => {},
  onScreenshotRequest: () => {},
};

const getShadow = (w: MushiWidget): ShadowRoot => (w as unknown as { shadow: ShadowRoot }).shadow;
const q = <T extends Element = HTMLElement>(w: MushiWidget, sel: string): T | null =>
  getShadow(w).querySelector<T>(sel);
const trigger = (w: MushiWidget) => q<HTMLButtonElement>(w, '.mushi-trigger');
/** sessionStorage key behind "Hide the bug button for this visit" (widget-helpers.ts). */
const LAUNCHER_DISMISSED_STORAGE_KEY = 'mushi-launcher-hidden';

/** Viewport width the stubbed matchMedia reports (only max-width queries are evaluated). */
function stubViewport(width: number): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn((query: string) => {
      const max = /max-width:\s*(\d+)px/.exec(query);
      return { matches: max ? width <= Number(max[1]) : false, addEventListener() {}, removeEventListener() {} };
    }),
  });
}

function rect(top: number, height: number, left = 0, width = window.innerWidth): DOMRect {
  return { top, height, left, width, bottom: top + height, right: left + width, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

/** A host element pinned to the viewport bottom that `document.elementsFromPoint` reports. */
function mountBottomBar(height: number, position = 'fixed', top = window.innerHeight - height): HTMLElement {
  const bar = document.createElement('nav');
  bar.style.position = position;
  bar.getBoundingClientRect = () => rect(top, height);
  document.body.appendChild(bar);
  const child = document.createElement('a');
  bar.appendChild(child);
  // jsdom has no layout, so hit-testing is stubbed: the bar's child is under every bottom pixel.
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    value: (_x: number, y: number) => (y >= top ? [child, bar, document.body, document.documentElement] : [document.body]),
  });
  return bar;
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

beforeEach(() => {
  stubViewport(1024);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete (document as unknown as Record<string, unknown>).elementsFromPoint;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('launcher shape', () => {
  it('draws the round FAB on desktop and a slim edge tab on phones', () => {
    const desk = new MushiWidget({}, noopCallbacks);
    desk.mount();
    expect(trigger(desk)!.classList.contains('edge-tab')).toBe(false);
    expect(q(desk, '.mushi-trigger-face')).toBeNull();
    desk.destroy();

    stubViewport(390);
    const phone = new MushiWidget({}, noopCallbacks);
    phone.mount();
    const t = trigger(phone)!;
    expect(t.classList.contains('edge-tab')).toBe(true);
    // Only the face is drawn; the button keeps its accessible name and glyph.
    expect(t.querySelector('.mushi-trigger-face')!.textContent).toBe('🐛');
    expect(t.getAttribute('aria-label')).toBeTruthy();
    expect(t.getAttribute('aria-haspopup')).toBe('dialog');
    phone.destroy();
  });

  it('keeps the FAB on phones with mobileTrigger: "auto", and never reshapes an explicit trigger', () => {
    stubViewport(390);
    const fab = new MushiWidget({ mobileTrigger: 'auto' }, noopCallbacks);
    fab.mount();
    expect(trigger(fab)!.classList.contains('edge-tab')).toBe(false);
    fab.destroy();

    // A host that placed the FAB itself keeps it, unless it opts in.
    for (const config of [{ inset: { right: 16 } }, { anchor: { left: '12px' } }, { draggable: true }]) {
      const placed = new MushiWidget(config, noopCallbacks);
      placed.mount();
      expect(trigger(placed)!.classList.contains('edge-tab')).toBe(false);
      placed.destroy();
    }
    const optIn = new MushiWidget({ inset: { right: 16 }, mobileTrigger: 'edge-tab' }, noopCallbacks);
    optIn.mount();
    expect(trigger(optIn)!.classList.contains('edge-tab')).toBe(true);
    optIn.destroy();
    // A word label doesn't fit a 22px face: auto keeps the FAB; an explicit tab reads it vertically.
    const label = new MushiWidget({ triggerText: 'Report bug' }, noopCallbacks);
    label.mount();
    expect(trigger(label)!.classList.contains('edge-tab')).toBe(false);
    label.destroy();
    const labelTab = new MushiWidget({ trigger: 'edge-tab', triggerText: 'Report bug' }, noopCallbacks);
    labelTab.mount();
    expect(trigger(labelTab)!.classList.contains('text')).toBe(true);
    labelTab.destroy();
    const glyph = new MushiWidget({ triggerText: '\u{1F41E}' }, noopCallbacks);
    glyph.mount();
    expect(trigger(glyph)!.classList.contains('edge-tab')).toBe(true);
    expect(trigger(glyph)!.classList.contains('text')).toBe(false);
    glyph.destroy();
    // A bottom offset alone (clearing a tab bar) is not a placement choice.
    const bottomOnly = new MushiWidget({ inset: { bottom: 96 } }, noopCallbacks);
    bottomOnly.mount();
    expect(trigger(bottomOnly)!.classList.contains('edge-tab')).toBe(true);
    bottomOnly.destroy();

    stubViewport(1440);
    const tab = new MushiWidget({ trigger: 'edge-tab' }, noopCallbacks);
    tab.mount();
    expect(trigger(tab)!.classList.contains('edge-tab')).toBe(true);
    tab.destroy();
  });

  it('switches shape when the viewport crosses the phone breakpoint', async () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    expect(trigger(w)!.classList.contains('edge-tab')).toBe(false);
    stubViewport(390);
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(trigger(w)!.classList.contains('edge-tab')).toBe(true);
    w.destroy();
  });
});

describe('fixed bottom bars', () => {
  it('lifts the launcher, and the panel with it, above a fixed tab bar', async () => {
    mountBottomBar(64);
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    await nextFrame();
    const clearance = 64 + 8;
    expect(trigger(w)!.style.getPropertyValue('--mushi-bottom'))
      .toBe(`max(calc(24px + env(safe-area-inset-bottom, 0px)), ${clearance}px)`);
    w.open();
    expect(q(w, '.mushi-panel')!.style.getPropertyValue('--mushi-bottom')).toContain(`${clearance}px`);
    w.destroy();
  });

  it('treats an explicit anchor or inset as the base and only raises it', async () => {
    mountBottomBar(64);
    const anchored = new MushiWidget({ anchor: { bottom: 'calc(80px + 1rem)', right: '8px' } }, noopCallbacks);
    anchored.mount();
    await nextFrame();
    expect(trigger(anchored)!.style.getPropertyValue('--mushi-bottom')).toBe('max(calc(80px + 1rem), 72px)');
    anchored.destroy();

    const inset = new MushiWidget({ inset: { bottom: 120 } }, noopCallbacks);
    inset.mount();
    await nextFrame();
    expect(trigger(inset)!.style.getPropertyValue('--mushi-bottom')).toBe('max(120px, 72px)');
    inset.destroy();
  });

  it('sticky bars count; full-height layers, static elements and avoidFixedBars: false do not', async () => {
    mountBottomBar(56, 'sticky');
    const sticky = new MushiWidget({}, noopCallbacks);
    sticky.mount();
    await nextFrame();
    expect(trigger(sticky)!.style.getPropertyValue('--mushi-bottom')).toContain('64px');
    sticky.destroy();

    for (const [height, position] of [[window.innerHeight, 'fixed'], [64, 'static']] as const) {
      document.body.innerHTML = '';
      mountBottomBar(height, position);
      const w = new MushiWidget({}, noopCallbacks);
      w.mount();
      await nextFrame();
      expect(trigger(w)!.style.getPropertyValue('--mushi-bottom')).toBe('');
      w.destroy();
    }

    document.body.innerHTML = '';
    mountBottomBar(64);
    const off = new MushiWidget({ avoidFixedBars: false }, noopCallbacks);
    off.mount();
    await nextFrame();
    expect(trigger(off)!.style.getPropertyValue('--mushi-bottom')).toBe('');
    off.destroy();
  });

  /**
   * Ionic / Capacitor shape: a fixed full-height shell, the tab bar a
   * normal-flow child at its bottom, and only <main> scrolls.
   */
  function mountShell(): { main: HTMLElement; dock: HTMLElement } {
    const H = window.innerHeight;
    const shell = document.createElement('div');
    shell.style.position = 'fixed';
    shell.getBoundingClientRect = () => rect(0, H);
    const main = document.createElement('main');
    main.style.overflowY = 'auto';
    main.getBoundingClientRect = () => rect(0, H - 64);
    const dock = document.createElement('nav');
    dock.getBoundingClientRect = () => rect(H - 64, 64);
    const tab = document.createElement('a');
    tab.getBoundingClientRect = () => rect(H - 64, 64, 0, 80);
    dock.appendChild(tab);
    shell.append(main, dock);
    document.body.appendChild(shell);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [tab, dock, shell, document.body, document.documentElement],
    });
    return { main, dock };
  }

  it('lifts above a tab bar that is a normal-flow child of a fixed app shell', async () => {
    mountShell();
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    await nextFrame();
    expect(trigger(w)!.style.getPropertyValue('--mushi-bottom')).toContain('72px');
    w.destroy();
  });

  it('does not lift for scrolling content that happens to end at the bottom', async () => {
    const { main } = mountShell();
    const card = document.createElement('div');
    card.getBoundingClientRect = () => rect(window.innerHeight - 120, 120);
    main.appendChild(card);
    // No tab bar: the bottom pixel is a card inside the scrolling <main>.
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: () => [card, main, main.parentElement!, document.body, document.documentElement],
    });
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    await nextFrame();
    expect(trigger(w)!.style.getPropertyValue('--mushi-bottom')).toBe('');
    w.destroy();
  });

  it('drops the lift when the bar goes away', async () => {
    const bar = mountBottomBar(64);
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    await nextFrame();
    expect(trigger(w)!.style.getPropertyValue('--mushi-bottom')).not.toBe('');
    bar.remove();
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [document.body] });
    window.dispatchEvent(new Event('resize'));
    await nextFrame();
    expect(trigger(w)!.style.getPropertyValue('--mushi-bottom')).toBe('');
    w.destroy();
  });
});

describe('stylesheet', () => {
  const css = getWidgetStyles('light');

  it('keeps the edge tab flush with the edge inside the safe area', () => {
    expect(css).toMatch(/\.mushi-trigger\.edge-tab\.bottom-right,\s*\.mushi-trigger\.edge-tab\.top-right\s*\{\s*right: calc\(var\(--mushi-safe-area, 1\) \* env\(safe-area-inset-right, 0px\)\);/);
    expect(css).toMatch(/\.mushi-trigger\.edge-tab\.bottom-left,\s*\.mushi-trigger\.edge-tab\.top-left\s*\{\s*left: calc\(var\(--mushi-safe-area, 1\) \* env\(safe-area-inset-left, 0px\)\);/);
    // Bottom placement still clears the home indicator.
    expect(css).toContain('bottom: var(--mushi-bottom, calc(24px + env(safe-area-inset-bottom, 0px)));');
  });

  it('draws a 22px face inside a 44px tap area', () => {
    expect(css).toMatch(/\.mushi-trigger\.edge-tab \{\s*width: 44px;\s*height: 48px;\s*background: transparent;/);
    expect(css).toMatch(/\.mushi-trigger-face \{[^}]*width: 22px;/);
  });

  it('stops the pulsing dot and the tuck slide under reduced motion', () => {
    const reduced = css.split('@media (prefers-reduced-motion: reduce)').slice(1).join('');
    expect(reduced).toContain('.mushi-trigger::after { animation: none; }');
    expect(reduced).toContain('.mushi-trigger.edge-tab.tucked .mushi-trigger-face { transform: none !important; }');
  });
});

describe('scroll tuck', () => {
  it('tucks the same element while anything scrolls, then brings it back', () => {
    vi.useFakeTimers();
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    const t = trigger(w)!;
    const inner = document.createElement('div');
    document.body.appendChild(inner);
    // Inner scroll containers count: scroll doesn't bubble, the listener captures.
    inner.dispatchEvent(new Event('scroll'));
    expect(t.classList.contains('tucked')).toBe(true);
    expect(trigger(w)).toBe(t);
    vi.advanceTimersByTime(700);
    expect(t.classList.contains('tucked')).toBe(false);
    w.destroy();
  });

  it('never tucks a focused launcher, an open panel, or with tuckOnScroll: false', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    trigger(w)!.focus();
    document.dispatchEvent(new Event('scroll'));
    expect(trigger(w)!.classList.contains('tucked')).toBe(false);
    trigger(w)!.blur();
    w.open();
    document.dispatchEvent(new Event('scroll'));
    expect(trigger(w)!.classList.contains('tucked')).toBe(false);
    w.destroy();

    const off = new MushiWidget({ tuckOnScroll: false }, noopCallbacks);
    off.mount();
    document.dispatchEvent(new Event('scroll'));
    expect(trigger(off)!.classList.contains('tucked')).toBe(false);
    off.destroy();
  });

  it('stops listening on destroy', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    const t = trigger(w)!;
    w.destroy();
    document.dispatchEvent(new Event('scroll'));
    expect(t.classList.contains('tucked')).toBe(false);
  });
});

describe('edge tab drag', () => {
  /**
   * Give launchers a layout box (jsdom has none) so moveFab can clamp: the
   * CSS anchor puts the tab at top 600, and the applied drag offset moves it,
   * as a real layout would.
   */
  function layout(): void {
    const real = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains('mushi-trigger')) return real.call(this);
      const active = this.style.getPropertyValue('--mushi-drag-active') === '1';
      const dy = active ? parseFloat(this.style.getPropertyValue('--mushi-drag-y')) || 0 : 0;
      return rect(600 + dy, 48, window.innerWidth - 44, 44);
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(44);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(48);
  }
  beforeEach(layout);
  function drag(t: HTMLElement, dx: number, dy: number): void {
    const at = (type: string, x: number, y: number) =>
      t.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
    at('pointerdown', 1000, 620);
    at('pointermove', 1000 + dx, 620 + dy);
    at('pointerup', 1000 + dx, 620 + dy);
  }

  it('moves along its edge only and remembers the spot for the site', () => {
    const w = new MushiWidget({ trigger: 'edge-tab' }, noopCallbacks);
    w.mount();
    const t = trigger(w)!;

    drag(t, -300, -100);
    expect(t.style.getPropertyValue('--mushi-drag-x')).toBe('0px');
    expect(t.style.getPropertyValue('--mushi-drag-y')).toBe('-100px');
    expect(JSON.parse(localStorage.getItem('mushi_tab_pos')!)).toEqual({ x: 0, y: -100 });
    // The FAB keeps its own position.
    expect(localStorage.getItem('mushi_fab_pos')).toBeNull();
    w.destroy();

    const again = new MushiWidget({ trigger: 'edge-tab' }, noopCallbacks);
    again.mount();
    expect(trigger(again)!.style.getPropertyValue('--mushi-drag-y')).toBe('-100px');
    again.destroy();
  });

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const w = new MushiWidget({ trigger: 'edge-tab' }, noopCallbacks);
    expect(() => w.mount()).not.toThrow();
    const t = trigger(w)!;

    expect(() => drag(t, 0, -80)).not.toThrow();
    expect(t.style.getPropertyValue('--mushi-drag-y')).toBe('-80px');
    w.destroy();
  });

  it('stays pinned with an explicit draggable: false; the FAB stays opt-in', () => {
    for (const config of [{ trigger: 'edge-tab' as const, draggable: false }, { trigger: 'auto' as const }]) {
      const w = new MushiWidget(config, noopCallbacks);
      w.mount();
      const t = trigger(w)!;
      drag(t, 0, -100);
      expect(t.style.getPropertyValue('--mushi-drag-y')).toBe('');
      w.destroy();
    }
  });

  it('never drags below a detected bottom bar', async () => {
    mountBottomBar(64);
    const w = new MushiWidget({ trigger: 'edge-tab' }, noopCallbacks);
    w.mount();
    await nextFrame();
    const t = trigger(w)!;

    drag(t, 0, 400);
    // Bottom edge of the tab: 600 + 48 + y must stay at or above innerHeight - 72.
    const y = parseFloat(t.style.getPropertyValue('--mushi-drag-y'));
    expect(600 + 48 + y).toBeLessThanOrEqual(window.innerHeight - 72);
    w.destroy();
  });
});

describe('hide for this visit', () => {
  it('hides the launcher until the tab closes, even through host show() calls', () => {
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    const hide = q<HTMLButtonElement>(w, '[data-action="hide-launcher"]')!;
    expect(hide.textContent).toBe('Hide the bug button for this visit');
    hide.click();
    expect(w.getIsOpen()).toBe(false);
    expect(trigger(w)).toBeNull();
    expect(sessionStorage.getItem(LAUNCHER_DISMISSED_STORAGE_KEY)).toBe('1');
    expect(w.getWidgetDiagnostics().widgetSuppressed).toBe(true);
    // Mushi.open() still works without the launcher.
    w.open();
    expect(w.getIsOpen()).toBe(true);
    w.close();
    w.destroy();

    const nextPage = new MushiWidget({}, noopCallbacks);
    nextPage.mount();
    expect(trigger(nextPage)).toBeNull();
    // Hosts call show() on routine paths (glot.it: after every overlay closes).
    nextPage.showTrigger();
    expect(trigger(nextPage)).toBeNull();
    expect(sessionStorage.getItem(LAUNCHER_DISMISSED_STORAGE_KEY)).toBe('1');
    nextPage.destroy();

    // A new tab starts with an empty sessionStorage: the launcher is back.
    sessionStorage.clear();
    const newTab = new MushiWidget({}, noopCallbacks);
    newTab.mount();
    expect(trigger(newTab)).not.toBeNull();
    newTab.destroy();
  });

  it('is offered only for a visible floating launcher the host lets visitors hide', () => {
    for (const config of [{ dismissible: false }, { trigger: 'manual' as const }, { trigger: 'banner' as const }]) {
      const w = new MushiWidget(config, noopCallbacks);
      w.mount();
      w.open();
      expect(q(w, '[data-action="hide-launcher"]')).toBeNull();
      w.destroy();
    }
  });

  it('still hides for this page when sessionStorage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    const w = new MushiWidget({}, noopCallbacks);
    w.mount();
    w.open();
    expect(() => q<HTMLButtonElement>(w, '[data-action="hide-launcher"]')!.click()).not.toThrow();
    expect(trigger(w)).toBeNull();
    w.destroy();
  });
});
