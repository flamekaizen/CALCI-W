import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';


/** Serve the REST API from the dev server so /api/v1/* works locally. */
function devApi(): Plugin {
  return {
    name: 'calci-dev-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/v1')) return next();
        try {
          const mod = await server.ssrLoadModule('/src/api/handlers.ts');
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const url = `http://${req.headers.host}${req.url}`;
          const request = new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined });
          const path = new URL(url).pathname.replace(/\/+$/, '');
          const action = path === '/api/v1' ? 'index' : decodeURIComponent(path.split('/').pop() ?? '');
          const response: Response = await mod.respond(request, action);
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Native shells (desktop / mobile) load the build from the file system or a
  // custom scheme, so they need relative asset paths and no service worker.
  const nativeShell = mode === 'native';
  return {
  base: nativeShell ? './' : '/',
  plugins: [
    react(),
    devApi(),
    VitePWA({
        disable: nativeShell,
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'icons/*.png'],
        manifest: {
          name: 'Calci — Advanced Calculator',
          short_name: 'Calci',
          description: 'Scientific, graphing, 3D, programmer, matrix, solver, calculus, statistics, finance and unit conversion.',
          theme_color: '#4f46e5',
          background_color: '#0a0c11',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          globIgnores: ['sdk/**', 'embed-demo.html'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/sdk\//, /^\/embed-demo/, /\.(txt|json)$/],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
  ].filter(Boolean),
  worker: { format: 'es' },
  build: {
    outDir: nativeShell ? 'dist-native' : 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: { port: 5173 },
  };
});
