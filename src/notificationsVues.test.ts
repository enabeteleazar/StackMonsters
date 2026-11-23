import { afterEach, describe, expect, it, vi } from 'vitest'
import { marquerPopupVue, oublierDonneesLocales, popupsVues } from './notificationsVues'

/** localStorage minimal (les tests tournent sans navigateur). */
function stockage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial))
  return {
    get length() { return m.size },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    cles: () => [...m.keys()],
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('oublierDonneesLocales', () => {
  it('efface les clés qui contiennent l’adresse du compte supprimé, et seulement elles', () => {
    const s = stockage({ 'sm_consentement': '{}', 'sm-notifs-vues:autre@example.com': '["x"]' })
    vi.stubGlobal('localStorage', s)
    marquerPopupVue('alex@example.com', 'n-1-signalee')
    s.setItem('autre-cle:Alex@Example.com', '1')
    expect(popupsVues('alex@example.com').has('n-1-signalee')).toBe(true)

    oublierDonneesLocales(' Alex@example.com ')
    expect(s.cles().sort()).toEqual(['sm-notifs-vues:autre@example.com', 'sm_consentement'])
    expect(popupsVues('alex@example.com').size).toBe(0)
  })

  it('ne lève rien si le stockage est indisponible', () => {
    vi.stubGlobal('localStorage', { get length(): number { throw new Error('bloqué') } })
    expect(() => oublierDonneesLocales('alex@example.com')).not.toThrow()
  })
})
