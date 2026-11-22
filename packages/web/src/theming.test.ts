/**
 * Theming safety nets: `hideOnRoutes` globs and the contrast guard on the
 * accent's text colour (config, script tag or host CSS).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MushiWidget, type WidgetCallbacks } from './widget';
import { routeMatches } from './widget-helpers';

function callbacks(onWarning = vi.fn()): WidgetCallbacks {
  return { onSubmit: () => {}, onOpen: () => {}, onClose: () => {}, onScreenshotRequest: () => {}, onWarning };
}

function css(w: MushiWidget): string {
  return (w as unknown as { shadow: ShadowRoot }).shadow.querySelector('style')?.textContent ?? '';
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
});

afterEach(() => {
  history.replaceState(null, '', '/');
  const root = document.documentElement.style;
  root.removeProperty('--mushi-accent');
  root.removeProperty('--mushi-accent-fg');
});

describe('routeMatches', () => {
  it.each([
    // [pathname, entry, hidden]
    ['/checkout', '/checkout', true],
    ['/checkout/done', '/checkout', true], // no `*`: substring, as before
    ['/shop/checkout', '/checkout', true],
    ['/admin/users', '/admin/*', true],
    ['/admin/users/', '/admin/*', true], // a trailing slash is ignored
    ['/admin', '/admin/*', false],
    ['/admin/users/5', '/admin/*', false], // `*` is one segment
    ['/blog', '/blog/**', true], // trailing `/**` covers the path itself
    ['/blog/2026/11/post', '/blog/**', true],
    ['/blogroll', '/blog/**', false],
    ['/docs/a/edit', '/docs/*/edit', true],
    ['/docs/a/b/edit', '/docs/**/edit', true],
    ['/x.y', '/x.*', true],
    ['/xzy', '/x.*', false], // regex characters are literal
    ['/', '/*', true],
  ])('%s against %s → %s', (pathname, entry, hidden) => {
    expect(routeMatches(pathname, entry)).toBe(hidden);
  });
});

describe('hideOnRoutes in the widget', () => {
  it('hides the launcher on a glob match and shows it elsewhere', () => {
    const w = new MushiWidget({ hideOnRoutes: ['/admin/*'] }, callbacks());
    w.mount();
    history.replaceState(null, '', '/admin/users');
    expect(w.getWidgetDiagnostics().widgetSuppressed).toBe(true);
    history.replaceState(null, '', '/admin/users/5');
    expect(w.getWidgetDiagnostics().widgetSuppressed).toBe(false);
    w.destroy();
  });

  it('keeps substring entries working', () => {
    const w = new MushiWidget({ hideOnRoutes: ['checkout'] }, callbacks());
    w.mount();
    history.replaceState(null, '', '/shop/checkout/pay');
    expect(w.getWidgetDiagnostics().widgetSuppressed).toBe(true);
    w.destroy();
  });
});

describe('contrast guard on the accent text', () => {
  it('keeps the host accentText when it reads at 3:1 or better', () => {
    const onWarning = vi.fn();
    const w = new MushiWidget({ accent: '#112233', accentText: '#ffffff' }, callbacks(onWarning));
    w.mount();
    expect(css(w)).toContain('--_accent-fg: var(--mushi-accent-fg, #ffffff)');
    expect(w.getWidgetDiagnostics().warnings).toEqual([]);
    expect(onWarning).not.toHaveBeenCalled();
    w.destroy();
  });

  it('picks black or white when no accentText is given', () => {
    const w = new MushiWidget({ accent: '#ffeb3b' }, callbacks());
    w.mount();
    expect(css(w)).toContain('--_accent-fg: var(--mushi-accent-fg, black)');
    expect(w.getWidgetDiagnostics().warnings).toEqual([]);
    w.destroy();
  });

  it('replaces unreadable config accentText, keeps the accent, and records a warning', () => {
    const onWarning = vi.fn();
    const w = new MushiWidget({ accent: '#ffeb3b', accentText: '#ffffff' }, callbacks(onWarning));
    w.mount();
    const styles = css(w);
    expect(styles).toContain('--_accent: var(--mushi-accent, #ffeb3b)'); // hue untouched
    expect(styles).toContain('--_accent-fg: black;');
    const { warnings } = w.getWidgetDiagnostics();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/#ffffff is 1\.\d:1 on #ffeb3b \(under 3:1\); using black/);
    expect(onWarning).toHaveBeenCalledWith(warnings[0]);
    w.destroy();
  });

  it('guards a host --mushi-accent / --mushi-accent-fg pair set in CSS', () => {
    const root = document.documentElement.style;
    root.setProperty('--mushi-accent', '#1a1a1a');
    root.setProperty('--mushi-accent-fg', '#333333');
    const w = new MushiWidget({}, callbacks());
    w.mount();
    const styles = css(w);
    expect(styles).toContain('--_accent: var(--mushi-accent, #1a1a1a)');
    expect(styles).toContain('--_accent-fg: white;'); // overrides the unreadable host value
    expect(w.getWidgetDiagnostics().warnings[0]).toContain('#333333');
    w.destroy();
  });

  it('a host --mushi-accent alone gets readable text instead of the panel colour', () => {
    document.documentElement.style.setProperty('--mushi-accent', '#ffeb3b');
    const w = new MushiWidget({}, callbacks());
    w.mount();
    expect(css(w)).toContain('--_accent-fg: var(--mushi-accent-fg, black)');
    w.destroy();
  });
});
