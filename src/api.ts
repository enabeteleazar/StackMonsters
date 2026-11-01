import { API_URL, CLE_JETON } from './config'
import type { Canette } from './types'

/** Levée quand le service répond 401 : jeton absent ou refusé. */
export class NonAutorise extends Error {
  constructor() {
    super('Accès refusé')
  }
}

// localStorage peut lever une exception (navigation privée de Safari, par exemple).
export const jeton = {
  lire: (): string => {
    try {
      return localStorage.getItem(CLE_JETON) ?? ''
    } catch {
      return ''
    }
  },
  ecrire: (valeur: string) => {
    try {
      localStorage.setItem(CLE_JETON, valeur)
    } catch {
      /* le jeton sera redemandé au prochain chargement */
    }
  },
  effacer: () => {
    try {
      localStorage.removeItem(CLE_JETON)
      // Verrouiller vide aussi le cache hors ligne : la collection ne reste pas lisible.
      if ('caches' in window) void caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
    } catch {
      /* rien à effacer */
    }
  },
}

async function requete<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_URL + chemin, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jeton.lire()}`,
      ...(init?.headers ?? {}),
    },
  })
  if (r.status === 401) throw new NonAutorise()
  if (!r.ok) {
    const corps = await r.text().catch(() => '')
    throw new Error(`${r.status} ${corps.slice(0, 120)}`)
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}

export const api = {
  liste: () => requete<Canette[]>('/cans'),
  enregistrer: (c: Canette) =>
    requete<Canette>('/cans', { method: 'PUT', body: JSON.stringify(c) }),
  incrementer: (ean: string, delta: number) =>
    requete<Canette>(`/cans/${encodeURIComponent(ean)}/nb`, {
      method: 'PATCH',
      body: JSON.stringify({ delta }),
    }),
  supprimer: (ean: string) =>
    requete<void>(`/cans/${encodeURIComponent(ean)}`, { method: 'DELETE' }),
  sante: () => requete<{ status: string; version: string; canettes: number }>('/health'),
}
