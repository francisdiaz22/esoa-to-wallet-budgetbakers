import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const clientPort = Number.parseInt(process.env.E2E_CLIENT_PORT ?? '4300', 10);
const apiPort = Number.parseInt(process.env.E2E_API_PORT ?? '4310', 10);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: clientPort,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
    },
  },
  preview: {
    host: '127.0.0.1',
  },
});
