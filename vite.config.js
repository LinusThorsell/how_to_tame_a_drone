import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/multiplayer/socket.io': {
        target: process.env.MULTIPLAYER_PROXY_TARGET || 'http://localhost:3001',
        ws: true
      }
    }
  },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900
  }
});
