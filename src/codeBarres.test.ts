import { describe, expect, it } from 'vitest'
import { estCodeBarresEAN13 } from './codeBarres'

describe('estCodeBarresEAN13', () => {
  it('accepte exactement 13 chiffres', () => {
    expect(estCodeBarresEAN13('3017620422003')).toBe(true)
  })

  it('refuse les codes trop courts, trop longs ou contenant autre chose que des chiffres', () => {
    expect(estCodeBarresEAN13('301762042200')).toBe(false)
    expect(estCodeBarresEAN13('30176204220034')).toBe(false)
    expect(estCodeBarresEAN13('30176204220A3')).toBe(false)
    expect(estCodeBarresEAN13('')).toBe(false)
  })
})
