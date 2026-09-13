// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/telegram-webhook/index.ts
 * PURPOSE: Telegram Bot API webhook for the voice inbox (plan C1). Telegram
 *          POSTs every update here after the console registers the webhook
 *          (`POST /v1/admin/telegram/setup` → `setWebhook` with a per-project
 *          `secret_token`).
 *
 * Deployment:
 *   - `config.toml`: `[functions.telegram-webhook] verify_jwt = false` —
 *     Telegram cannot carry a Supabase JWT; the request is authenticated by
 *     `X-Telegram-Bot-Api-Secret-Token` inside `handler.ts`.
 *   - Per-project bot token lives in Vault behind
 *     `project_settings.telegram_bot_token_ref` (see `_shared/telegram.ts`).
 *   - Optional env `ADMIN_BASE_URL` for console links in replies.
 *
 * All logic is in `handler.ts` (dependency-injected, unit-tested); this file
 * only binds the real helpers and wraps the handler with Sentry.
 */

import { withSentry, reportError } from '../_shared/sentry.ts'
import { getServiceClient } from '../_shared/db.ts'
import {
  resolveTelegramBotToken,
  sendTelegramMessage,
  downloadTelegramFile,
  answerCallbackQuery,
  telegramApi,
} from '../_shared/telegram.ts'
import { ingestVoice, confirmVoice, cancelVoice } from '../_shared/voice-intake.ts'
import { handleTelegramWebhook, type TelegramWebhookDeps } from './handler.ts'

function buildDeps(): TelegramWebhookDeps {
  const db = getServiceClient()
  return {
    db,
    resolveBotToken: (projectId) => resolveTelegramBotToken(db, projectId),
    sendMessage: (projectId, chatId, text, opts) => sendTelegramMessage(db, projectId, chatId, text, opts),
    downloadFile: (token, fileId) => downloadTelegramFile(token, fileId),
    answerCallbackQuery: (token, callbackQueryId, text) => answerCallbackQuery(token, callbackQueryId, text),
    editMessageText: (token, chatId, messageId, text) =>
      telegramApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: { inline_keyboard: [] },
      }),
    ingestVoice,
    confirmVoice,
    cancelVoice,
    reportError: (err, ctx) => reportError(err, ctx),
    adminBaseUrl: Deno.env.get('ADMIN_BASE_URL') ?? null,
  }
}

Deno.serve(withSentry('telegram-webhook', (req) => handleTelegramWebhook(req, buildDeps())))
