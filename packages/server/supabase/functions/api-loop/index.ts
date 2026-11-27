/**
 * FILE: packages/server/supabase/functions/api-loop/index.ts
 * PURPOSE: The second overflow half of the admin API.
 *
 *          `api-ext` (the first overflow half) reached Supabase's deployment
 *          size limit on 2026-11-27 (HTTP 413 at 4,752.7 KiB compacted), so
 *          the route groups of the improvement loop run here instead: UX
 *          runs, first-time user tests (fresh eyes, ADR 0053), the UX
 *          scorecard (ADR 0067), the iteration timeline (ADR 0072), UX captures from any driver and
 *          project personas with test accounts (ADR 0073), CI security
 *          results, a release's security proof and its release kit with store
 *          media uploads (ADR 0074), and fine-tuning jobs with the OpenAI
 *          fine-tuning webhook.
 *
 *          Same contract as `api-ext`: `api` forwards these paths
 *          (`_shared/edge-proxy.ts`), so clients keep calling
 *          `/functions/v1/api/v1/...`. CORS stays in `api`; every route here
 *          runs its own auth on the forwarded headers. The route files stay
 *          under `api/routes/` for the route manifest and the surface-parity
 *          check. Upload budgets for api, api-ext and api-loop are in
 *          scripts/deploy-edge-function.test.mjs.
 */

import { Hono } from 'npm:hono@4'
import type { Variables } from '../api/types.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { requestLoggingMiddleware } from '../_shared/request-logging.ts'
import { stdioMcpUsage } from '../_shared/mcp-stdio-usage.ts'
import { registerUxRunsRoutes } from '../api/routes/ux-runs.ts'
import { registerFreshEyesRoutes } from '../api/routes/fresh-eyes.ts'
import { registerUxScorecardRoutes } from '../api/routes/ux-scorecard.ts'
import { registerUxTimelineRoutes } from '../api/routes/ux-timeline.ts'
import { registerUxCaptureRoutes } from '../api/routes/ux-captures.ts'
import { registerPersonaRoutes } from '../api/routes/personas.ts'
import { registerSecurityProofRoutes } from '../api/routes/security-proof.ts'
import { registerReleaseKitRoutes } from '../api/routes/release-kits.ts'
import { registerFineTuningRoutes } from '../api/routes/fine-tuning.ts'

ensureSentry('api-loop')

const app = new Hono<{ Variables: Variables }>().basePath('/api-loop')

app.onError(sentryHonoErrorHandler)
app.use('*', requestLoggingMiddleware())
app.use('/v1/*', stdioMcpUsage())

// UX runs (ADR 0020), first-time user tests (ADR 0053), the UX scorecard (ADR 0067).
registerUxRunsRoutes(app)
registerFreshEyesRoutes(app)
registerUxScorecardRoutes(app)
// The iteration timeline (ADR 0072).
registerUxTimelineRoutes(app)
// UX captures from any driver and project personas with test accounts (ADR 0073).
registerUxCaptureRoutes(app)
registerPersonaRoutes(app)
// Security proof and release kits (Plan 025 P4-P6, ADR 0074): CI scan results, a release's proof,
// its kit for a product video, and store media uploads as approval requests.
registerSecurityProofRoutes(app)
registerReleaseKitRoutes(app)
// Fine-tuning jobs and the OpenAI fine-tuning webhook.
registerFineTuningRoutes(app)

app.notFound((c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No such route.' } }, 404))

Deno.serve((req) => app.fetch(req))
