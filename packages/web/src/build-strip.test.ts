/**
 * Guards the tsup plugin that strips CSS comments and template indentation
 * from styles.ts / widget-render.ts at build time (size budget). The source is
 * what every other test exercises, so this test bundles both files WITH the
 * plugin and checks the shipped output matches the source output once comments
 * and whitespace are normalized — a future `//` comment containing `/*`, or a
 * whitespace-sensitive template, would otherwise break only the published build.
 */
import { createRequire } from 'node:module';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import { describe, it, expect, vi } from 'vitest';
import { getWidgetStyles } from './styles';
import { renderStep } from './widget-render';
import { MushiWidget, type WidgetCallbacks } from './widget';

const require = createRequire(import.meta.url);
// esbuild's invariant check rejects jsdom's TextEncoder (cross-realm Uint8Array).
class SameRealmTextEncoder extends NodeTextEncoder {
  encode(input?: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(super.encode(input));
  }
}
globalThis.TextEncoder = SameRealmTextEncoder as unknown as typeof TextEncoder;
globalThis.TextDecoder = NodeTextDecoder as unknown as typeof TextDecoder;
/** The slice of esbuild this test uses (it is tsup's dependency, not ours). */
type EsbuildLike = {
  build(opts: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
};
const loadEsbuild = () =>
  require(require.resolve('esbuild', { paths: [require.resolve('tsup')] })) as EsbuildLike;

async function bundleWithPlugin<T>(entry: string): Promise<T> {
  // Imported late: tsup.config loads tsup (and esbuild) at module scope.
  const { stripShippedTemplateWhitespace } = await import('../tsup.config');
  const result = await loadEsbuild().build({
    entryPoints: [new URL(entry, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    external: ['@mushi-mushi/core'],
    plugins: [stripShippedTemplateWhitespace],
  });
  const mod = { exports: {} as T };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const ws = (html: string) => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

describe('build-time template whitespace strip', () => {
  it('ships the same stylesheet minus comments and insignificant whitespace', async () => {
    const { minifyCssText } = await import('../tsup.config');
    const built = await bundleWithPlugin<{ getWidgetStyles: typeof getWidgetStyles }>('./styles.ts');
    for (const theme of ['light', 'dark', 'auto'] as const) {
      for (const accent of ['', '#ff5500']) {
        const source = getWidgetStyles(theme, accent, '');
        const out = built.getWidgetStyles(theme, accent, '');
        // Equal once both are in canonical whitespace form: the build only
        // removes comments and whitespace, never a rule or a value.
        expect(minifyCssText(out)).toBe(minifyCssText(source.replace(/\/\*[\s\S]*?\*\//g, '')));
        expect(out).not.toContain('/*');
        expect(out.length).toBeLessThan(source.length * 0.85);
      }
    }
  });

  it('the template scanner leaves expressions, strings and comments alone', async () => {
    const { mapTemplateText } = await import('../tsup.config');
    const src = "const a = 'x  y'; // it's `odd`\nconst b = `p  q ${c ? `n  m` : '{ }'} r  s`;";
    const out = mapTemplateText(src, (t) => t.replace(/\s+/g, ' '));
    expect(out).toBe("const a = 'x  y'; // it's `odd`\nconst b = `p q ${c ? `n m` : '{ }'} r s`;");
  });

  it('ships the same panel markup, whitespace aside', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true, configurable: true, value: vi.fn().mockReturnValue({ matches: false }),
    });
    const built = await bundleWithPlugin<{ renderStep: typeof renderStep }>('./widget-render.ts');
    const cb: WidgetCallbacks = {
      onSubmit: () => {}, onOpen: () => {}, onClose: () => {}, onScreenshotRequest: () => {},
      onReporterReportsRequest: () => Promise.resolve([]),
    };
    const w = new MushiWidget({ betaMode: { enabled: true, appName: 'Demo' } }, cb);
    w.mount();
    const ctxOf = () => (w as unknown as { renderCtx(): Parameters<typeof renderStep>[0] }).renderCtx();
    const steps: Array<() => void> = [
      () => w.open(),
      () => { w.close(); w.open({ category: 'bug' }); },
      () => { w.close(); w.open({ featureRequest: true }); w.setScreenshotError(true, 'csp'); },
    ];
    for (const go of steps) {
      go();
      const ctx = { ...ctxOf(), submittedAt: new Date(0) };
      expect(ws(built.renderStep(ctx))).toBe(ws(renderStep(ctx)));
      for (const step of ['success', 'report-detail', 'reports', 'account'] as const) {
        expect(ws(built.renderStep({ ...ctx, step }))).toBe(ws(renderStep({ ...ctx, step })));
      }
    }
    w.destroy();
  });
});
