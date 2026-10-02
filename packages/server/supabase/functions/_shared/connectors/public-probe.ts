/**
 * FILE: packages/server/supabase/functions/_shared/connectors/public-probe.ts
 * PURPOSE: `public_probe` (ADR 0017): RDAP, certificate logs, the iTunes
 *          Search API, public Play listings and site headers. No credential,
 *          so it is always connected; every fetch goes through publicFetch.
 *          The detectors themselves live in radar/public-probes.ts.
 */

import { publicFetch } from '../safe-fetch.ts'
import { runPublicProbes } from '../radar/public-probes.ts'
import { targetFromManifest } from '../radar/run.ts'
import type { DetectorResult } from '../radar/types.ts'
import type { ConnectorSnapshot, DriftFinding, RecipeConnector } from './types.ts'

export const publicProbeConnector: RecipeConnector = {
  kind: 'public_probe',
  title: 'Public checks',
  capabilities: ['snapshot', 'drift'],
  requiredScopes: {},
  credentialNote: 'Needs no credential. Reads only public pages: domain registry (RDAP), certificate logs, the App Store and Google Play listings, and your site headers.',
  async probe() {
    return { ok: true, status: 'connected', granted: ['public'], missing: [] }
  },
  async snapshot(ctx) {
    const manifest = ctx.config.manifest ?? null
    const target = targetFromManifest(manifest)
    const fetcher = (url: string) => publicFetch(url, { fetchImpl: ctx.fetch as typeof fetch })
    const results = await runPublicProbes(target, fetcher, ctx.now())
    const finding = results.filter((r) => r.state === 'finding').length
    const snap: ConnectorSnapshot = {
      observedAt: ctx.now().toISOString(),
      elements: {},
      resources: target.domains.map((d) => ({ kind: 'domain', externalId: d, role: 'site' })),
      facts: { results },
    }
    snap.elements.integrations = { summary: { publicChecks: results.length, withFindings: finding } }
    return snap
  },
  detectDrift(_prev, next) {
    const results = (next.facts.results ?? []) as DetectorResult[]
    return results.flatMap((r) => r.findings.map((f): DriftFinding => ({
      gate: 'radar',
      ruleId: f.ruleId,
      severity: f.severity,
      message: f.message,
      filePath: f.filePath ?? null,
      suggestedFix: { kind: 'prompt', text: f.fix },
    })))
  },
}
