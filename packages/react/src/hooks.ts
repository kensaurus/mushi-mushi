import { useCallback } from 'react';
import type { MushiSDKInstance, MushiReportCategory } from '@mushi/core';
import { createLogger } from '@mushi/core';
import { useMushiContext } from './provider';

const log = createLogger({ scope: 'mushi:react' });

/**
 * Access the Mushi SDK instance. Returns null if SDK is not yet initialized.
 */
export function useMushi(): MushiSDKInstance | null {
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
