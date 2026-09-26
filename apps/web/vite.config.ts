import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

export default defineConfig({
  // svgr turns the brand SVGs from design/brand into React components at build time (no SVGO: viewBox stays)
  plugins: [react(), tailwindcss(), svgr({ include: '**/*.svg?react' })],
  // the brand SVGs live in design/brand (outside this package): resolve React for them from here
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/healthz': 'http://127.0.0.1:3000',
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, manifest: true, chunkSizeWarningLimit: 1000 },
});
