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
    elementButton: string;
    elementSelected: string;
    optional: string;
  };
}
