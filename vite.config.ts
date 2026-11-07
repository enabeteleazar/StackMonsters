import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { env } from 'node:process'

// Sur Vercel le site est servi à la racine, et l'API sous /api (voir api/index.py).
// Aucune URL absolue ni aucun port ne doit apparaître dans le bundle :
// le front parle toujours au service par un chemin relatif (voir src/config.ts).
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    // ZXing part dans son propre morceau, chargé au premier scan seulement.
    rollupOptions: {
      output: {
        manualChunks: { zxing: ['barcode-detector'] },
      },
    },
  },
  server: {
    port: 5273,
    // En développement, ./dev.sh lance l'API (uvicorn) sur 8055.
    proxy: {
      '/api': { target: env.E2E_API_PROXY_TARGET ?? 'http://127.0.0.1:8055', changeOrigin: true },
    },
  },
})
