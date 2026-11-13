import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** Builds the tiny widget loader (<calci-calculator>) into dist/sdk/calci-embed.js. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: false,
    target: 'es2019',
    lib: {
      entry: resolve(__dirname, 'src/embed/element.ts'),
      name: 'CalciEmbed',
      formats: ['iife'],
      fileName: () => 'calci-embed.js',
    },
  },
});
