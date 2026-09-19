import { describe, expect, it } from 'vitest'
import { CANETTE_VIDE, ETATS } from './types'

describe('CANETTE_VIDE', () => {
  it('crée une canette vide avec l\'EAN fourni', () => {
    const canette = CANETTE_VIDE('3017620422003')

    expect(canette.ean).toBe('3017620422003')
    expect(canette.etat).toBe('Vide')
    expect(canette.nb).toBe(1)
    expect(canette.photo).toBeNull()
    expect(canette.nom).toBe('')
  })

  it('horodate l\'ajout avec une date ISO valide', () => {
    const canette = CANETTE_VIDE('123')
    expect(() => new Date(canette.ajout).toISOString()).not.toThrow()
    expect(new Date(canette.ajout).toISOString()).toBe(canette.ajout)
  })
})

describe('ETATS', () => {
  it('contient les quatre états attendus', () => {
    expect(ETATS).toEqual(['Pleine', 'Vide', 'Ouverte proprement', 'Cabossée'])
  })
})
