import { API_URL } from './config'
import type { Canette } from './types'

async function requete<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_URL + chemin, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
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
