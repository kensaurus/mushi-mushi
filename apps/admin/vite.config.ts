import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// Base path is environment-driven so the same build works for:
//   - local dev      (VITE_BASE_PATH unset → "/")
//   - self-hosted    (any path the operator wants, e.g. "/admin/")
//   - kensaur.us     (set to "/mushi-mushi/admin/" in .github/workflows/deploy-admin.yml)
// The router (`BrowserRouter basename={import.meta.env.BASE_URL}`) and auth
// redirects (`lib/auth.tsx`) already read `BASE_URL`, so no other code needs
// to change when this flips.
const basePath = process.env.VITE_BASE_PATH ?? '/'

// Version + build provenance baked into the bundle so the in-app
// VersionBadge can render the running admin version, the @mushi-mushi/web
// SDK version, the git SHA, and the build date without a network round-trip.
// Falls back gracefully when the source files or git aren't reachable so
// the build never breaks in odd CI / sandbox environments.
function readPkgVersion(relPath: string): string {
  try {
    const raw = readFileSync(path.resolve(__dirname, relPath), 'utf8')
    return JSON.parse(raw).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
function readGitSha(): string {
  // Honour CI-injected SHAs first (GitHub Actions sets GITHUB_SHA), then a
  // VITE_RELEASE override (used by Sentry release tagging), and finally fall
  // back to a local `git rev-parse` so dev builds still show "abc1234".
  const fromCi = process.env.GITHUB_SHA ?? process.env.VITE_RELEASE
  if (fromCi) return fromCi.replace(/^[a-z]+@/i, '').slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'dev'
  }
}

// CI sets VITE_RELEASE to "0.1.${COMMIT_COUNT}" (see deploy-admin.yml).
// Prefer that over the static package.json value so the in-app VersionBadge
// pill always matches the number visible in version.json and Sentry.
// The server package stays at 0.0.0 in package.json because it is BSL and
// not published to npm; the deployed server comes from the same git SHA as
// the admin, so VITE_RELEASE is an honest stand-in for its version too.
const APP_VERSION = process.env.VITE_RELEASE ?? readPkgVersion('./package.json')
const SDK_WEB_VERSION = readPkgVersion('../../packages/web/package.json')
const SDK_REACT_VERSION = readPkgVersion('../../packages/react/package.json')
const SERVER_VERSION = process.env.VITE_RELEASE ?? readPkgVersion('../../packages/server/package.json')
// Additional public SDK packages
const SDK_CORE_VERSION = readPkgVersion('../../packages/core/package.json')
const SDK_VUE_VERSION = readPkgVersion('../../packages/vue/package.json')
const SDK_SVELTE_VERSION = readPkgVersion('../../packages/svelte/package.json')
const SDK_ANGULAR_VERSION = readPkgVersion('../../packages/angular/package.json')
const SDK_RN_VERSION = readPkgVersion('../../packages/react-native/package.json')
const SDK_CLI_VERSION = readPkgVersion('../../packages/cli/package.json')
const SDK_MCP_VERSION = readPkgVersion('../../packages/mcp/package.json')
const SDK_NODE_VERSION = readPkgVersion('../../packages/node/package.json')
const SDK_CAPACITOR_VERSION = readPkgVersion('../../packages/capacitor/package.json')
const SDK_PLUGIN_SDK_VERSION = readPkgVersion('../../packages/plugin-sdk/package.json')
const SDK_PLUGIN_JIRA_VERSION = readPkgVersion('../../packages/plugin-jira/package.json')
const SDK_PLUGIN_LINEAR_VERSION = readPkgVersion('../../packages/plugin-linear/package.json')
const SDK_PLUGIN_PAGERDUTY_VERSION = readPkgVersion('../../packages/plugin-pagerduty/package.json')
const SDK_PLUGIN_SENTRY_VERSION = readPkgVersion('../../packages/plugin-sentry/package.json')
const SDK_PLUGIN_SLACK_VERSION = readPkgVersion('../../packages/plugin-slack-app/package.json')
const SDK_PLUGIN_ZAPIER_VERSION = readPkgVersion('../../packages/plugin-zapier/package.json')
const SDK_ADAPTERS_VERSION = readPkgVersion('../../packages/adapters/package.json')
const SDK_WASM_VERSION = readPkgVersion('../../packages/wasm-classifier/package.json')
const CREATE_MUSHI_VERSION = readPkgVersion('../../packages/create-mushi-mushi/package.json')
const LAUNCHER_VERSION = readPkgVersion('../../packages/launcher/package.json')
const BUILD_SHA = readGitSha()
const BUILD_DATE = new Date().toISOString().slice(0, 10)

// Sentry sourcemap upload runs only when all three env vars are set. CI sets
// them via GitHub Secrets; local dev leaves them unset so builds stay offline.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT_ADMIN ?? process.env.SENTRY_PROJECT
const sentryRelease = process.env.VITE_RELEASE
const sentryEnabled = Boolean(sentryAuthToken && sentryOrg && sentryProject)

export default defineConfig({
  base: basePath,
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __SDK_WEB_VERSION__: JSON.stringify(SDK_WEB_VERSION),
    __SDK_REACT_VERSION__: JSON.stringify(SDK_REACT_VERSION),
    __SERVER_VERSION__: JSON.stringify(SERVER_VERSION),
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    // Extended SDK catalog
    __SDK_CORE_VERSION__: JSON.stringify(SDK_CORE_VERSION),
    __SDK_VUE_VERSION__: JSON.stringify(SDK_VUE_VERSION),
    __SDK_SVELTE_VERSION__: JSON.stringify(SDK_SVELTE_VERSION),
    __SDK_ANGULAR_VERSION__: JSON.stringify(SDK_ANGULAR_VERSION),
    __SDK_RN_VERSION__: JSON.stringify(SDK_RN_VERSION),
    __SDK_CLI_VERSION__: JSON.stringify(SDK_CLI_VERSION),
    __SDK_MCP_VERSION__: JSON.stringify(SDK_MCP_VERSION),
    __SDK_NODE_VERSION__: JSON.stringify(SDK_NODE_VERSION),
    __SDK_CAPACITOR_VERSION__: JSON.stringify(SDK_CAPACITOR_VERSION),
    __SDK_PLUGIN_SDK_VERSION__: JSON.stringify(SDK_PLUGIN_SDK_VERSION),
    __SDK_PLUGIN_JIRA_VERSION__: JSON.stringify(SDK_PLUGIN_JIRA_VERSION),
    __SDK_PLUGIN_LINEAR_VERSION__: JSON.stringify(SDK_PLUGIN_LINEAR_VERSION),
    __SDK_PLUGIN_PAGERDUTY_VERSION__: JSON.stringify(SDK_PLUGIN_PAGERDUTY_VERSION),
    __SDK_PLUGIN_SENTRY_VERSION__: JSON.stringify(SDK_PLUGIN_SENTRY_VERSION),
    __SDK_PLUGIN_SLACK_VERSION__: JSON.stringify(SDK_PLUGIN_SLACK_VERSION),
    __SDK_PLUGIN_ZAPIER_VERSION__: JSON.stringify(SDK_PLUGIN_ZAPIER_VERSION),
    __SDK_ADAPTERS_VERSION__: JSON.stringify(SDK_ADAPTERS_VERSION),
    __SDK_WASM_VERSION__: JSON.stringify(SDK_WASM_VERSION),
    __CREATE_MUSHI_VERSION__: JSON.stringify(CREATE_MUSHI_VERSION),
    __LAUNCHER_VERSION__: JSON.stringify(LAUNCHER_VERSION),
  },
  plugins: [
    react(),
    tailwindcss(),
    ...(sentryEnabled
      ? [
          sentryVitePlugin({
            org: sentryOrg,
            project: sentryProject,
            authToken: sentryAuthToken,
            release: sentryRelease ? { name: sentryRelease } : undefined,
            // Generated maps are uploaded then deleted so the public S3 bucket
            // never serves them — only the upload-side Sentry copy survives.
            sourcemaps: {
              filesToDeleteAfterUpload: ['./apps/admin/dist/**/*.map'],
            },
            telemetry: false,
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force Vite 8 to resolve the workspace @mushi-mushi/web package to the
      // built dist rather than failing static import analysis. The package is
      // always built before starting dev (pnpm --filter @mushi-mushi/web build).
      '@mushi-mushi/web': path.resolve(__dirname, '../../packages/web/dist/index.js'),
    },
  },
  optimizeDeps: {
    // Pre-bundle workspace packages so Vite doesn't fail when mushi-self.ts
    // does a lazy import('@mushi-mushi/web').
    include: ['@mushi-mushi/web'],
  },
  build: {
    // Required for Sentry to symbolicate stack traces. Maps are deleted from
    // dist after upload (see filesToDeleteAfterUpload above).
    sourcemap: true,
    rollupOptions: {
      output: {
        // PERF-3 (audit 2026-04-21): every route is already React.lazy()'d,
        // but the "shared vendor" bundle was shipping react + recharts +
        // mapbox + @supabase together as one ~1.4 MB chunk. Split into
        // logical vendor groups so first-paint only needs react+router+
        // supabase (the login + dashboard path) and heavy visualisation
        // libs load on demand when the user opens those pages.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Core framework — needed by every page; keep tiny.
          if (id.includes('react/') || id.includes('react-dom/') || id.includes('react-router')) {
            return 'vendor-react'
          }
          // Error instrumentation — on every page, but independently updated.
          if (id.includes('@sentry/') || id.includes('@sentry-internal/')) return 'vendor-sentry'
          // Supabase + api surface — on every page that hits the API.
          if (id.includes('@supabase/')) return 'vendor-supabase'
          // Charts: Recharts + d3 — loaded only by Health, Billing, Dashboard.
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) {
            return 'vendor-charts'
          }
          // Maps — only by the handful of pages that render geography.
          if (id.includes('mapbox-gl') || id.includes('maplibre-gl') || id.includes('@mapbox/')) {
            return 'vendor-maps'
          }
          // Animation — framer-motion / motion-dom; loaded by pages with transitions.
          if (id.includes('framer-motion') || id.includes('motion-dom') || id.includes('motion-utils')) {
            return 'vendor-motion'
          }
          // Markdown + syntax highlighting — only by Report detail + Prompt lab.
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('shiki') || id.includes('highlight.js')) {
            return 'vendor-markdown'
          }
          // Data table runtime — only by list pages.
          if (id.includes('@tanstack/react-table') || id.includes('@tanstack/react-virtual')) {
            return 'vendor-table'
          }
          // Everything else — small misc vendor code.
          return 'vendor-misc'
        },
      },
    },
  },
  server: {
    port: 6464,
    // pnpm workspace packages resolve via symlinks under ../../packages;
    // without this, Vite 8 refuses to serve/transform @mushi-mushi/web (mushi-self.ts).
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
    proxy: {
      // Forward the testers public marketplace to its own Next.js dev server.
      // Run `pnpm --filter @mushi-mushi/testers dev` on port 3001 separately.
      '/mushi-mushi/testers': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
