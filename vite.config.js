import { defineConfig } from 'vite';

// base './' keeps asset URLs relative so the site works on https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: false },
});
