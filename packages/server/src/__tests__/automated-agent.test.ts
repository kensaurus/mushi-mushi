/**
 * FILE: packages/server/src/__tests__/automated-agent.test.ts
 * PURPOSE: Pin the User-Agent classifier that keeps headless test runs and
 *          crawlers out of Users & Funnels, the activity dashboard and the
 *          company funnel — and pin the SQL backfill to the same pattern.
 *
 * Why (2026-09-21): 203 of the-wanting-mind's 212 weekly sessions were a
 * local Playwright run (HeadlessChrome) pointed at the production key.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  AUTOMATED_USER_AGENT_PATTERN,
  HUMAN_USER_AGENT_EXCEPTION_PATTERN,
  isAutomatedUserAgent,
} from '../../supabase/functions/_shared/automated-agent.ts'

const AUTOMATED = [
  // Playwright / Puppeteer headless shell — the production case.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'TelegramBot (like TwitterBot)',
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
  'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
]

const HUMAN = [
  'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0',
  // A real handset whose model name contains "bot".
  'Mozilla/5.0 (Linux; Android 9; CUBOT P30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  // Server-side SDKs are not browsers and are not crawlers.
  'node',
  'okhttp/4.12.0',
]

describe('isAutomatedUserAgent', () => {
  it.each(AUTOMATED)('flags %s', (ua) => {
    expect(isAutomatedUserAgent(ua)).toBe(true)
  })

  it.each(HUMAN)('keeps %s', (ua) => {
    expect(isAutomatedUserAgent(ua)).toBe(false)
  })

  it('treats a missing User-Agent as human (the SDK omits it off-browser)', () => {
    expect(isAutomatedUserAgent(null)).toBe(false)
    expect(isAutomatedUserAgent(undefined)).toBe(false)
    expect(isAutomatedUserAgent('')).toBe(false)
  })

  it('uses only regex syntax Postgres ARE reads the same way', () => {
    // `\b` is a backspace in Postgres ARE; lookbehind is not portable.
    for (const pattern of [AUTOMATED_USER_AGENT_PATTERN, HUMAN_USER_AGENT_EXCEPTION_PATTERN]) {
      expect(pattern).not.toMatch(/\\b|\(\?<[=!]/)
    }
  })

  it('the end_user_sessions.is_bot backfill uses the same pattern and exception', () => {
    const migrationsDir = resolve(__dirname, '../../supabase/migrations')
    const file = readdirSync(migrationsDir).find((f) => f.endsWith('_funnel_definitions_and_bot_sessions.sql'))
    expect(file, 'backfill migration exists').toBeTruthy()
    const sql = readFileSync(resolve(migrationsDir, file!), 'utf8')
    expect(sql).toContain(`user_agent ~* '${AUTOMATED_USER_AGENT_PATTERN}'`)
    expect(sql).toContain(`user_agent !~* '${HUMAN_USER_AGENT_EXCEPTION_PATTERN}'`)
  })
})
