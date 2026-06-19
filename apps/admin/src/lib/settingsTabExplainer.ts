/**
 * Plain-language intros for Settings tabs — no jargon in the first sentence.
 */

import type { SettingsTabId } from '../components/settings/types'

export interface SettingsTabExplainer {
  title: string
  summary: string
  affects: string[]
}

export const SETTINGS_TAB_EXPLAINERS: Record<SettingsTabId, SettingsTabExplainer> = {
  general: {
    title: 'Notifications, error tracking, and triage behavior',
    summary:
      'These settings change how bugs arrive in Slack, how Sentry errors become reports, and how aggressively the AI groups similar bugs together.',
    affects: [
      'Slack — where triage alerts and fix updates are posted',
      'Sentry — whether production errors and user feedback become Mushi reports',
      'Triage AI — which model scores severity and when auto-fix is allowed to run',
      'Daily limits — caps on web crawls and test generation to control spend',
    ],
  },
  byok: {
    title: 'Your own AI provider keys',
    summary:
      'Optional. Add your Anthropic or OpenAI key so LLM usage bills your account instead of Mushi platform credits. Required for some enterprise policies.',
    affects: [
      'Bug classification and fix-agent runs use your key when configured',
      'Test each key after saving — untested keys may fail silently in production',
    ],
  },
  firecrawl: {
    title: 'Web research for triage',
    summary:
      'Optional Firecrawl key lets the Research tab and some triage steps pull live docs from the public web. Skip if you do not use Research.',
    affects: ['Research crawls and doc-aware triage context'],
  },
  browserbase: {
    title: 'Cloud browser for QA tests',
    summary:
      'Optional Browserbase key runs scheduled QA user-story tests in a remote Chromium session with screenshots. Skip if you only run tests locally.',
    affects: ['QA Coverage stories with the Browserbase provider'],
  },
  health: {
    title: 'Connection check and smoke test',
    summary:
      'Verify the SDK can reach Mushi and send a test bug through the full pipeline before you wire production traffic.',
    affects: ['Does not change behavior — read-only diagnostics and one-shot test report'],
  },
  dev: {
    title: 'Developer-only toggles',
    summary:
      'Widget debug flags and local-only shortcuts. Safe to ignore unless you are building or debugging the SDK integration.',
    affects: ['SDK widget appearance and verbose logging in development builds'],
  },
}

/** Human tab labels — avoid acronyms in the tab strip where possible. */
export const SETTINGS_TAB_LABELS: Record<SettingsTabId, string> = {
  general: 'General',
  byok: 'AI keys',
  firecrawl: 'Web crawl',
  browserbase: 'Cloud browser',
  health: 'Health check',
  dev: 'Developer',
}

export const SETTINGS_TAB_DESCRIPTIONS: Record<SettingsTabId, string> = {
  general: 'Slack alerts, Sentry ingest, triage AI, and daily spend caps',
  byok: 'Your Anthropic / OpenAI keys — optional, bills your account',
  firecrawl: 'Optional key for Research and doc-aware triage',
  browserbase: 'Optional key for cloud QA test runs',
  health: 'SDK connectivity and send a test bug',
  dev: 'Widget debug flags — developers only',
}
