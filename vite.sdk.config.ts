import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** Builds the JavaScript SDK (full engine + REST client) into dist/sdk. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: false,
    target: 'es2020',
    lib: {
      entry: resolve(__dirname, 'src/sdk/index.ts'),
      name: 'CalciCore',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'calci.js' : 'calci.umd.cjs'),
    },
    sourcemap: true,
  },
});
