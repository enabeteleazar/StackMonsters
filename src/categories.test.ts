import { describe, expect, it } from 'vitest'
import { categorieDuNom } from './categories'

describe('categorieDuNom', () => {
  it('repère une catégorie citée dans le nom, sans tenir compte de la casse', () => {
    expect(categorieDuNom('Monster Energy Ultra White')).toBe('Ultra')
    expect(categorieDuNom('monster rehab peach tea')).toBe('Rehab')
    expect(categorieDuNom('Java Monster Salted Caramel')).toBe('Java')
  })

  it('reconnaît « Juice » comme la catégorie Juiced', () => {
    expect(categorieDuNom('Juice Monster Mango Loco')).toBe('Juiced')
    expect(categorieDuNom('Monster Juiced Pipeline Punch')).toBe('Juiced')
  })

  it('ne compte que les mots entiers', () => {
    expect(categorieDuNom('Monster Ultraviolet')).toBe('')
    expect(categorieDuNom('Monster Nitrogen')).toBe('')
  })

  it('garde la première catégorie citée', () => {
    expect(categorieDuNom('Monster Ultra Reserve')).toBe('Ultra')
  })

  it('renvoie une chaîne vide sans catégorie dans le nom', () => {
    expect(categorieDuNom('Monster Energy Mango')).toBe('')
    expect(categorieDuNom('')).toBe('')
  })
})
