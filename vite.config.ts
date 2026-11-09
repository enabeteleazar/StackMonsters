/// <reference types="vitest" />
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { env as processEnv } from 'node:process'

// Inscrit dans sw.js la liste des fichiers du build et une version propre à ce build :
// tout est préchargé dès l'installation, et chaque déploiement renouvelle le cache.
function serviceWorkerDuBuild(): Plugin {
  let sortie = ''
  return {
    name: 'service-worker-du-build',
    apply: 'build',
    configResolved(config) {
      sortie = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const fichiers = readdirSync(resolve(sortie, 'assets')).sort().map((nom) => `/assets/${nom}`)
      const version = createHash('sha256')
        .update(fichiers.join())
        .update(readFileSync(resolve(sortie, 'index.html')))
        .digest('hex')
        .slice(0, 12)
      const chemin = resolve(sortie, 'sw.js')
      const source = readFileSync(chemin, 'utf8')
      const final = source
        .replace("const V = 'sm-dev'", `const V = 'sm-${version}'`)
        .replace('const FICHIERS_BUILD = []', `const FICHIERS_BUILD = ${JSON.stringify(fichiers)}`)
      if (!final.includes(version) || final.includes('FICHIERS_BUILD = []')) {
        throw new Error('sw.js : emplacements de version ou de fichiers introuvables.')
      }
      writeFileSync(chemin, final)
    },
  }
}

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
      serviceWorkerDuBuild(),
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
    // Tests unitaires du dossier src seulement : ni les copies de .vercel/, ni les tests Playwright (e2e/).
    test: {
      include: ['src/**/*.test.{ts,tsx,js}'],
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
