/**
 * FILE: slack-interaction-thread-channel.test.ts
 * PURPOSE: The threaded notes slack-interactions posts after Dispatch /
 *          Resolve / Dismiss passed no channel, so sendBotMessage fell back
 *          to the SLACK_CHANNEL_ID env only. A project whose cards go to its
 *          own project_settings.slack_channel_id got `no_channel` and the
 *          note was silently skipped. Each threaded call now names the
 *          channel of the card the button sits on.
 *
 *          index.ts imports Deno globals, so the wiring is asserted at the
 *          source level.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = readFileSync(
  resolve(__dirname, '../../supabase/functions/slack-interactions/index.ts'),
  'utf8',
)

/** The options object of every `sendBotMessage({ ... })` call. */
function sendBotMessageCalls(src: string): string[] {
  return [...src.matchAll(/sendBotMessage\(\{([\s\S]*?)\n\s*\}\)/g)].map((m) => m[1])
}

describe('slack-interactions threaded replies', () => {
  const threaded = sendBotMessageCalls(SOURCE).filter((c) => /threadTs:/.test(c))

  it('finds the threaded replies (sanity check on the source parse)', () => {
    expect(threaded.length).toBeGreaterThanOrEqual(2)
  })

  it('names the card channel on every threaded reply', () => {
    for (const call of threaded) expect(call).toMatch(/channel: input\.channelId,/)
  })

  it('hands the dispatch path the interaction channel', () => {
    expect(SOURCE).toMatch(/finishDispatch\(\{[\s\S]*?channelId: payload\.channel\?\.id,[\s\S]*?\}\)/)
  })
})
