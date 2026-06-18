import { defineConfig } from 'tsup'
import { createRequire } from 'node:module'

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
})
