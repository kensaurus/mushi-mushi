/**
 * FILE: apps/admin/src/lib/davManifest.ts
 * PURPOSE: Decide → Act → Verify manifest — the single typed source mapping each
 *          page scope to its per-tile metadata:
 *
 *            • configIds   which configDocs IDs are relevant for this tile
 *                          (drives the "Where it lives" lineage strip in the
 *                          detail panel — zero copy duplicated, just a reference
 *                          into the existing configDocs dictionary)
 *
 *            • tileMeaning  a one-sentence plain-English description of what
 *                           DECIDE / ACT / VERIFY means on this specific page,
 *                           used as a fallback heading in the detail panel when
 *                           the page passes no custom `evidence.whyNow`
 *
 *          The DavEvidence discriminated union is also exported from here so
 *          it travels as one import alongside the manifest.
 */

// ─── Evidence types ────────────────────────────────────────────────────────

/**
 * Structured live data passed by the consumer page into the hero tile.
 * The detail panel picks the rendering path from `kind`.
 */
export type DavEvidence =
  | {
      kind: 'metric-breakdown'
      /** Human-readable sentence for the "Why now" section. When absent the
       *  manifest's `tileMeaning` is used as a fallback. */
      whyNow?: string
      items: Array<{
        label: string
        value: string | number
        /** Tone applied to the value chip. */
        tone?: 'ok' | 'warn' | 'crit' | 'info' | 'neutral'
      }>
    }
  | {
      kind: 'rule-trace'
      /** Human-readable sentence: "Why this action is the right next step." */
      why: string
      /** Optional threshold/condition that fired the rule (e.g. "errorRate > 5%"). */
      threshold?: string
    }
  | {
      kind: 'last-event'
      /** ISO timestamp of the most recent event. */
      at: string
      /** Who/what performed the event (model name, job name, actor email). */
      by: string
      /** Brief summary of the event payload. */
      payloadSummary: string
      /** Outcome status. */
      status?: 'ok' | 'warn' | 'error'
    }

// ─── Manifest types ────────────────────────────────────────────────────────

interface DavTileManifest {
  /** IDs from configDocs.ts whose backend lineage is shown in this tile's
   *  detail panel. Keep to ≤ 3 — more overwhelms the panel. */
  configIds?: string[]
  /** One sentence: what does DECIDE / ACT / VERIFY mean on THIS page.
   *  Used as a fallback "Why now" heading when the page passes no evidence. */
  tileMeaning: string
}

export interface DavScopeManifest {
  decide: DavTileManifest
  act: DavTileManifest
  verify: DavTileManifest
}

// ─── The registry ──────────────────────────────────────────────────────────

export const DAV_MANIFEST: Record<string, DavScopeManifest> = {
  health: {
    decide: {
      configIds: ['settings.byok.anthropic_key', 'settings.general.stage2_model'],
      tileMeaning: 'Is the pipeline processing reports correctly, without errors or excessive fallbacks?',
    },
    act: {
      configIds: ['settings.byok.openai_key', 'settings.general.stage2_model'],
      tileMeaning: 'Probe the LLM provider connections or trigger a cron job to restore pipeline health.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Inspect the most recent LLM call and cron-run receipts to confirm the pipeline is serving traffic.',
    },
  },

  audit: {
    decide: {
      configIds: [],
      tileMeaning: 'Are there FAIL or WARN audit events in the current window that require action?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Navigate to the failed controls that need remediation before the next SOC 2 cycle.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'The most recent audit event confirms platform changes are still being recorded.',
    },
  },

  compliance: {
    decide: {
      configIds: ['compliance.retention.reports_days', 'compliance.legal_hold'],
      tileMeaning: 'Do any controls, DSARs, or retention windows show a failing state?',
    },
    act: {
      configIds: ['compliance.dsar.subject_email', 'compliance.legal_hold'],
      tileMeaning: 'Close open DSARs, remediate failing controls, or toggle legal hold.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when evidence was last refreshed and whether any controls failed the most recent snapshot.',
    },
  },

  intelligence: {
    decide: {
      configIds: ['intelligence.benchmarking_optin'],
      tileMeaning: 'Is a weekly intelligence digest available, and are modernization findings waiting for triage?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Generate a fresh digest or review the trending category that the digest flagged.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when the latest digest was generated and whether an active generation job is in flight.',
    },
  },

  judge: {
    decide: {
      configIds: ['settings.general.stage2_model'],
      tileMeaning: 'What is the current overall judge score, and is it trending up or down week-over-week?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Trigger a fresh judge batch, or investigate the prompts causing high disagreement rates.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when the last evaluation ran and which judge model graded it.',
    },
  },

  graph: {
    decide: {
      configIds: ['integrations.github.repo_url'],
      tileMeaning: 'How many fragile components exist, and does the graph have index coverage for all repos?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Dispatch a fix batch for fragile components, or trigger the repo indexer to populate missing nodes.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm the current node + edge counts and when the graph was last refreshed.',
    },
  },

  inventory: {
    decide: {
      configIds: [],
      tileMeaning: 'How many inventory actions are verified, and are there regressions or unknowns to triage?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Run gates to re-verify inventory actions, or run the crawler to discover missing actions.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when the last inventory ingest happened and which commit it reflects.',
    },
  },

  'anti-gaming': {
    decide: {
      configIds: ['anti-gaming.aggregate_identical'],
      tileMeaning: 'Are there cross-account fingerprints or flagged devices suggesting reward farming?',
    },
    act: {
      configIds: ['anti-gaming.flag_reason'],
      tileMeaning: 'Review and unflag devices, or quarantine cross-account reporters.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Review the most recent enforcement events to confirm the latest flags were actioned.',
    },
  },

  storage: {
    decide: {
      configIds: ['storage.provider', 'storage.bucket', 'storage.access_key_ref'],
      tileMeaning: 'Are the configured storage buckets passing upload probes and accepting new artifacts?',
    },
    act: {
      configIds: ['storage.access_key_ref', 'storage.secret_key_ref'],
      tileMeaning: 'Rotate failing credentials or configure a new bucket to restore screenshot retention.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm the most recent probe snapshot: how many buckets are healthy vs degraded vs failing.',
    },
  },

  query: {
    decide: {
      configIds: [],
      tileMeaning: 'How many saved queries exist, and has the team been actively querying their bug data?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Save your first query as a one-click tile, or run an existing saved query against live data.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when a query was last run and whether there are team-shared queries to discover.',
    },
  },

  dlq: {
    decide: {
      configIds: [],
      tileMeaning: 'Are there dead-letter rows, failed jobs, or a stalled worker pipeline that need attention?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Retry failed jobs, recover stranded reports, or flush the circuit-breaker queue.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Review the latest throughput snapshot to confirm completions vs failures over the recent window.',
    },
  },

  integrations: {
    decide: {
      configIds: [
        'integrations.sentry.auth_token',
        'integrations.github.repo_url',
        'integrations.github.installation_token',
      ],
      tileMeaning: 'Are all configured integrations connected, and are any tokens about to expire?',
    },
    act: {
      configIds: [
        'integrations.github.installation_token',
        'integrations.sentry.auth_token',
      ],
      tileMeaning: 'Reconnect a disconnected integration, or rotate an expiring OAuth token.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Review the most recent probe result to confirm the integration is delivering events.',
    },
  },

  // Scopes that have no special lineage — the tile meaning alone is useful.
  marketplace: {
    decide: {
      configIds: ['marketplace.plugin_webhook_url'],
      tileMeaning: 'Are there plugin updates to apply, or disabled plugins that should be re-enabled or removed?',
    },
    act: {
      configIds: ['marketplace.plugin_signing_secret'],
      tileMeaning: 'Apply pending plugin updates or configure a newly installed plugin.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm which plugins are active, disabled, or pending an update.',
    },
  },

  billing: {
    decide: {
      configIds: ['billing.plan'],
      tileMeaning: 'Are there past-due invoices or an overrunning monthly cap that need attention?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Resolve past-due invoices or raise the monthly cap before the next billing cycle.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm your current plan and the most recent invoice status.',
    },
  },

  notifications: {
    decide: {
      configIds: [],
      tileMeaning: 'Are there unread critical alerts that require immediate triage?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Open the critical inbox and triage or dismiss the highest-priority alerts.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when the most recent notification arrived and whether the inbox is clear.',
    },
  },

  queue: {
    decide: {
      configIds: [],
      tileMeaning: 'Are there stalled or running jobs that are blocking pipeline throughput?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Open stalled jobs and requeue them to unblock the processing pipeline.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm the current job counts and when the last job completed.',
    },
  },

  'prompt-lab': {
    decide: {
      configIds: ['prompt-lab.traffic_percentage'],
      tileMeaning: 'Are there untested prompt drafts, and is the eval set running on schedule?',
    },
    act: {
      configIds: ['prompt-lab.prompt_body'],
      tileMeaning: 'Run the eval set on untested drafts, or create a new draft variant to test.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when the last eval run finished and what the current champion prompt score is.',
    },
  },

  repo: {
    decide: {
      configIds: ['integrations.github.repo_url'],
      tileMeaning: 'Are all connected repos indexed, and is the most recent index still fresh?',
    },
    act: {
      configIds: ['integrations.github.installation_token'],
      tileMeaning: 'Trigger the indexer on unindexed repos, or re-index a stale repo.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm when each repo was last indexed and whether the index is current.',
    },
  },

  mcp: {
    decide: {
      configIds: ['mcp.snippet_mode'],
      tileMeaning: 'Are all MCP clients configured, and are any API keys expiring within 7 days?',
    },
    act: {
      configIds: [],
      tileMeaning: 'Rotate expiring MCP keys or complete the install for unconfigured clients.',
    },
    verify: {
      configIds: [],
      tileMeaning: 'Confirm which MCP clients are active and when their keys were last rotated.',
    },
  },
}

/** Look up the manifest entry for a scope. Returns `undefined` for unknown
 *  scopes — callers should handle this gracefully (show less metadata,
 *  not an error). */
export function getDavManifest(scope: string): DavScopeManifest | undefined {
  return DAV_MANIFEST[scope]
}
