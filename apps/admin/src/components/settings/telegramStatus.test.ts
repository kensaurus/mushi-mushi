/**
 * Settings → Voice, Telegram row (suspected-bugs entry 113): the server always
 * returns `webhook_url`, so only `webhook_registered` may say "connected".
 */

import { describe, expect, it } from 'vitest'
import { telegramRowStatus } from './telegramStatus'

describe('telegramRowStatus', () => {
  it('asks for the bot token first', () => {
    expect(telegramRowStatus(false, { webhook_registered: true }).state).toBe('not_connected')
  })

  it('does not call the webhook connected just because a URL came back', () => {
    const view = telegramRowStatus(true, { configured: false, webhook_registered: false, bindings: [] })
    expect(view.state).toBe('attention')
    expect(view.detail).toMatch(/Connect the webhook/)
    expect(telegramRowStatus(true, null).state).toBe('attention')
  })

  it('asks for a linked chat once the webhook is registered', () => {
    expect(telegramRowStatus(true, { webhook_registered: true, bindings: [] }).detail).toMatch(/No chat linked/)
  })

  it('is working with a registered webhook and a linked chat', () => {
    const view = telegramRowStatus(true, { webhook_registered: true, bindings: [{}] })
    expect(view).toEqual({ state: 'working', detail: 'Webhook connected · 1 chat linked.' })
  })
})
