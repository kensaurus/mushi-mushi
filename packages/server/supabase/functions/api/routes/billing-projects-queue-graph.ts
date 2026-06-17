/**
 * FILE: packages/server/supabase/functions/api/routes/billing-projects-queue-graph.ts
 * PURPOSE: Aggregator for the admin billing / projects / queue / knowledge-graph
 *          route surface. The handlers themselves live in cohesive sibling
 *          modules (see imports below); this file only wires them onto the Hono
 *          app in their original registration order.
 *
 * OVERVIEW:
 * - Historically this was a ~4.5k-LOC god-file holding every admin route for
 *   billing, onboarding/setup, projects + API keys, project integrations,
 *   codebase indexing, the DLQ/queue, the knowledge graph, the bug ontology,
 *   and natural-language query. It was split by domain for maintainability.
 * - Registration ORDER is preserved exactly: Hono matches routes in
 *   registration order, so the sequence below must mirror the pre-split file.
 *
 * USAGE:
 * - `registerBillingProjectsQueueGraphRoutes(app)` is called once from
 *   `api/index.ts`. No behaviour change versus the monolith.
 */
import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';

import { registerBillingRoutes } from './billing.ts';
import { registerOnboardingSetupRoutes } from './onboarding-setup.ts';
import { registerProjectsCrudRoutes } from './projects-crud.ts';
import { registerProjectKeysRoutes } from './project-keys.ts';
import { registerProjectCiSecretsRoutes } from './project-ci-secrets.ts';
import { registerProjectIntegrationsRoutes } from './project-integrations.ts';
import { registerProjectCodebaseRoutes } from './project-codebase.ts';
import { registerQueueRoutes } from './queue.ts';
import { registerGraphQueryRoutes } from './graph-query.ts';

export function registerBillingProjectsQueueGraphRoutes(app: Hono<{ Variables: Variables }>): void {
  registerBillingRoutes(app);
  registerOnboardingSetupRoutes(app);
  registerProjectsCrudRoutes(app);
  registerProjectKeysRoutes(app);
  registerProjectCiSecretsRoutes(app);
  registerProjectIntegrationsRoutes(app);
  registerProjectCodebaseRoutes(app);
  registerQueueRoutes(app);
  registerGraphQueryRoutes(app);
}
