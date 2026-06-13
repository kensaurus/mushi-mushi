/**
 * Dev-only Playwright helpers for marketing GIFs. Exposed on
 * `window.__mushiRecorder` when the SDK is initialized with `debug: true`.
 * Drives the closed shadow-DOM widget through the full reporter flow.
 */

import type { MushiReportCategory } from '@mushi-mushi/core';
import type { MushiWidget } from './widget';

export interface MushiRecorderCenter {
  x: number;
  y: number;
}

export interface MushiMarketingRecorder {
  ready(): boolean;
  getStep(): string;
  getTriggerCenter(): MushiRecorderCenter | null;
  getCategoryCenter(category: MushiReportCategory): MushiRecorderCenter | null;
  getIntentCenter(label: string): MushiRecorderCenter | null;
  getSubmitCenter(): MushiRecorderCenter | null;
  clickTrigger(): void;
  selectCategory(category: MushiReportCategory): void;
  selectIntent(label: string): void;
  focusDescription(): void;
  submit(): void;
  openMyReports(): void;
}

function centerOf(el: Element | null): MushiRecorderCenter | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function exposeMarketingRecorder(widget: MushiWidget): void {
  if (typeof globalThis === 'undefined') return;

  const api: MushiMarketingRecorder = {
    ready: () => widget.getIsMounted(),
    getStep: () => widget.getRecorderStep(),
    getTriggerCenter: () => centerOf(widget.getRecorderTrigger()),
    getCategoryCenter: (category) => centerOf(widget.getRecorderCategoryButton(category)),
    getIntentCenter: (label) => centerOf(widget.getRecorderIntentButton(label)),
    getSubmitCenter: () => centerOf(widget.getRecorderSubmitButton()),
    clickTrigger: () => widget.recorderClickTrigger(),
    selectCategory: (category) => widget.recorderSelectCategory(category),
    selectIntent: (label) => widget.recorderSelectIntent(label),
    focusDescription: () => widget.recorderFocusDescription(),
    submit: () => widget.recorderSubmit(),
    openMyReports: () => widget.recorderOpenMyReports(),
  };

  (globalThis as typeof globalThis & { __mushiRecorder?: MushiMarketingRecorder }).__mushiRecorder = api;
}
