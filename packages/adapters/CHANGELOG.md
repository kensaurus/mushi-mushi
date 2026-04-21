# @mushi-mushi/adapters

## 0.2.0

### Minor Changes

- 81336e9: Initial release — `@mushi-mushi/adapters` turns any monitoring tool into a Mushi report source.
  - Datadog monitor alerts → Mushi report.
  - Honeycomb triggers → Mushi report.
  - New Relic alert policies → Mushi report.
  - Grafana Alertmanager / Loki → Mushi report.

  Each adapter exposes both a pure `translate<Vendor>()` function and a ready-to-mount `create<Vendor>WebhookHandler()` so Mushi slots in alongside whatever observability stack you already run.

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/core@0.3.0
