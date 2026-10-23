import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import security from './electron/security.json' with { type: 'json' };

export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  worker: { format: 'es' },
  server: { port: 1420, strictPort: true },
  preview: { port: 1421, strictPort: true, headers: { 'Content-Security-Policy': security.csp } },
  build: { target: 'es2022', manifest: true, rolldownOptions: { input: { app: 'index.html', portal: 'portal.html' } } },
});
