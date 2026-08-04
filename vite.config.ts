import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// La base correspond au chemin servi par Caddy sur Homebox.
// Aucune URL absolue ni aucun port ne doit apparaître dans le bundle :
// le front parle toujours au service par un chemin relatif (voir src/config.ts).
export default defineConfig({
  base: '/monsters/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // ZXing part dans son propre morceau, chargé au premier scan seulement.
    rollupOptions: {
      output: {
        manualChunks: { zxing: ['@zxing/library'] },
      },
    },
  },
  server: {
    port: 5273,
    proxy: {
      '/monsters/api': {
        target: 'http://127.0.0.1:8055',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/monsters\/api/, ''),
      },
    },
  },
})
