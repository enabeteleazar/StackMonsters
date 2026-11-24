import { defineConfig, devices } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

// Une base dédiée est obligatoire : ces tests créent et suppriment des comptes.
const base = process.env.E2E_DATABASE_URL
if (!base) throw new Error('E2E_DATABASE_URL manquante : utiliser une base jetable, jamais la production.')

const JOURNAL_API = 'e2e-results/api.log'
mkdirSync('e2e-results', { recursive: true })
writeFileSync(JOURNAL_API, '')

const python = process.env.E2E_PYTHON ?? 'python'

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts', // nom distinct : Vitest ne doit pas exécuter ces fichiers
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // Animations réduites (l'appli respecte prefers-reduced-motion) : les fumées floutées et animées en boucle de
  // l'accueil et de la connexion rendaient chaque image coûteuse dans Chromium sans écran ; sur une machine chargée,
  // Playwright attendait jusqu'à 12 s qu'un bouton soit « stable », et les parcours à plusieurs comptes dépassaient
  // les 30 s par test (échecs intermittents, par exemple « signaler un membre » au clic sur l'onglet Membres).
  // Trace gardée seulement en cas d'échec : de quoi analyser une instabilité sans ralentir les passages verts
  // (« --trace off » en ligne de commande la désactive).
  use: { baseURL: 'http://127.0.0.1:5273', ...devices['Pixel 7'], reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: [
    {
      // Base e2e remise à zéro AVANT le démarrage de l'API (scripts/reinit_e2e.py, garde-fou : locale, « sm_e2e » ou
      // « e2e_… » seulement ; un refus empêche la suite de démarrer). Pas en globalSetup : Playwright attend que le
      // serveur réponde avant de le lancer, et sur une base vide l'API répond 503, d'où un blocage.
      command: `${python} scripts/reinit_e2e.py && ${python} -m uvicorn api.index:app --host 127.0.0.1 --port 8055 >> ${JOURNAL_API} 2>&1`,
      url: 'http://127.0.0.1:8055/auth/moi',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: base,
        AUTH_DEV: '1',
        RESEND_API_KEY: '',
        SESSION_SECRET: 'e2e-session-secret',
        OWNER_EMAIL: 'proprietaire-e2e@example.com',
        // Tous les comptes de test viennent de 127.0.0.1 : les limites par IP les bloqueraient.
        SM_COMPTES_MAX_IP_JOUR: '1000',
        SM_COMPTES_MAX_HEURE: '1000',
        // Notification de test (#31) : active ici comme en Preview (absente en production : route 404, bouton caché).
        NOTIF_TEST_ACTIVE: '1',
        SM_DEMANDES_MAX_HEURE: '1000',
        SM_DEMANDES_MAX_IP: '1000',
        SM_DEMANDES_MAX_IP_JOUR: '1000',
      },
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 5273 --strictPort',
      url: 'http://127.0.0.1:5273',
      reuseExistingServer: false,
    },
  ],
})
