import { afterEach, describe, expect, it, vi } from 'vitest'
import { avecDelai } from './delai'

afterEach(() => vi.useRealTimers())

describe('avecDelai', () => {
  it('rend la réponse arrivée à temps', async () => {
    await expect(avecDelai(Promise.resolve('accueil'), 3000, null)).resolves.toBe('accueil')
  })

  it('continue sans réponse au-delà du délai, et ignore la réponse tardive', async () => {
    vi.useFakeTimers()
    let repondre: (v: string) => void = () => {}
    const lente = new Promise<string>((r) => (repondre = r))
    const resultat = avecDelai(lente, 3000, null)
    await vi.advanceTimersByTimeAsync(3000)
    await expect(resultat).resolves.toBeNull()
    repondre('trop tard')
    await expect(resultat).resolves.toBeNull()
  })

  it('rend le secours en cas d’erreur', async () => {
    await expect(avecDelai(Promise.reject(new Error('réseau')), 3000, null)).resolves.toBeNull()
  })
})
