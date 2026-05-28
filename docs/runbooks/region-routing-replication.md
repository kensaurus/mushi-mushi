# Runbook: Multi-region routing and logical replication

**Last updated:** 2026-05-27
**Status:** Read replication implemented; write routing is client-side sticky.

---

## Architecture overview

Each Mushi region runs its own Helm chart against a regional Postgres primary.
Reports are written to the nearest primary; reads can be served from any replica.
The `MUSHI_CLUSTER_REGION` and `MUSHI_PEER_REGIONS` env vars (injected by the
Helm chart) tag every inbound report with a `data_residency_region` so data
stays in-region by default.

```
us-east (primary)           eu-west (primary)
┌─────────────────┐         ┌─────────────────┐
│  API pods       │         │  API pods        │
│  MUSHI_CLUSTER_ │         │  MUSHI_CLUSTER_  │
│  REGION=us      │         │  REGION=eu       │
│                 │         │                  │
│  Postgres us    │◄───────►│  Postgres eu     │
│  (primary)      │  logical│  (primary)       │
│                 │  repl.  │                  │
└─────────────────┘         └─────────────────┘
        ▲                           ▲
        │  DNS GeoDNS / latency     │
        └──────────┬────────────────┘
                   │
              Global ALB / CDN
```

## Setting up logical replication

### Step 1: Enable on the source primary (us-east)

```sql
-- Run on the us-east primary
ALTER SYSTEM SET wal_level = 'logical';
SELECT pg_reload_conf();

CREATE PUBLICATION mushi_to_eu FOR TABLE
  reports, report_evidence, projects, knowledge_graph_nodes,
  knowledge_graph_edges, fix_attempts, qa_story_runs;
```

### Step 2: Create subscription on the target (eu-west)

```sql
-- Run on the eu-west primary
CREATE SUBSCRIPTION mushi_from_us
  CONNECTION 'host=postgres-us.internal port=5432 dbname=mushi user=replicator password=<secret>'
  PUBLICATION mushi_to_eu
  WITH (copy_data = false);  -- use copy_data = true for initial backfill
```

### Step 3: Verify replication lag

```sql
-- On the source
SELECT slot_name, confirmed_flush_lsn, pg_current_wal_lsn(),
       pg_current_wal_lsn() - confirmed_flush_lsn AS lag_bytes
FROM pg_replication_slots
WHERE slot_type = 'logical';
```

### Step 4: DNS configuration (GeoDNS)

Route `api.mushimushi.io` → nearest regional ALB using latency-based routing
(AWS Route 53 / GCP Cloud DNS / Cloudflare):

```
api.mushimushi.io  CNAME  alb-us.mushimushi.io   (us-east, weight 1, latency policy)
api.mushimushi.io  CNAME  alb-eu.mushimushi.io   (eu-west, weight 1, latency policy)
api.mushimushi.io  CNAME  alb-jp.mushimushi.io   (ap-northeast, weight 1, latency policy)
```

## Helm deployment per region

```bash
helm install mushi-us ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres-us.internal \
  --set global.region=us \
  --set global.peerRegions="eu,jp"

helm install mushi-eu ./deploy/helm \
  --namespace mushi --create-namespace \
  --set global.database.host=postgres-eu.internal \
  --set global.region=eu \
  --set global.peerRegions="us,jp"
```

## Open work

- **Write routing**: Currently all writes go to the region the client hits via
  GeoDNS. If a user in EU writes through the EU primary and reads via the US
  replica, they see the row immediately from the EU primary. Cross-region reads
  have eventual-consistency with a replication lag (typically < 200 ms on a
  well-connected backbone). True active/active multi-master write routing is not
  automated — it requires application-level conflict resolution or a CRDTs
  layer.
- **Failover**: If a regional primary goes down, the replica can be promoted
  manually. Automatic failover (Patroni / pg_auto_failover) is out of scope for
  the Helm chart today.
- **Row-level residency enforcement**: `projects.data_residency_region` is
  stored per-project. Edge functions read this and reject cross-region writes
  when `MUSHI_ENFORCE_RESIDENCY=1`. This is opt-in; most teams leave it off.
