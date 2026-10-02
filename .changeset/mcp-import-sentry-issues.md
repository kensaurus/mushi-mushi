---
"@mushi-mushi/mcp": minor
---

Add the `import_sentry_issues` tool: pull existing Sentry issues into the report queue by issue id, short id or a Sentry search, at most 10 per call. Each issue is deduped, linked and classified the same way a Sentry webhook delivery is; an issue already in Mushi answers `linked`.
