import { useCallback } from 'react';
import type {
  MushiSDKInstance,
  MushiReportCategory,
  MushiReporterReport,
  MushiReporterComment,
  MushiHallOfFameEntry,
  MushiReputationResult,
  MushiTierResult,
} from '@mushi-mushi/core';
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

  // ─── Reporter API ───────────────────────────────────────────────────────
  /** Returns the reporter's own report history (keyed to persistent token). */
  listMyReports: () => Promise<MushiReporterReport[]>;
  /** Returns the comment thread for a given report. */
  listMyComments: (reportId: string) => Promise<MushiReporterComment[]>;
  /** Post a follow-up comment on one of the reporter's own reports. */
  replyToReport: (reportId: string, body: string) => Promise<MushiReporterComment | null>;
  /** Returns the global hall-of-fame ranked by total points. */
  getHallOfFame: (limit?: number) => Promise<MushiHallOfFameEntry[]>;
  /** Returns the current user's reputation + points. */
  getReputation: () => Promise<MushiReputationResult | null>;
  /** Returns the current user's tier. */
  getTier: () => Promise<MushiTierResult | null>;
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

  const listMyReports = useCallback((): Promise<MushiReporterReport[]> => {
    return sdk?.listMyReports() ?? Promise.resolve([]);
  }, [sdk]);

  const listMyComments = useCallback((reportId: string): Promise<MushiReporterComment[]> => {
    return sdk?.listMyComments(reportId) ?? Promise.resolve([]);
  }, [sdk]);

  const replyToReport = useCallback((reportId: string, body: string): Promise<MushiReporterComment | null> => {
    return sdk?.replyToReport(reportId, body) ?? Promise.resolve(null);
  }, [sdk]);

  const getHallOfFame = useCallback((limit?: number): Promise<MushiHallOfFameEntry[]> => {
    return sdk?.getHallOfFame(limit) ?? Promise.resolve([]);
  }, [sdk]);

  const getReputation = useCallback((): Promise<MushiReputationResult | null> => {
    return sdk?.getReputation() ?? Promise.resolve(null);
  }, [sdk]);

  const getTier = useCallback((): Promise<MushiTierResult | null> => {
    return sdk?.getTier() ?? Promise.resolve(null);
  }, [sdk]);

  return {
    report,
    pulseTrigger,
    isReady,
    listMyReports,
    listMyComments,
    replyToReport,
    getHallOfFame,
    getReputation,
    getTier,
  };
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
