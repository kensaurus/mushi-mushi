/**
 * FILE: packages/server/src/__tests__/route-auth-contract.test.ts
 * PURPOSE: Default-deny guard for the api gateway (backend architecture audit
 *          2026-07-24, finding 2). Auth on the Hono gateway is opt-in per
 *          route — there is no global auth middleware in api/index.ts — so a
 *          route module that forgets to call an auth helper ships an
 *          unauthenticated endpoint. This contract scans every handler-
 *          defining module under api/routes/ and fails unless it references
 *          at least one shared auth helper or is on the explicit public
 *          allowlist below.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES_ROOT = resolve(__dirname, '../../supabase/functions/api/routes');

/**
 * Routes that are deliberately unauthenticated. Adding a file here requires a
 * justification — these are served to anonymous callers on purpose.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  'openapi.ts': 'GET /openapi.json — public OpenAPI 3.1 spec, advertised via the A2A agent card',
  'schemas.ts': 'GET /v1/schemas/:name — public hand-authored JSON Schemas for agent contracts',
};

/**
 * SCOPE NOTE: This is a coarse smoke gate, not a per-route default-deny proof.
 * It confirms that every handler-defining module *references* at least one auth
 * helper — but it does NOT verify that every route in the module applies auth.
 * A module with one authed route and one forgotten route will pass. Known
 * limitations of the heuristic:
 *
 *   1. HANDLER_RE matches only routers bound to the four var names r/app/router/api.
 *      Modules using any other binding (e.g. `reportsApp.get(...)`) will not be
 *      detected as handler modules and are silently excluded from the scan.
 *
 *   2. AUTH_MARKER_RE fires on any occurrence in the file, including comments.
 *      A line like `// TODO: add jwtAuth` would satisfy the check.
 *
 * Until the gateway gains a default-deny middleware layer, this test is
 * primarily useful as a regression guard: a newly added module that forgets
 * auth *entirely* will be caught.
 */
/** A module "defines handlers" if it registers verbs on a Hono router. */
const HANDLER_RE = /\b(?:r|app|router|api)\.(?:get|post|put|patch|delete)\(/;

/**
 * Shared auth helpers from _shared/auth.ts and api/middleware/auth.ts (plus
 * scope assertions from api/shared.ts). Referencing any of these counts as
 * the module opting into authentication.
 */
const AUTH_MARKER_RE =
  /jwtAuth|apiKeyAuth|adminOrApiKey|requireAuthOrApiKey|requireAuth|assertCallerProjectScope|verifyInternal|resolveProjectFromApiKey|superAdmin|requireServiceRoleAuth/;

describe('route auth contract (default-deny)', () => {
  const routeFiles = readdirSync(ROUTES_ROOT).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
  );

  it('finds route modules to scan', () => {
    expect(routeFiles.length).toBeGreaterThan(50);
  });

  it('every handler-defining route module authenticates or is explicitly public', () => {
    const offenders: string[] = [];
    for (const file of routeFiles) {
      if (file in PUBLIC_ROUTES) continue;
      const source = readFileSync(resolve(ROUTES_ROOT, file), 'utf8');
      if (!HANDLER_RE.test(source)) continue; // pure builder / aggregator module
      if (!AUTH_MARKER_RE.test(source)) offenders.push(file);
    }
    expect(
      offenders,
      `Route modules defining handlers without any shared auth helper. ` +
        `Either add jwtAuth/apiKeyAuth/requireAuth (see _shared/auth.ts) or, if the ` +
        `endpoint is deliberately anonymous, add it to PUBLIC_ROUTES with a justification: ` +
        offenders.join(', '),
    ).toEqual([]);
  });

  it('public allowlist entries still exist and still define handlers', () => {
    for (const file of Object.keys(PUBLIC_ROUTES)) {
      const source = readFileSync(resolve(ROUTES_ROOT, file), 'utf8');
      expect(HANDLER_RE.test(source), `${file} no longer defines handlers — prune the allowlist`).toBe(
        true,
      );
    }
  });
});
