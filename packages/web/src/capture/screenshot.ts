import type { MushiPrivacyConfig } from '@mushi-mushi/core';

export interface ScreenshotCapture {
  take(): Promise<string | null>;
  updateOptions(options: ScreenshotCaptureOptions): void;
}

export interface ScreenshotCaptureOptions {
  privacy?: MushiPrivacyConfig;
  /** Callback invoked when capture fails (taint, security policy, etc.). */
  onFailed?: (reason: ScreenshotFailureReason) => void;
}

/**
 * Why a capture produced no image. Also the `detail.reason` of the
 * `mushi:screenshot_failed` document event.
 * - taint: cross-origin content made the canvas unreadable
 * - timeout: the SVG never loaded or errored within 5 s
 * - unsupported: no 2D canvas, or the engine rasterised nothing (WebKit)
 * - csp: the host's Content-Security-Policy img-src blocks data: images
 * - error: anything else
 */
export type ScreenshotFailureReason = 'taint' | 'timeout' | 'unsupported' | 'csp' | 'error';

export function createScreenshotCapture(options: ScreenshotCaptureOptions = {}): ScreenshotCapture {
  let activeOptions = options;

  async function take(): Promise<string | null> {
    try {
      if (typeof document === 'undefined') return null;

      const canvas = document.createElement('canvas');
      // isCanvasBlank reads pixels back; this hint keeps Chrome from warning
      // about (and slowing down) repeated getImageData readbacks.
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        activeOptions.onFailed?.('unsupported');
        emitScreenshotFailed('unsupported');
        return null;
      }

      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Capture via SVG foreignObject — strips cross-origin media + CSS URL refs
      // so the canvas never becomes tainted by external resources.
      const safeDocument = buildPrivacySafeDocument(activeOptions.privacy);
      const svgData = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml">
              ${new XMLSerializer().serializeToString(safeDocument)}
            </div>
          </foreignObject>
        </svg>
      `;

      // data: URL, never blob:. Chrome (verified on 154) taints the canvas when
      // a foreignObject SVG arrives via a blob: URL, so toDataURL threw on every
      // capture; the same SVG as a data: URL exports cleanly (the approach
      // html-to-image uses). It also passes CSPs whose img-src allows data: but
      // not blob:. A CSP that blocks data: too is reported as 'csp'.
      const img = new Image();
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
      let cspBlocked = false;
      const onViolation = (e: Event) => {
        const v = e as SecurityPolicyViolationEvent;
        if (/^img-src|^default-src/.test(v.violatedDirective ?? '') && /^data/.test(v.blockedURI ?? '')) cspBlocked = true;
      };
      document.addEventListener('securitypolicyviolation', onViolation);

      return new Promise((resolve) => {
        let settled = false;
        const settle = (value: string | null, reason?: ScreenshotFailureReason) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          document.removeEventListener('securitypolicyviolation', onViolation);
          if (reason) {
            activeOptions.onFailed?.(reason);
            emitScreenshotFailed(reason);
          }
          resolve(value);
        };
        // WebKit can leave the SVG image in limbo (neither load nor error) for
        // pathological documents — never let the report submit hang on it.
        const timer = setTimeout(() => settle(null, 'timeout'), 5000);

        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, width, height);
            // Safari/WebKit sometimes "loads" a foreignObject SVG but rasterises
            // nothing. A fully transparent canvas would export as a solid black
            // JPEG — report failure instead of attaching a useless image.
            if (isCanvasBlank(ctx, width, height)) {
              settle(null, 'unsupported');
              return;
            }
            settle(canvas.toDataURL('image/jpeg', 0.7));
          } catch {
            // Canvas tainted — return null so the report is submitted without a
            // screenshot rather than with a misleading gray placeholder.
            settle(null, 'taint');
          }
        };
        // The CSP violation event and the image error are separate queued
        // tasks with no guaranteed order — settle one task later so a
        // policy block is reported as 'csp', not a generic failure.
        img.onerror = () => setTimeout(() => settle(null, cspBlocked ? 'csp' : 'error'), 0);
        img.src = url;
      });
    } catch {
      activeOptions.onFailed?.('error');
      emitScreenshotFailed('error');
      return null;
    }
  }

  return {
    take,
    updateOptions(nextOptions) {
      activeOptions = nextOptions;
    },
  };
}

/** Dispatch a CustomEvent on document so host apps can react to capture failures. */
function emitScreenshotFailed(reason: ScreenshotFailureReason): void {
  try {
    document.dispatchEvent(new CustomEvent('mushi:screenshot_failed', { detail: { reason }, bubbles: false }));
  } catch {
    // Silently ignore if CustomEvent is not available (SSR/test env)
  }
}

/**
 * Always blacked out of every screenshot — DOM capture and tab share alike —
 * before any pixel is produced. `redactSelectors` adds to this list and can't
 * remove from it: a host passing its own list used to drop password redaction.
 */
/**
 * CSS animations do not run inside an SVG rendered through <img>: an element
 * with an entrance animation (fade-in from opacity 0, for example) is painted
 * at its first keyframe. On pages that animate their content in, the whole
 * capture came out transparent and was reported as 'unsupported'. Appended
 * last, after the inlined page CSS, so it wins; the capture then shows the
 * settled page the reporter is looking at.
 */
export const FREEZE_ANIMATIONS_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important}';

function freezeAnimations(clone: Element): void {
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-mushi-freeze', '');
  styleEl.textContent = FREEZE_ANIMATIONS_CSS;
  (clone.querySelector('head') ?? clone).appendChild(styleEl);
}

export const ALWAYS_REDACT_SELECTORS ='input[type="password"],input[autocomplete^="cc-"],[data-private],[data-mushi-mask]';
const DEFAULT_REDACT_SELECTORS: readonly string[] = ['[data-mushi-redact]'];

function buildPrivacySafeDocument(privacy?: MushiPrivacyConfig): Element {
  const clone = document.documentElement.cloneNode(true) as Element;

  // The SDK host is a zero-size pass-through shell — strip it from the
  // SVG foreignObject serialisation so capture doesn't fail on shadow DOM.
  clone.querySelector('#mushi-mushi-widget')?.remove();
  stripTaintSources(clone);
  inlineDocumentStyles(clone);
  freezeAnimations(clone);

  // Redact: black-out matching elements, before mask/block. The always-on
  // baseline (passwords, card fields, [data-private], [data-mushi-mask]) runs
  // first; `redactSelectors` replaces only the [data-mushi-redact] default.
  const redactSelectors: readonly string[] = [
    ALWAYS_REDACT_SELECTORS,
    ...(privacy?.redactSelectors ?? DEFAULT_REDACT_SELECTORS),
  ];

  for (const selector of redactSelectors) {
    for (const el of safeQueryAll(clone, selector)) {
      redactElement(el as HTMLElement);
    }
  }

  for (const selector of privacy?.blockSelectors ?? []) {
    for (const el of safeQueryAll(clone, selector)) {
      el.remove();
    }
  }

  for (const selector of privacy?.maskSelectors ?? []) {
    for (const el of safeQueryAll(clone, selector)) {
      maskElement(el as HTMLElement);
    }
  }

  return clone;
}

function safeQueryAll(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function redactElement(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = '';
    el.setAttribute('value', '');
  }
  el.textContent = '';
  el.setAttribute(
    'style',
    `${el.getAttribute('style') ?? ''};background:#000!important;color:#000!important;text-shadow:none!important;border-color:#000!important;`,
  );
  el.setAttribute('data-mushi-redacted', 'true');
  // Remove child nodes so no text nodes leak through the SVG serialiser
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Remove embedded media and cross-origin CSS asset references that taint canvas export. */
function stripTaintSources(root: Element): void {
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';

  // Remove all media elements — they reliably taint the canvas.
  for (const el of root.querySelectorAll('img, video, iframe, object, embed, picture')) {
    el.remove();
  }

  // Remove ALL external stylesheets. An SVG rendered through <img> runs in
  // secure static mode and cannot fetch any subresource — even same-origin
  // <link> sheets never load there. Their rules are re-injected as inline
  // <style> text by inlineDocumentStyles() instead.
  for (const link of root.querySelectorAll('link[rel="stylesheet"], link[as="style"]')) {
    link.remove();
  }

  // Strip cross-origin url() references from <style> content.
  for (const styleEl of root.querySelectorAll('style')) {
    const cleaned = stripCssUrlRefs(styleEl.textContent ?? '', pageOrigin);
    if (cleaned !== styleEl.textContent) styleEl.textContent = cleaned;
  }

  // Strip cross-origin url() references from inline style attributes.
  for (const el of root.querySelectorAll('[style]')) {
    const s = el.getAttribute('style');
    if (!s) continue;
    const cleaned = stripCssUrlRefs(s, pageOrigin);
    if (cleaned !== s) el.setAttribute('style', cleaned);
  }

  for (const script of root.querySelectorAll('script')) {
    script.remove();
  }
}

/**
 * Replace cross-origin url() references in a CSS string with `none` so the
 * browser never fetches an external resource that would taint the canvas.
 */
function stripCssUrlRefs(css: string, pageOrigin: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_match, _q, href) => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return _match;
    if (isCrossOriginUrl(trimmed, pageOrigin)) return 'none';
    return _match;
  });
}

/**
 * Re-inject the page's stylesheet rules as one inline <style> block. The live
 * page has them in <link> sheets (and constructable adoptedStyleSheets), but
 * the SVG-in-<img> capture path loads zero subresources, so without this the
 * capture renders unstyled. Same-origin (and CORS-enabled) sheets expose
 * cssRules via CSSOM with no network fetch; unreadable ones are skipped.
 */
function inlineDocumentStyles(clone: Element): void {
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
  const chunks: string[] = [];
  const sheets: CSSStyleSheet[] = [
    ...Array.from(document.styleSheets),
    ...(document.adoptedStyleSheets ?? []),
  ];
  for (const sheet of sheets) {
    const owner = sheet.ownerNode;
    // Inline <style> elements are already present in the clone.
    if (owner instanceof Element && owner.tagName === 'STYLE') continue;
    chunks.push(serializeSheet(sheet));
  }
  const css = stripCssUrlRefs(chunks.filter(Boolean).join('\n'), pageOrigin);
  if (!css) return;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  (clone.querySelector('head') ?? clone).appendChild(styleEl);
}

function serializeSheet(sheet: CSSStyleSheet): string {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules; // throws for cross-origin sheets without CORS
  } catch {
    return '';
  }
  let text = '';
  for (const rule of Array.from(rules)) {
    // Expand @import inline — the imported sheet will never be fetched.
    if (rule instanceof CSSImportRule) {
      if (rule.styleSheet) text += serializeSheet(rule.styleSheet);
      continue;
    }
    text += `${rule.cssText}\n`;
  }
  return text;
}

/**
 * WebKit sometimes fires `load` for a foreignObject SVG but rasterises nothing.
 * Sample the canvas on a coarse grid; a fully transparent bitmap means the
 * draw silently produced nothing.
 */
function isCanvasBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    // Probe a coarse grid of single pixels instead of copying the whole
    // bitmap — a full-viewport getImageData allocates megabytes on the
    // report-submit path just to answer "did anything draw?".
    const stepX = Math.max(1, Math.floor(width / 8));
    const stepY = Math.max(1, Math.floor(height / 8));
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        if (ctx.getImageData(x, y, 1, 1).data[3] !== 0) return false;
      }
    }
    return true;
  } catch {
    // Tainted canvas — let toDataURL raise the taint path instead.
    return false;
  }
}

function isCrossOriginUrl(raw: string, pageOrigin: string): boolean {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return false;
  try {
    const resolved = new URL(raw, typeof location !== 'undefined' ? location.href : 'http://localhost/');
    return Boolean(pageOrigin) && resolved.origin !== pageOrigin;
  } catch {
    return true;
  }
}



function maskElement(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = '';
    el.setAttribute('value', '');
    el.setAttribute('placeholder', '••••');
  }
  el.textContent = el.children.length === 0 ? '••••' : el.textContent;
  el.setAttribute(
    'style',
    `${el.getAttribute('style') ?? ''};background:#8f8f8f!important;color:transparent!important;text-shadow:none!important;`,
  );
  el.setAttribute('data-mushi-masked', 'true');
}
