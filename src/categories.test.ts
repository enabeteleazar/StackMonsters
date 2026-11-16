import { describe, expect, it } from 'vitest'
import { categorieDuNom, varianteDuNom, volumeEnMl } from './categories'

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

  it('reconnaît une catégorie de plusieurs mots, citée en entier', () => {
    expect(categorieDuNom('Monster Killer Brew Cold Brew Coffee')).toBe('Killer Brew')
    expect(categorieDuNom('monster killer-brew vanilla')).toBe('Killer Brew')
    expect(categorieDuNom('Monster Killer Mango')).toBe('')
    expect(categorieDuNom('Monster Brew Killer')).toBe('')
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

describe('varianteDuNom', () => {
  it('repère Shot, Zero Sugar et les collaborations', () => {
    expect(varianteDuNom('Monster Energy Zero Sugar Vanilla Shot')).toBe('Shot')
    expect(varianteDuNom('Monster Energy Zero Sugar')).toBe('Zero Sugar')
    expect(varianteDuNom('Monster VR46 Rossi')).toBe('Collaboration')
    expect(varianteDuNom('Monster Energy X McLaren')).toBe('Collaboration')
    expect(varianteDuNom('Monster Energy Limited Edition Gold')).toBe('Édition limitée')
    expect(varianteDuNom('Monster Mango Édition Limitée')).toBe('Édition limitée')
  })

  it('met Standard quand le nom ne cite aucune autre variante, rien sans nom', () => {
    expect(varianteDuNom('Monster Ultra White')).toBe('Standard')
    expect(varianteDuNom('Monster Shotgun')).toBe('Standard')
    expect(varianteDuNom('  ')).toBe('')
  })
})

describe('volumeEnMl', () => {
  it('lit « 500 ml » et « 500 », rien d’autre', () => {
    expect([volumeEnMl('500 ml'), volumeEnMl('355'), volumeEnMl(''), volumeEnMl('un grand')]).toEqual([500, 355, null, null])
  })
})
