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

/**
 * Always blacked out of every screenshot — DOM capture and tab share alike —
 * before any pixel is produced. `redactSelectors` adds to this list and can't
 * remove from it: a host passing its own list used to drop password redaction.
 */
export const ALWAYS_REDACT_SELECTORS ='input[type="password"],input[autocomplete^="cc-"],[data-private],[data-mushi-mask]';

/**
 * The capture code lives in ./screenshot-dom and loads on the first
 * screenshot, so a page that never takes one never downloads it.
 */
export function createScreenshotCapture(options: ScreenshotCaptureOptions = {}): ScreenshotCapture {
  let activeOptions = options;

  const fail = (reason: ScreenshotFailureReason) => {
    activeOptions.onFailed?.(reason);
    emitScreenshotFailed(reason);
  };

  async function take(): Promise<string | null> {
    try {
      if (typeof document === 'undefined') return null;
      const { captureDomScreenshot } = await import('./screenshot-dom');
      return await captureDomScreenshot(activeOptions.privacy, fail);
    } catch {
      fail('error');
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
