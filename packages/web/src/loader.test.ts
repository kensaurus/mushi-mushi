import { describe, expect, it, vi } from 'vitest';
import { readConfigFromDataset } from './loader-config';

const creds = { project: 'proj_1', key: 'mushi_1' };

function parse(extra: Record<string, string>) {
  const warn = vi.fn();
  const config = readConfigFromDataset({ ...creds, ...extra }, warn);
  return { config, widget: config?.widget, warn };
}

describe('script tag loader: data-* attributes', () => {
  it('does nothing without data-project and data-key', () => {
    expect(readConfigFromDataset({ project: 'proj_1' }, vi.fn())).toBeNull();
    expect(readConfigFromDataset({ key: 'k', project: '  ' }, vi.fn())).toBeNull();
  });

  it('keeps today\'s attributes working', () => {
    const { config, warn } = parse({
      trigger: 'banner',
      theme: 'dark',
      position: 'bottom-left',
      triggerText: 'Feedback',
      bannerVariant: 'brand',
      bannerPosition: 'bottom',
      endpoint: 'https://mushi.example.com/functions/v1/api',
      debug: 'true',
    });
    expect(config).toEqual({
      projectId: 'proj_1',
      apiKey: 'mushi_1',
      apiEndpoint: 'https://mushi.example.com/functions/v1/api',
      debug: true,
      widget: {
        trigger: 'banner',
        theme: 'dark',
        position: 'bottom-left',
        triggerText: 'Feedback',
        bannerConfig: { variant: 'brand', position: 'bottom' },
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads data-accent in every supported colour syntax', () => {
    for (const accent of ['#e03c2c', '#0af', 'rgb(224 60 44)', 'rgba(224, 60, 44, 1)', 'hsl(5deg 75% 52%)', 'oklch(0.62 0.2 30)']) {
      const { widget, warn } = parse({ accent });
      expect(widget?.accent).toBe(accent);
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it('reads data-accent-text, including black and white', () => {
    expect(parse({ accentText: '#000' }).widget?.accentText).toBe('#000');
    expect(parse({ accentText: 'white' }).widget?.accentText).toBe('white');
  });

  it('drops a bad colour with one warning that names the attribute and the accepted values', () => {
    for (const accent of ['red', '#12345', 'url(x)', 'rgb(1,2,3);}body{display:none', 'var(--brand)']) {
      const { widget, warn } = parse({ accent });
      expect(widget?.accent).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('data-accent=');
      expect(warn.mock.calls[0][0]).toContain('#rrggbb');
    }
    const { warn } = parse({ accentText: 'pink' });
    expect(warn.mock.calls[0][0]).toContain('data-accent-text="pink"');
  });

  it('reads data-locale for supported languages only', () => {
    expect(parse({ locale: 'ja' }).widget?.locale).toBe('ja');
    expect(parse({ locale: 'es-MX' }).widget?.locale).toBe('es-MX');
    expect(parse({ locale: 'AUTO' }).widget?.locale).toBe('auto');
    const { widget, warn } = parse({ locale: 'klingon' });
    expect(widget).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/data-locale="klingon".*auto, en, ja/);
  });

  it('splits data-hide-on-routes on commas', () => {
    expect(parse({ hideOnRoutes: '/admin/*, /checkout ,, /blog/**' }).widget?.hideOnRoutes).toEqual([
      '/admin/*',
      '/checkout',
      '/blog/**',
    ]);
    const { widget, warn } = parse({ hideOnRoutes: ' , ' });
    expect(widget).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('validates every enum, case-insensitively, and warns once per bad attribute', () => {
    expect(parse({ theme: 'Dark' }).widget?.theme).toBe('dark');
    const { config, warn } = parse({
      trigger: 'popup',
      theme: 'purple',
      position: 'middle',
      bannerVariant: 'loud',
      bannerPosition: 'left',
      endpoint: 'mushi.example.com',
      debug: 'yes',
    });
    expect(config).toEqual({ projectId: 'proj_1', apiKey: 'mushi_1' });
    expect(warn).toHaveBeenCalledTimes(7);
    const messages = warn.mock.calls.map((c) => c[0] as string);
    expect(messages[0]).toBe('Ignored data-trigger="popup". Use one of: auto, banner, edge-tab, attach, manual, hidden.');
    expect(messages).toContainEqual(expect.stringContaining('data-banner-variant="loud"'));
    expect(messages).toContainEqual(expect.stringContaining('data-endpoint='));
  });

  it('never throws, even when console.warn does', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
      throw new Error('console is broken');
    });
    try {
      expect(() => readConfigFromDataset({ ...creds, theme: 'nope' })).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
