import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The site is served from https://<user>.github.io/epub-converter/
export default defineConfig({
  base: process.env.BASE_PATH ?? '/epub-converter/',
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
