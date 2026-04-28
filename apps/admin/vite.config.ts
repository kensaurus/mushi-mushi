import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'

// Base path is environment-driven so the same build works for:
//   - local dev      (VITE_BASE_PATH unset → "/")
//   - self-hosted    (any path the operator wants, e.g. "/admin/")
//   - kensaur.us     (set to "/mushi-mushi/admin/" in .github/workflows/deploy-admin.yml)
// The router (`BrowserRouter basename={import.meta.env.BASE_URL}`) and auth
// redirects (`lib/auth.tsx`) already read `BASE_URL`, so no other code needs
// to change when this flips.
const basePath = process.env.VITE_BASE_PATH ?? '/'

// Sentry sourcemap upload runs only when all three env vars are set. CI sets
// them via GitHub Secrets; local dev leaves them unset so builds stay offline.
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT_ADMIN ?? process.env.SENTRY_PROJECT
const sentryRelease = process.env.VITE_RELEASE
const sentryEnabled = Boolean(sentryAuthToken && sentryOrg && sentryProject)

export default defineConfig({
  base: basePath,
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
    },
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
          if (id.includes('@sentry/')) return 'vendor-sentry'
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
  },
})
