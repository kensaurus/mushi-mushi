#!/usr/bin/env node
/**
 * FILE: .refactor-backups/split-widget-render.mjs
 * PURPOSE: Extract the contiguous render*(): string view layer (lines
 *          1343-2174) out of widget.ts into a stateless widget-render.ts module
 *          of free functions that take a WidgetRenderCtx snapshot. Preserves the
 *          MushiWidget public API (no member visibility widened). Gitignored.
 *
 * USAGE: node .refactor-backups/split-widget-render.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.cwd();
const FILE = `${ROOT}/packages/web/src/widget.ts`;
const RENDER_FILE = `${ROOT}/packages/web/src/widget-render.ts`;

const START = 1343; // renderStep()
const END = 2174; // closing } of renderSuccessRewards()

const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

// Sanity-check the boundaries before mutating.
if (!/private renderStep\(\): string \{/.test(lines[START - 1])) {
  throw new Error(`START line ${START} is not renderStep(): ${lines[START - 1]}`);
}
if (lines[END - 1].trim() !== '}') {
  throw new Error(`END line ${END} is not a closing brace: ${lines[END - 1]}`);
}

// ── Transform the block into free functions ─────────────────────────────────
let block = lines.slice(START - 1, END).join('\n');

// 1. Method headers -> exported functions taking ctx.
block = block.replace(/^(\s*)private (render[A-Za-z]+)\((\)?)/gm, (_m, _ind, name, close) =>
  close === ')'
    ? `export function ${name}(ctx: WidgetRenderCtx)`
    : `export function ${name}(ctx: WidgetRenderCtx, `,
);

// 2. Inter-render calls: empty-arg first, then the arg-bearing form.
block = block.replace(/this\.(render[A-Za-z]+)\(\)/g, '$1(ctx)');
block = block.replace(/this\.(render[A-Za-z]+)\(/g, '$1(ctx, ');

// 3. Every remaining member access reads from the ctx snapshot.
block = block.replace(/this\./g, 'ctx.');

const ctxInterface = `export interface WidgetRenderCtx {
  config: Required<MushiWidgetConfig>;
  rewardsState: WidgetRewardsState | null;
  lastReportId: string | null;
  reporterLoading: boolean;
  locale: MushiLocale;
  testerReputation: MushiTesterReputation | null;
  testerInfo: { id: string; public_handle: string | null; display_name: string | null } | null;
  screenshotCapturing: boolean;
  screenshotAttached: boolean;
  reporterError: string | null;
  magicLinkError: string;
  elementCapturing: boolean;
  submitting: boolean;
  sdkFreshness: { latest: string | null; current: string; deprecated: boolean; message?: string | null } | null;
  screenshotError: boolean;
  reporterReports: MushiReporterReport[];
  magicLinkSending: boolean;
  magicLinkEmail: string;
  globalLeaderboardLoading: boolean;
  globalLeaderboard: MushiLeaderboardEntry[] | null;
  elementSelected: boolean;
  crossAppLoading: boolean;
  callbacks: WidgetCallbacks;
  testerJwt: string | null;
  submittedAt: Date | null;
  step: WidgetStep;
  selectedReportId: string | null;
  selectedCategory: string | null;
  sdkVersion: string;
  reporterComments: MushiReporterComment[];
  magicLinkSent: boolean;
  leaderboardLoading: boolean;
  leaderboardEntries: Array<{ display_name: string; tier_name: string | null; total_points: number; points_30d: number }> | null;
  lastSubmitQueuedOffline: boolean;
  featureBoard: Array<Record<string, unknown>>;
  crossAppReports: MushiCrossAppReport[] | null;
  allowScreenshotRemove: boolean;
  unreadCount: () => number;
  tierColor: (slug: string) => string;
  resolveCustomCategory: (id: string) => MushiCustomCategory | undefined;
  effectiveMinLength: () => number;
  categoryLabel: (id: string) => string;
  categoryIcon: (id: string) => string;
}`;

const renderHeader = `/**
 * FILE: packages/web/src/widget-render.ts
 * PURPOSE: Stateless view layer for the MushiWidget panel. Each function takes a
 *          WidgetRenderCtx snapshot (read-only state + bound helper closures the
 *          class builds once per render) and returns an HTML string.
 *
 * OVERVIEW:
 * - Extracted verbatim from widget.ts (the render*() methods) so that file can
 *   stay focused on DOM structure, state, lifecycle, and event wiring.
 * - WidgetRenderCtx is the contract between the class and this view layer. The
 *   class's renderCtx() builds it; tsc enforces both sides stay in sync.
 *
 * DEPENDENCIES:
 * - @mushi-mushi/core — report / reporter / leaderboard wire types.
 * - ./i18n — MushiLocale (string tables).
 * - ./widget-helpers — pure formatters, constants, and shared contracts.
 *
 * USAGE:
 * - renderStep / renderOutdatedBanner / renderBrandFooter are called by
 *   MushiWidget.render(); the rest are called transitively via ctx.
 *
 * NOTES:
 * - Behaviour-preserving move: bodies are identical to the pre-split methods,
 *   with \`this.<member>\` rewritten to \`ctx.<member>\` and inter-render calls to
 *   \`render*(ctx, ...)\`. No DOM/state mutation happens here.
 */
import type {
  MushiCrossAppReport,
  MushiCustomCategory,
  MushiLeaderboardEntry,
  MushiReportCategory,
  MushiReporterComment,
  MushiReporterReport,
  MushiTesterReputation,
  MushiWidgetConfig,
} from '@mushi-mushi/core';
import type { MushiLocale } from './i18n';
import {
  CATEGORY_ICONS,
  escapeHtml,
  formatRelativeTime,
  pad2,
  reporterStatusLabel,
  reporterStatusShort,
  reporterStatusTone,
  STEP_NUMBER,
  TOTAL_STEPS,
} from './widget-helpers';
import type { WidgetCallbacks, WidgetRewardsState, WidgetStep } from './widget-helpers';
`;

writeFileSync(RENDER_FILE, `${renderHeader}\n${ctxInterface}\n\n${block}\n`);

// ── Rewrite widget.ts: drop the block, insert renderCtx(), wire imports ──────
const ctxFields = [
  'config', 'rewardsState', 'lastReportId', 'reporterLoading', 'locale',
  'testerReputation', 'testerInfo', 'screenshotCapturing', 'screenshotAttached',
  'reporterError', 'magicLinkError', 'elementCapturing', 'submitting',
  'sdkFreshness', 'screenshotError', 'reporterReports', 'magicLinkSending',
  'magicLinkEmail', 'globalLeaderboardLoading', 'globalLeaderboard',
  'elementSelected', 'crossAppLoading', 'callbacks', 'testerJwt', 'submittedAt',
  'step', 'selectedReportId', 'selectedCategory', 'sdkVersion', 'reporterComments',
  'magicLinkSent', 'leaderboardLoading', 'leaderboardEntries',
  'lastSubmitQueuedOffline', 'featureBoard', 'crossAppReports', 'allowScreenshotRemove',
];
const renderCtxMethod = [
  '  /**',
  '   * Build the read-only snapshot + bound helper closures the stateless view',
  '   * layer (widget-render.ts) renders from. Rebuilt once per render() pass so',
  '   * the HTML always reflects current state.',
  '   */',
  '  private renderCtx(): WidgetRenderCtx {',
  '    return {',
  ...ctxFields.map((f) => `      ${f}: this.${f},`),
  '      unreadCount: () => this.unreadCount(),',
  '      tierColor: (slug) => this.tierColor(slug),',
  '      resolveCustomCategory: (id) => this.resolveCustomCategory(id),',
  '      effectiveMinLength: () => this.effectiveMinLength(),',
  '      categoryLabel: (id) => this.categoryLabel(id),',
  '      categoryIcon: (id) => this.categoryIcon(id),',
  '    };',
  '  }',
];

const before = lines.slice(0, START - 1);
const after = lines.slice(END);
let out = [...before, ...renderCtxMethod, ...after].join('\n');

out = out.replace(
  "export type { WidgetCallbacks, WidgetRewardsState, WidgetSubmitOutcome } from './widget-helpers';",
  "export type { WidgetCallbacks, WidgetRewardsState, WidgetSubmitOutcome } from './widget-helpers';\nimport { renderBrandFooter, renderOutdatedBanner, renderStep } from './widget-render';\nimport type { WidgetRenderCtx } from './widget-render';",
);

out = out.replace(
  '      panel.innerHTML = `${this.renderOutdatedBanner()}${this.renderStep()}${this.renderBrandFooter()}`;',
  '      const ctx = this.renderCtx();\n      panel.innerHTML = `${renderOutdatedBanner(ctx)}${renderStep(ctx)}${renderBrandFooter(ctx)}`;',
);

writeFileSync(FILE, out);
console.log(`widget-render.ts written; widget.ts rewritten (block ${START}-${END} extracted).`);
