/**
 * FILE: apps/admin/vite-plugin-invalidate-web-dep.ts
 * PURPOSE: Re-optimize `@mushi-mushi/web` when its workspace dist rebuilds mid-session.
 *
 * Admin aliases `@mushi-mushi/web` → `packages/web/dist/index.js` and pre-bundles
 * it via `optimizeDeps`. Without this watcher, a `pnpm --filter @mushi-mushi/web build`
 * while Vite is running leaves a stale prebundle (missing new exports) until manual
 * cache clear + restart. `predev` covers cold starts; this plugin covers hot rebuilds.
 */
import type { Plugin } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webDistIndex = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/web/dist/index.js',
)

function normalize(p: string): string {
  return p.replace(/\\/g, '/')
}

/** Re-run dependency optimization when the workspace web package dist changes. */
export function invalidateWebWorkspaceDep(): Plugin {
  return {
    name: 'mushi-invalidate-web-workspace-dep',
    configureServer(server) {
      server.watcher.add(webDistIndex)
      server.watcher.on('change', (changed) => {
        if (normalize(changed) !== normalize(webDistIndex)) return
        server.config.logger.info(
          '[vite] @mushi-mushi/web dist changed — restarting to refresh prebundle…',
        )
        // eslint-disable-next-line no-param-reassign -- Vite API: force optimizeDeps on restart
        server.config.optimizeDeps.force = true
        void server.restart()
      })
    },
  }
}
