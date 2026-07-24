import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4102,
    strictPort: true,
    // Same-origin /api → the Conduit Express fixture (keeps CORS out of the
    // journey; both SDKs see realistic same-origin traffic).
    proxy: {
      '/api': 'http://localhost:4101',
    },
  },
});
