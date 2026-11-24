import { execFileSync } from 'node:child_process'

/**
 * Avant chaque suite : base e2e remise à zéro (schéma vidé puis migré) par scripts/reinit_e2e.py, qui refuse toute
 * base non locale ou dont le nom n'est pas « sm_e2e » / « e2e_… ». Un refus arrête la suite avant le premier test.
 */
export default function globalSetup() {
  execFileSync(process.env.E2E_PYTHON ?? 'python', ['scripts/reinit_e2e.py'], { stdio: 'inherit', env: process.env })
}
