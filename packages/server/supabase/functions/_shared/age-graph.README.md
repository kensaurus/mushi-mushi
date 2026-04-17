# Apache AGE knowledge-graph backend (V5.3 §2.17)

The Mushi Mushi knowledge graph started life as two relational tables
(`graph_nodes`, `graph_edges`) plus a `WITH RECURSIVE` blast-radius
materialised view. That works fine up to ~1M edges per project but recursive
CTE traversals get expensive past that point.

We are migrating to [Apache AGE](https://age.apache.org/) — a Postgres
extension that adds Cypher and proper graph storage — in three phases.

## Where we are: **Phase 1 — parallel write**

Status: **opt-in, default OFF.** Self-hosters who install the AGE extension
can enable it per project; the canonical Cloud uses Supabase managed Postgres
which does not currently ship AGE (graceful no-op fallback applies).

| Backend setting     | What writes to AGE? | What reads from AGE? |
| ------------------- | ------------------- | -------------------- |
| `sql_only` *(default)* | nothing            | nothing              |
| `sql_age_parallel`  | every node + edge   | nothing — SQL still authoritative |
| `age_only`          | reserved for Phase 3 (refused today) | reserved |

Every successful SQL `INSERT` into `graph_nodes` / `graph_edges` triggers a
fire-and-forget `MERGE` Cypher upsert via the SECURITY DEFINER helpers
`mushi_age_upsert_node` / `mushi_age_upsert_edge`. AGE failures are logged
as `WARNING`s (not `ERROR`s) so the SQL transaction is never rolled back.

`graph_nodes.age_synced_at` and `graph_edges.age_synced_at` are stamped on
successful mirror, so drift is queryable directly:

```sql
SELECT count(*) FROM graph_nodes
 WHERE project_id = :pid AND age_synced_at IS NULL;
```

The hourly drift snapshot (`mushi_age_snapshot_drift(p_project_id)`) writes
one row to `age_drift_audit` and is exposed at
`POST /v1/admin/graph-backend/snapshot`.

### Enabling for a project (operator)

```sql
-- Make sure AGE is loaded.
SELECT mushi_age_available();   -- expect: true

-- Flip the project setting.
UPDATE project_settings
   SET graph_backend = 'sql_age_parallel'
 WHERE project_id = '...';
```

Or via the admin API:

```http
PATCH /v1/admin/settings
Authorization: Bearer <jwt>
Content-Type: application/json

{ "graph_backend": "sql_age_parallel" }
```

## Phase 2 — reconciliation (planned, V5.4)

Adds a background worker that walks unsynced rows, replays them into AGE,
and reports per-row diffs. Required before any read traffic shifts.

Acceptance criteria for entering Phase 2:
1. ≥ 1 month of `sql_age_parallel` running on the canonical Cloud
   tenant with `< 0.1%` drift across audits.
2. `mushi_age_snapshot_drift` p99 latency `< 250 ms` per project.

## Phase 3 — read cutover (planned, V5.5)

`get_blast_radius` and the NL-query graph traversals start consuming AGE.
The `blast_radius_cache` materialised view stays warm for one release as a
safety net and is then dropped. After that, `graph_backend = 'age_only'` is
permitted; new tenants get it by default.

Acceptance criteria for entering Phase 3:
1. Phase 2 reconciliation worker has run continuously for ≥ 30 days with
   `0` reconciliations needed in the steady state.
2. AGE Cypher equivalents of every consumer of `blast_radius_cache` /
   `get_blast_radius` are implemented and benchmarked at parity or better.

## Notes on the implementation

- **Fire-and-forget mirror.** Mirror writes happen *after* the SQL write
  commits and intentionally do not await the result in the calling fix /
  classify pipelines. This keeps the report-ingestion latency unchanged
  for tenants on `sql_only` and adds at most one Postgres round-trip for
  tenants on `sql_age_parallel`.
- **Cache.** `getGraphBackend` caches the per-project setting in-process
  for 60 s to avoid hammering `project_settings` on every node/edge upsert.
  Settings changes via the admin API should call
  `invalidateBackendCache(projectId)` after a successful PATCH if you want
  the next ingest to see the change immediately.
- **Multi-tenant.** Both AGE upsert helpers tag the node payload with
  `project_id`, and the Cypher queries used by the drift snapshot filter on
  it. There is exactly one AGE graph (`mushi`) — partitioning per tenant via
  separate graphs is a Phase 4 concern.
