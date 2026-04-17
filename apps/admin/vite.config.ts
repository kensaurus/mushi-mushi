import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import path from 'node:path'

// Base path is environment-driven so the same build works for:
//   - local dev      (VITE_BASE_PATH unset → "/")
//   - self-hosted    (any path the operator wants, e.g. "/admin/")
//   - kensaur.us     (set to "/mushi-mushi/" in .github/workflows/deploy-admin.yml)
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
  },
  server: {
    port: 6464,
  },
})
