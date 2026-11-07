import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { env as processEnv } from 'node:process'

// Sur Vercel le site est servi à la racine, et l'API sous /api (voir api/index.py).
// Aucune URL absolue ni aucun port ne doit apparaître dans le bundle :
// le front parle toujours au service par un chemin relatif (voir src/config.ts).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const statusApp = (processEnv.STATUS_APP ?? env.STATUS_APP ?? 'PRODUCTION').trim().toUpperCase()

  if (!['MAINTENANCE', 'PRODUCTION'].includes(statusApp)) {
    throw new Error('STATUS_APP must be either MAINTENANCE or PRODUCTION.')
  }

  return {
    base: '/',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'status-app-page',
        transformIndexHtml: {
          order: 'pre',
          handler(html) {
            return statusApp === 'MAINTENANCE'
              ? readFileSync(resolve(process.cwd(), 'maintenance.html'), 'utf8')
              : html
          },
        },
      },
    ],
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
        '/api': { target: 'http://127.0.0.1:8055', changeOrigin: true },
      },
    },
  }
})
