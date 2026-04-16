import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  target: 'es2022',
  external: ['react', 'react-native', '@react-navigation/native', '@react-native-async-storage/async-storage'],
})
