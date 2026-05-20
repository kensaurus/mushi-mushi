import type { MushiReportCategory } from '@mushi-mushi/core';

export interface MushiLocale {
  widget: {
    trigger: string;
    title: string;
    close: string;
    back: string;
    submit: string;
    submitting: string;
    submitted: string;
    error: string;
  };
  step1: {
    heading: string;
    categories: Record<MushiReportCategory, string>;
    categoryDescriptions: Record<MushiReportCategory, string>;
  };
  step2: {
    heading: string;
    intents: Record<MushiReportCategory, string[]>;
  };
  step3: {
    heading: string;
    descriptionPlaceholder: string;
    screenshotButton: string;
    screenshotAttached: string;
    screenshotCapturing: string;
    screenshotFailed: string;
    elementButton: string;
    elementSelected: string;
    elementCapturing: string;
    elementSelectorHint: string;
    optional: string;
    /** Inline validation: description is below the minimum length. */
    tooShort: string;
    /** Example starter chips rendered above the textarea to lower the barrier. */
    examplePrompts: string[];
  };
}
