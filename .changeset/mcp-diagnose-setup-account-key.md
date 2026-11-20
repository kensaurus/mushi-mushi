---
"@mushi-mushi/mcp": patch
---

- **`diagnose_setup` with an account key** — it now diagnoses instead of failing with `ORG_KEY_NOT_ALLOWED`. An account key (from `mushi setup` in account mode) cannot ingest, so the SDK ingest check refused it and the whole tool errored in `full` and `ingest` mode. The ingest steps are now read for the named project (`projectId`, or the configured one) from the new `GET /v1/admin/projects/:id/ingest-setup`. Without a project, the tool asks for `projectId`.
