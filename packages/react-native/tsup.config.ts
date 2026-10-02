import { defineConfig } from 'tsup'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { preserveOptionalRequires } from './src/bundling/preserve-optional-requires'

const require = createRequire(import.meta.url)
const pkg = require('./package.json') as { version: string }

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  define: {
    __MUSHI_SDK_VERSION__: JSON.stringify(pkg.version),
  },
  external: ['react', 'react-native', '@react-navigation/native', '@react-native-async-storage/async-storage'],
  // esbuild's ESM output turns `require('x')` into its `__require('x')` shim,
  // which Metro can not resolve (it crashed host apps in 0.21–0.23). Put the
  // literal require back for the optional native peers and fail the build on
  // any shim call left (src/bundling/preserve-optional-requires.ts).
  async onSuccess() {
    for (const file of ['dist/index.js', 'dist/index.cjs']) {
      const { code, rewritten, leftovers } = preserveOptionalRequires(readFileSync(file, 'utf8'))
      if (leftovers.length > 0) {
        throw new Error(`${file}: esbuild require shim left in the bundle: ${leftovers.join(', ')}`)
      }
      writeFileSync(file, code)
      if (rewritten > 0) console.warn(`[tsup] ${file}: restored ${rewritten} literal optional require(s)`)
    }
  },
})
