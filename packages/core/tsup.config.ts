import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/reporter-ui.ts', 'src/reporter-channels.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
});
