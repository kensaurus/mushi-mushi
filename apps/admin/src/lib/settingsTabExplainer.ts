/**
 * Plain-language names and one-line descriptions for the Settings tabs.
 * The tab strip, the page context for Ask Mushi and the command palette all
 * read these, so a tab is called the same thing everywhere.
 */

import type { SettingsTabId } from '../components/settings/types'

/** Human tab labels — no acronyms ("BYOK" stays a search alias only). */
export const SETTINGS_TAB_LABELS: Record<SettingsTabId, string> = {
  general: 'General',
  byok: 'Your AI keys',
  firecrawl: 'Web research',
  browserbase: 'Cloud browser',
  voice: 'Voice',
  health: 'Health check',
  dev: 'Developer',
}

export const SETTINGS_TAB_DESCRIPTIONS: Record<SettingsTabId, string> = {
  general: 'Where bug alerts go, Sentry, your Supabase link, how bugs are sorted, and daily limits',
  byok: 'Your own Anthropic, OpenAI, Cursor, Firecrawl, Browserbase and Supabase keys',
  firecrawl: 'Optional Firecrawl key so Mushi can read public web pages while diagnosing',
  browserbase: 'Optional Browserbase key for scheduled tests in a cloud browser',
  voice: 'Report bugs by voice from your phone, Telegram or Slack',
  health: 'Check the bug widget can reach Mushi and send a test bug',
  dev: 'Debug logging in this browser, for developers',
}
