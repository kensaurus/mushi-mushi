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
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          try {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
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

function buildPrivacySafeDocument(privacy?: MushiPrivacyConfig): Element {
  const clone = document.documentElement.cloneNode(true) as Element;

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
