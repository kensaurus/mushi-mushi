/**
 * FILE: packages/server/supabase/functions/api-ext/index.ts
 * PURPOSE: The overflow half of the admin API.
 *
 *          Supabase refuses a function whose source is over its deployment
 *          size limit, and `api` crossed it on 2026-10-21 (HTTP 413). These
 *          self-contained route groups run here instead; `api` forwards their
 *          paths (`_shared/edge-proxy.ts`), so clients keep calling
 *          `/functions/v1/api/v1/...`. CORS stays in `api`, which answers the
 *          browser; every route here runs its own auth on the forwarded
 *          headers. The route files stay under `api/routes/` so the route
 *          manifest and the surface-parity check keep reading them.
 *
 *          Routes here: CI runners and placement (Plan 022), inventory, Ask Mushi,
 *          verified fixes (Plan 024).
 */

import { Hono } from 'npm:hono@4'
import type { Variables } from '../api/types.ts'
import { ensureSentry, sentryHonoErrorHandler } from '../_shared/sentry.ts'
import { requestLoggingMiddleware } from '../_shared/request-logging.ts'
import { stdioMcpUsage } from '../_shared/mcp-stdio-usage.ts'
import { registerCiRoutes } from '../api/routes/ci.ts'
import { registerCiPlacementRoutes } from '../api/routes/ci-placement.ts'
import { registerInventoryRoutes } from '../api/routes/inventory.ts'
import { registerAskMushiRoutes } from '../api/routes/ask-mushi.ts'
import { registerVerifyRoutes } from '../api/routes/verify.ts'
import { registerCodebaseUnderstandRoutes } from '../api/routes/codebase-understand.ts'
import { registerModernizationHealthSuperRoutes } from '../api/routes/modernization-health-super.ts'
import { registerSkillsRoutes } from '../api/routes/skills.ts'

ensureSentry('api-ext')

const app = new Hono<{ Variables: Variables }>().basePath('/api-ext')

app.onError(sentryHonoErrorHandler)
app.use('*', requestLoggingMiddleware())
app.use('/v1/*', stdioMcpUsage())

registerAskMushiRoutes(app)
registerInventoryRoutes(app)
registerCiRoutes(app)
registerCiPlacementRoutes(app)
registerVerifyRoutes(app)
registerCodebaseUnderstandRoutes(app)
registerModernizationHealthSuperRoutes(app)
registerSkillsRoutes(app)

app.notFound((c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'No such route.' } }, 404))

Deno.serve((req) => app.fetch(req))
