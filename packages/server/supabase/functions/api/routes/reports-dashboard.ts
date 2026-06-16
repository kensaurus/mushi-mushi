/**
 * FILE: packages/server/supabase/functions/api/routes/reports-dashboard.ts
 * PURPOSE: Aggregator for the reports + dashboard admin route surface. The
 *          handlers live in cohesive sibling modules (see imports); this file
 *          only wires them onto the Hono app in their original order.
 *
 * OVERVIEW:
 * - Formerly a ~2.9k-LOC god-file spanning report list/detail/bulk mutations,
 *   the global stats + inbox + dashboard aggregates, the judge surface, and the
 *   prompt-lab CRUD. Split by domain for maintainability.
 * - Registration ORDER is preserved exactly (Hono matches in registration
 *   order), so the call sequence below mirrors the pre-split file.
 *
 * USAGE:
 * - `registerReportsDashboardRoutes(app)` is called once from `api/index.ts`.
 *   No behaviour change versus the monolith.
 */
import type { Hono } from 'npm:hono@4';
import type { Variables } from '../types.ts';

import { registerReportsRoutes } from './reports.ts';
import { registerDashboardRoutes } from './dashboard.ts';
import { registerJudgeRoutes } from './judge.ts';
import { registerPromptLabRoutes } from './prompt-lab.ts';

export function registerReportsDashboardRoutes(app: Hono<{ Variables: Variables }>): void {
  registerReportsRoutes(app);
  registerDashboardRoutes(app);
  registerJudgeRoutes(app);
  registerPromptLabRoutes(app);
}
