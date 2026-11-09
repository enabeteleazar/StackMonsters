import { describe, expect, it } from 'vitest'
import { choixValide, DUREE_CHOIX } from './suivi'

const T = Date.UTC(2026, 10, 9)
const enregistre = (choix: string, date: number) => JSON.stringify({ choix, date })

describe('choixValide', () => {
  it('garde un choix récent', () => {
    expect(choixValide(enregistre('oui', T), T + 1000)).toBe('oui')
    expect(choixValide(enregistre('non', T), T + 1000)).toBe('non')
  })

  it('redemande un refus après 6 mois et un accord après 13 mois', () => {
    expect(choixValide(enregistre('non', T), T + DUREE_CHOIX.non)).toBeNull()
    expect(choixValide(enregistre('oui', T), T + DUREE_CHOIX.non)).toBe('oui')
    expect(choixValide(enregistre('oui', T), T + DUREE_CHOIX.oui)).toBeNull()
  })

  it('redemande si la valeur est absente, ancienne ou illisible', () => {
    expect(choixValide(null, T)).toBeNull()
    expect(choixValide('oui', T)).toBeNull()
    expect(choixValide(enregistre('peut-etre', T), T)).toBeNull()
    expect(choixValide('{', T)).toBeNull()
  })
})
