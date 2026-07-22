---
"@mushi-mushi/core": patch
---

Internal: dedupe the ingest endpoint URL — `region.ts` now imports the canonical `DEFAULT_API_ENDPOINT` from `api-client.ts` instead of hardcoding the Supabase host in three places. No behavior change (all regions currently resolve to the same US gateway); removes a self-hoster drift risk.
