/**
 * Plain-language names and one-line descriptions for the Settings tabs.
 * The tab strip, the page context for Ask Mushi and the command palette all
 * read these, so a tab is called the same thing everywhere.
 */

import type { SettingsTabId } from '../components/settings/types'

/** Short nouns, no acronyms ("BYOK" stays a search alias only). */
export const SETTINGS_TAB_LABELS: Record<SettingsTabId, string> = {
  general: 'General',
  byok: 'AI keys',
  tools: 'Web tools',
  voice: 'Voice reports',
  sdk: 'SDK & connection',
}

export const SETTINGS_TAB_DESCRIPTIONS: Record<SettingsTabId, string> = {
  general: 'Bug alerts, error tracking, your database link, how bugs are sorted, and limits',
  byok: 'Your Anthropic, OpenAI, OpenRouter, Cursor, Firecrawl, Browserbase and Supabase keys',
  tools:
    'Firecrawl reads public web pages while diagnosing; Browserbase runs scheduled tests in a cloud browser',
  voice: 'Report bugs by voice from your phone, Telegram or Slack',
  sdk: 'Install the bug widget, check it can reach Mushi, send a test bug, and turn on debug logging',
}
