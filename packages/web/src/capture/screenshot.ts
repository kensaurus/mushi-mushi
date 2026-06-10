import type { MushiPrivacyConfig } from '@mushi-mushi/core';

export interface ScreenshotCapture {
  take(): Promise<string | null>;
  updateOptions(options: ScreenshotCaptureOptions): void;
}

export interface ScreenshotCaptureOptions {
  privacy?: MushiPrivacyConfig;
}

export function createScreenshotCapture(options: ScreenshotCaptureOptions = {}): ScreenshotCapture {
  let activeOptions = options;

  async function take(): Promise<string | null> {
    try {
      if (typeof document === 'undefined') return null;

      // Prefer native getDisplayMedia if available (requires user gesture)
      // Fall back to simple canvas-based capture of visible viewport
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Capture via SVG foreignObject — works for most DOM content
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

      const img = new Image();
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      return new Promise((resolve) => {
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, width, height);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          } catch {
            URL.revokeObjectURL(url);
            // Cross-origin paints taint the canvas — fall back to a fresh
            // canvas so reports still carry a degraded viewport receipt.
            resolve(buildDegradedScreenshot(width, height));
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(buildDegradedScreenshot(width, height));
        };
        img.src = url;
      });
    } catch {
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

const DEFAULT_REDACT_SELECTORS: readonly string[] = [
  'input[type="password"]',
  '[data-mushi-redact]',
];

function buildPrivacySafeDocument(privacy?: MushiPrivacyConfig): Element {
  const clone = document.documentElement.cloneNode(true) as Element;

  // The SDK host is a zero-size pass-through shell — strip it from the
  // SVG foreignObject serialisation so capture doesn't fail on shadow DOM.
  clone.querySelector('#mushi-mushi-widget')?.remove();
  stripTaintSources(clone);

  // Redact: black-out matching elements. Applied before mask/block so that
  // password fields are always blacked out even if not explicitly listed
  // in maskSelectors. Pass an empty array to `redactSelectors` to opt out.
  const redactSelectors: readonly string[] = privacy?.redactSelectors !== undefined
    ? privacy.redactSelectors
    : DEFAULT_REDACT_SELECTORS;

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

/** Remove embedded media / cross-origin assets that taint canvas export. */
function stripTaintSources(root: Element): void {
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';
  for (const el of root.querySelectorAll('img, video, iframe, object, embed, picture')) {
    el.remove();
  }
  for (const link of root.querySelectorAll('link[rel="stylesheet"], link[as="style"]')) {
    const href = link.getAttribute('href');
    if (!href || isCrossOriginUrl(href, pageOrigin)) link.remove();
  }
  for (const script of root.querySelectorAll('script')) {
    script.remove();
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

function buildDegradedScreenshot(width: number, height: number): string | null {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e5e7eb';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText('Screenshot: layout captured (external media stripped)', 16, 28);
  ctx.fillText(`${width}×${height}px`, 16, 48);
  try {
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
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
