import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the site works at https://<org>.github.io/<repo>/
  base: './',
  build: {
    target: 'es2020',
    // The wasm-sdk inlines the WASM binary as base64 — the main chunk is large by design.
    chunkSizeWarningLimit: 20000,
  },
});
