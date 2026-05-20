import type { MushiPrivacyConfig } from '@mushi-mushi/core';

export interface ScreenshotCapture {
  take(): Promise<ScreenshotResult>;
  updateOptions(options: ScreenshotCaptureOptions): void;
}

export interface ScreenshotCaptureOptions {
  privacy?: MushiPrivacyConfig;
}

export type ScreenshotResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: 'tainted' | 'load-error' | 'unsupported' | 'cancelled' | 'error'; message?: string };

export function createScreenshotCapture(options: ScreenshotCaptureOptions = {}): ScreenshotCapture {
  let activeOptions = options;

  async function take(): Promise<ScreenshotResult> {
    if (typeof document === 'undefined') {
      return { ok: false, reason: 'unsupported', message: 'Not in a browser context' };
    }

    // Attempt 1: SVG foreignObject — fast, no user prompt, works for same-origin content.
    const svgResult = await trySvgCapture(activeOptions.privacy);
    if (svgResult.ok) return svgResult;

    // Attempt 2: getDisplayMedia — always captures exactly what is on screen
    // including cross-origin iframes and custom fonts, but requires the browser
    // to show a "share your screen" picker (one click for the user).
    // Only attempt when SVG failed due to taint/load errors, not unsupported.
    if (svgResult.reason !== 'unsupported') {
      const mediaResult = await tryDisplayMediaCapture();
      if (mediaResult.ok) return mediaResult;
    }

    return svgResult;
  }

  return {
    take,
    updateOptions(nextOptions) {
      activeOptions = nextOptions;
    },
  };
}

// ---------------------------------------------------------------------------
// Strategy 1: SVG foreignObject with privacy masking
// ---------------------------------------------------------------------------

async function trySvgCapture(privacy?: MushiPrivacyConfig): Promise<ScreenshotResult> {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'unsupported', message: 'Canvas 2d context unavailable' };

    const width = window.innerWidth;
    const height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Build a privacy-safe clone of the document, stripping cross-origin
    // image src attrs so they don't taint the canvas.
    const safeDocument = buildPrivacySafeDocument(privacy);
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

    const loadResult = await new Promise<'loaded' | 'error'>((resolve) => {
      img.onload = () => resolve('loaded');
      img.onerror = () => resolve('error');
      // Safety timeout — if the browser stalls on a large DOM, don't hang forever.
      const timeout = setTimeout(() => resolve('error'), 5000);
      img.onload = () => { clearTimeout(timeout); resolve('loaded'); };
    });

    URL.revokeObjectURL(url);
    if (loadResult === 'error') {
      return { ok: false, reason: 'load-error', message: 'SVG image load failed' };
    }

    ctx.drawImage(img, 0, 0, width, height);

    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      return { ok: true, dataUrl };
    } catch (err) {
      // SecurityError: canvas was tainted by a cross-origin resource.
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: 'tainted', message };
    }
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: getDisplayMedia — real pixel-perfect screenshot
// Requires user gesture (caller must invoke from a click handler).
// ---------------------------------------------------------------------------

async function tryDisplayMediaCapture(): Promise<ScreenshotResult> {
  if (typeof navigator === 'undefined' || !('mediaDevices' in navigator)) {
    return { ok: false, reason: 'unsupported', message: 'mediaDevices not available' };
  }
  const mediaDevices = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  };
  if (typeof mediaDevices.getDisplayMedia !== 'function') {
    return { ok: false, reason: 'unsupported', message: 'getDisplayMedia not available' };
  }

  let stream: MediaStream | null = null;
  try {
    stream = await mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' } as MediaTrackConstraints,
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    if (!track) return { ok: false, reason: 'error', message: 'No video track' };

    const imageCapture = new (window as unknown as { ImageCapture: new (t: MediaStreamTrack) => { grabFrame(): Promise<ImageBitmap> } }).ImageCapture(track);
    const bitmap = await imageCapture.grabFrame();

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { ok: true, dataUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // NotAllowedError means user dismissed/denied the share picker.
    if (err instanceof Error && err.name === 'NotAllowedError') {
      return { ok: false, reason: 'cancelled', message };
    }
    return { ok: false, reason: 'error', message };
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

function buildPrivacySafeDocument(privacy?: MushiPrivacyConfig): Element {
  const clone = document.documentElement.cloneNode(true) as Element;

  // Strip cross-origin src attrs from images — the main cause of canvas taint.
  for (const img of Array.from(clone.querySelectorAll('img[src]'))) {
    const src = (img as HTMLImageElement).getAttribute('src') ?? '';
    try {
      const url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) {
        img.removeAttribute('src');
        img.removeAttribute('srcset');
      }
    } catch {
      // Relative path — safe.
    }
  }

  // Strip inline style background-image that reference external URLs.
  for (const el of Array.from(clone.querySelectorAll('[style]'))) {
    const style = (el as HTMLElement).getAttribute('style') ?? '';
    if (/url\(["']?https?:\/\/(?!localhost)/.test(style)) {
      (el as HTMLElement).setAttribute('style', style.replace(/url\([^)]*\)/g, 'none'));
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
