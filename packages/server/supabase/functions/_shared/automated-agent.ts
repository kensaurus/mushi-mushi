/**
 * FILE: packages/server/supabase/functions/_shared/automated-agent.ts
 * PURPOSE: Recognise browsers driven by software (headless test runners,
 *          crawlers, link unfurlers) from their User-Agent, so their visits
 *          do not count as people in Users & Funnels, the activity dashboard
 *          or Mushi's own company funnel.
 *
 * Why (2026-09-21): of 212 sessions the-wanting-mind recorded in a week, 203
 * were HeadlessChrome from a local Playwright run pointed at the production
 * key, and glot.it carried 54 more. Nothing on the server told them apart.
 *
 * Pure module (no Deno or DB imports) so vitest and `deno test` both load it.
 * The same pattern backfills end_user_sessions.is_bot in migration
 * 20260921000010_funnel_definitions_and_bot_sessions.sql, so it is written
 * in the regex subset JavaScript and Postgres ARE (`~*`) agree on: no `\b`
 * (a backspace in Postgres), no lookbehind.
 *
 * A User-Agent is self-reported. This removes honest automation (test
 * runners, crawlers that name themselves); it is not bot defence. Headful
 * Playwright sends a normal Chrome UA and is caught client-side instead, by
 * the SDK's navigator.webdriver check.
 */

/** Case-insensitive. `bot([^a-z]|$)` matches Googlebot/2.1, ClaudeBot/1.0, Slackbot-LinkExpanding, "TelegramBot (like …)". */
export const AUTOMATED_USER_AGENT_PATTERN =
  'headlesschrome|phantomjs|playwright|puppeteer|selenium|webdriver|lighthouse|crawler|crawling|spider|slurp|facebookexternalhit|embedly|bot([^a-z]|$)'

/**
 * Real handsets whose model name trips the pattern above: Cubot phones report
 * "CUBOT P30" in their UA. Kept separate so the backfill can apply it the same way.
 */
export const HUMAN_USER_AGENT_EXCEPTION_PATTERN = 'cubot'

const AUTOMATED_RE = new RegExp(AUTOMATED_USER_AGENT_PATTERN, 'i')
const HUMAN_EXCEPTION_RE = new RegExp(HUMAN_USER_AGENT_EXCEPTION_PATTERN, 'i')

/** True when the User-Agent names a headless browser, test driver or crawler. */
export function isAutomatedUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  if (!AUTOMATED_RE.test(userAgent)) return false
  return !HUMAN_EXCEPTION_RE.test(userAgent)
}
