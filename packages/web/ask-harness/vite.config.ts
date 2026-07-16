import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Plain object config — no `vite` package import (run via apps/admin vite binary). */
export default {
  root: __dirname,
  server: {
    port: 5199,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@mushi-mushi/core': path.resolve(__dirname, '../../core/src/index.ts'),
    },
  },
}
