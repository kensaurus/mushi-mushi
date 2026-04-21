# @mushi-mushi/node

## 0.2.0

### Minor Changes

- 81336e9: Initial release — `@mushi-mushi/node` server-side instrumentation SDK.
  - Framework middleware: Express (`/express`), Fastify (`/fastify`), Hono (`/hono`).
  - `attachUnhandledHook()` for `unhandledRejection` / `uncaughtException` → Mushi reports.
  - Automatic W3C Trace Context + `sentry-trace` header propagation for bidirectional Sentry/Datadog correlation.
  - Never throws — transport failures warn once and continue so instrumentation can't take down the host service.

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/core@0.3.0
