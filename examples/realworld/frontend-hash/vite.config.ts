import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4103,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:4101',
    },
  },
});
