import { defineConfig } from 'tsup'

// One entry per subpath in package.json "exports" (exports-build.test.ts
// pins the two together). Until 2026-09-22 seven exported subpaths —
// sentry, bugsnag, rollbar, crashlytics, firebase-analytics, cloudwatch,
// opsgenie — pointed at dist files this config never built.
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/datadog.ts',
    'src/honeycomb.ts',
    'src/new-relic.ts',
    'src/grafana-loki.ts',
    'src/sentry.ts',
    'src/bugsnag.ts',
    'src/rollbar.ts',
    'src/crashlytics.ts',
    'src/firebase-analytics.ts',
    'src/cloudwatch.ts',
    'src/opsgenie.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  target: 'node20',
})
