/**
 * FILE: packages/server/supabase/functions/api/routes/enterprise-integrations.ts
 * PURPOSE: Aggregator for the "enterprise + integrations" admin route surface.
 *          The handlers live in cohesive sibling modules (see imports); this
 *          file only wires them onto the Hono app in their original order.
 *
 * OVERVIEW:
 * - Formerly a ~3.3k-LOC god-file spanning SSO, audit, fine-tuning,
 *   integrations + platform credentials, plugins + marketplace, intelligence /
 *   synthetic monitors, and the health/observability surface. Split by domain.
 * - Registration ORDER is preserved exactly (Hono matches in registration
 *   order), so the call sequence below mirrors the pre-split file.
 *
 * USAGE:
 * - `registerEnterpriseIntegrationsRoutes(app)` is called once from
 *   `api/index.ts`. No behaviour change versus the monolith.
 */
import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';

import { registerSsoAuditRoutes } from './sso-audit.ts';
import { registerFineTuningRoutes } from './fine-tuning.ts';
import { registerIntegrationsRoutes } from './integrations.ts';
import { registerPluginsMarketplaceRoutes } from './plugins-marketplace.ts';
import { registerIntelligenceSyntheticRoutes } from './intelligence-synthetic.ts';
import { registerHealthRoutes } from './health.ts';

export function registerEnterpriseIntegrationsRoutes(app: Hono<{ Variables: Variables }>): void {
  registerSsoAuditRoutes(app);
  registerFineTuningRoutes(app);
  registerIntegrationsRoutes(app);
  registerPluginsMarketplaceRoutes(app);
  registerIntelligenceSyntheticRoutes(app);
  registerHealthRoutes(app);
}
