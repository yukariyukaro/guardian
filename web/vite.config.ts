import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  // Production must explicitly select the real public API; never fall back to fixtures.
  if (mode === 'production' && env.VITE_API_MODE !== 'real') {
    throw new Error('Production requires VITE_API_MODE=real. Use pnpm dev for mock previews.');
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api/v1/public': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
    },
    preview: { port: 4173, strictPort: true },
    build: { sourcemap: false },
  };
});
