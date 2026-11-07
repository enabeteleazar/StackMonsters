import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('E2E tests require TEST_DATABASE_URL pointing to an isolated local database.')
}

const parsedDatabaseUrl = new URL(databaseUrl)
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)).toLowerCase()
if (!localHosts.has(parsedDatabaseUrl.hostname) || !databaseName.includes('test')) {
  throw new Error(
    'E2E tests only run against a loopback Postgres host and a database name containing "test".',
  )
}

const apiUrl = 'http://127.0.0.1:18055'
const python = process.env.E2E_PYTHON ?? (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3')
const webServer =
  process.env.E2E_EXTERNAL_SERVERS === '1'
    ? undefined
    : [
        {
          command: `${python} -m uvicorn tests.e2e.serve_api:app --host 127.0.0.1 --port 18055`,
          url: `${apiUrl}/__e2e__/health`,
          reuseExistingServer: false,
          timeout: 30_000,
          env: {
            TEST_DATABASE_URL: databaseUrl,
            SESSION_SECRET: 'stackmonster-e2e-session-secret',
          },
        },
        {
          command: 'node_modules/.bin/vite --host 127.0.0.1 --port 5275 --strictPort',
          url: 'http://127.0.0.1:5275/',
          reuseExistingServer: false,
          timeout: 30_000,
          env: { E2E_API_PROXY_TARGET: apiUrl },
        },
      ]

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5275',
    trace: 'retain-on-failure',
  },
  webServer,
})
