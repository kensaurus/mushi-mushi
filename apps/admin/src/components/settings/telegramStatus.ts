/**
 * FILE: apps/admin/src/components/settings/telegramStatus.ts
 * PURPOSE: The Telegram bot row's verdict on Settings → Voice. The webhook
 *          counts as connected only when the server says it registered one
 *          (`webhook_registered`); `webhook_url` is where it would point and
 *          is always returned, so it proves nothing.
 */

import type { RowStatusValue } from './SettingsRow'

export interface TelegramStatusData {
  configured?: boolean
  webhook_registered?: boolean
  bindings?: unknown[]
}

export function telegramRowStatus(tokenSaved: boolean, data: TelegramStatusData | null | undefined): RowStatusValue {
  if (!tokenSaved) return { state: 'not_connected', detail: 'Save a bot token from @BotFather below.' }
  if (data?.webhook_registered !== true) {
    return { state: 'attention', detail: 'Connect the webhook so Telegram can deliver voice notes to Mushi.' }
  }
  const linked = data.bindings?.length ?? 0
  if (linked === 0) return { state: 'attention', detail: 'No chat linked yet. Make a link code and send it to the bot.' }
  return { state: 'working', detail: `Webhook connected · ${linked} chat${linked === 1 ? '' : 's'} linked.` }
}
