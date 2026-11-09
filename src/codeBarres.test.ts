import { describe, expect, it } from 'vitest'
import { normaliserCodeBarres, normaliserLecture, upcEVersUpcA } from './codeBarres'

describe('normaliserCodeBarres', () => {
  it('garde un EAN-13 et un EAN-8 valides', () => {
    expect(normaliserCodeBarres('3017620422003')).toBe('3017620422003')
    expect(normaliserCodeBarres('96385074')).toBe('96385074')
  })

  it('complète un UPC-A à 13 chiffres', () => {
    expect(normaliserCodeBarres('036000291452')).toBe('0036000291452')
  })

  it('refuse une mauvaise clé, une mauvaise longueur ou autre chose que des chiffres', () => {
    expect(normaliserCodeBarres('3017620422004')).toBeNull()
    expect(normaliserCodeBarres('036000291453')).toBeNull()
    expect(normaliserCodeBarres('30176204220034')).toBeNull()
    expect(normaliserCodeBarres('30176204220A3')).toBeNull()
    expect(normaliserCodeBarres('')).toBeNull()
  })
})

describe('upcEVersUpcA', () => {
  it.each([
    ['04252614', '042100005264'],
    ['01234505', '012000003455'],
    ['01234531', '012300000451'],
    ['01234546', '012340000056'],
    ['01234558', '012345000058'],
  ])('développe %s', (upcE, upcA) => {
    expect(upcEVersUpcA(upcE)).toBe(upcA)
  })

  it('refuse un code qui n’est pas un UPC-E', () => {
    expect(upcEVersUpcA('96385074')).toBeNull()
  })
})

describe('normaliserLecture', () => {
  it('distingue un UPC-E d’un EAN-8 grâce au format du lecteur', () => {
    expect(normaliserLecture('04252614', 'upc_e')).toBe('0042100005264')
    expect(normaliserLecture('96385074', 'ean_8')).toBe('96385074')
  })

  it('laisse un code illisible tel quel pour que le formulaire le signale', () => {
    expect(normaliserLecture('123', 'ean_13')).toBe('123')
  })
})
