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
  use: { baseURL: 'http://127.0.0.1:5273', ...devices['Pixel 7'] },
  webServer: [
    {
      command: `${python} -m uvicorn api.index:app --host 127.0.0.1 --port 8055 >> ${JOURNAL_API} 2>&1`,
      url: 'http://127.0.0.1:8055/auth/moi',
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: base,
        AUTH_DEV: '1',
        RESEND_API_KEY: '',
        SESSION_SECRET: 'e2e-session-secret',
        OWNER_EMAIL: 'proprietaire-e2e@example.com',
        // Tous les comptes de test viennent de 127.0.0.1 : la limite par IP les bloquerait.
        SM_COMPTES_MAX_IP_JOUR: '1000',
      },
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 5273 --strictPort',
      url: 'http://127.0.0.1:5273',
      reuseExistingServer: false,
    },
  ],
})
