// SPDX-License-Identifier: MIT
/**
 * FILE: packages/server/supabase/functions/api/routes/slack-events.ts
 * PURPOSE: Wiring for the Slack voice inbox routes:
 *
 *   POST /v1/webhooks/slack/events    — Slack Events API (clips → intake)
 *   POST /v1/webhooks/slack/commands  — `/mushi voice|list|open|resolve|help`
 *
 * Everything lives in `slack-events-core.ts` (deps-injected, unit-tested);
 * this module binds the real `_shared/voice-intake.ts` pipeline.
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { ingestVoice } from '../../_shared/voice-intake.ts'
import { registerSlackEventsRoutesWith } from './slack-events-core.ts'

export function registerSlackEventsRoutes(app: Hono<{ Variables: Variables }>): void {
  registerSlackEventsRoutesWith(app, { ingestVoice })
}
