import { describe, expect, it } from 'vitest'
import { ficheSauvegarde } from './sauvegarde'
import { CANETTE_VIDE } from './types'

describe('ficheSauvegarde', () => {
  it('conserve les données de collection et la photo fournie', () => {
    const canette = { ...CANETTE_VIDE('3017620422003'), nb: 4, etat: 'Pleine', notes: 'Rare', categorie: 'Ultra' }
    expect(ficheSauvegarde(canette, 'data:image/jpeg;base64,AAAA')).toMatchObject({
      ean: '3017620422003',
      nb: 4,
      etat: 'Pleine',
      notes: 'Rare',
      categorie: 'Ultra',
      photo: 'data:image/jpeg;base64,AAAA',
    })
  })
})
