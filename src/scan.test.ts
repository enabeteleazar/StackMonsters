import { describe, expect, it } from 'vitest'
import { normaliserLecture } from './codeBarres'
import type { FicheWiki } from './types'
import { trouverFicheParCodeBarres } from './wiki'

const fiche = (ean: string): FicheWiki => ({
  ean, nom: 'Mango', volume: 'x', categorie: 'Ultra', flavor: '', status: '', region: '',
  description: '', photo: null, codes: [],
})

describe('scan vers Wiki', () => {
  it('retrouve une fiche quel que soit le format lu (UPC-A ou EAN-13)', () => {
    const fiches = [fiche('0036000291452')]
    expect(trouverFicheParCodeBarres(fiches, normaliserLecture('036000291452', 'upc_a'))?.categorie).toBe('Ultra')
    expect(trouverFicheParCodeBarres(fiches, normaliserLecture('0036000291452', 'ean_13'))?.volume).toBe('x')
  })
})
