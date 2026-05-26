import { useCallback } from 'react';
import type { MushiSDKInstance, MushiReportCategory } from '@mushi-mushi/core';
import { createLogger } from '@mushi-mushi/core';
import { useMushiContext } from './provider';

const log = createLogger({ scope: 'mushi:react' });

export interface UseMushiResult {
  /**
   * Open the reporter widget, optionally pre-selecting a category or jumping
   * straight to the feature-request form.
   */
  report: (options?: { category?: MushiReportCategory; featureRequest?: boolean }) => void;
  /**
   * Briefly animate the bug-report trigger button to draw attention without
   * opening the full widget. Ideal for first-session nudges.
   */
  pulseTrigger: () => void;
  /** True once the SDK has finished initializing and can accept reports. */
  isReady: boolean;
}

/**
 * Primary ergonomic hook for the Mushi SDK in React apps.
 *
 * Returns `{ report, pulseTrigger, isReady }` — covers the 90% case without
 * the `getMushi()?.report()` optional-chain dance.
 *
 * @example
 * ```tsx
 * const { report, isReady } = useMushi()
 * <button onClick={() => report({ featureRequest: true })}>Request feature</button>
 * ```
 */
export function useMushi(): UseMushiResult {
  const { sdk, isReady } = useMushiContext();

  const report = useCallback(
    (options?: { category?: MushiReportCategory; featureRequest?: boolean }) => {
      if (!sdk) {
        log.warn('SDK not initialized — wrap your app in <MushiProvider>');
        return;
      }
      sdk.report(options);
    },
    [sdk],
  );

  const pulseTrigger = useCallback(() => {
    sdk?.pulseTrigger();
  }, [sdk]);

  return { report, pulseTrigger, isReady };
}

/**
 * Access the raw Mushi SDK instance. Returns null if SDK is not yet initialized.
 * Prefer `useMushi()` for the ergonomic destructurable shape.
 */
export function useMushiSdk(): MushiSDKInstance | null {
  const { sdk } = useMushiContext();
  return sdk;
}

/**
 * Returns true when the Mushi SDK has finished initializing.
 */
export function useMushiReady(): boolean {
  const { isReady } = useMushiContext();
  return isReady;
}

/**
 * Convenience hook for programmatic report triggering.
 * Returns a function that opens the widget with an optional pre-selected category.
 */
export function useMushiReport(): (options?: { category?: MushiReportCategory }) => void {
  const { sdk } = useMushiContext();

  return useCallback(
    (options?: { category?: MushiReportCategory }) => {
      if (!sdk) {
        log.warn('SDK not initialized — wrap your app in <MushiProvider>');
        return;
      }
      sdk.report(options);
    },
    [sdk],
  );
}
