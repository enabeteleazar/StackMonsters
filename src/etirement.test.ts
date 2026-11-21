import { describe, expect, it } from 'vitest'
import { etirementMax, etirementPour, zoomDevoilement, zoomPincement } from './etirement'

describe('photo étirable', () => {
  it('n’étire rien sans geste vers le bas', () => {
    expect(etirementPour(0, 300)).toBe(0)
    expect(etirementPour(-50, 300)).toBe(0)
    expect(etirementPour(80, 0)).toBe(0)
  })

  it('suit le doigt puis résiste, sans dépasser la hauteur qui manque', () => {
    const petit = etirementPour(30, 300)
    expect(petit).toBeGreaterThan(28)
    expect(petit).toBeLessThan(30)
    expect(etirementPour(5000, 300)).toBeLessThanOrEqual(300)
    expect(etirementPour(5000, 300)).toBeGreaterThan(299)
  })

  it('agrandit le cadre jusqu’à montrer toute la photo, dans la limite de l’écran', () => {
    // Cadre 412 × 309 (4:3) ; photo portrait 600 × 1200 → il faut 824 px, limité à 92 % d’un écran de 839 px.
    expect(etirementMax(412, 309, 600, 1200, 839)).toBeCloseTo(839 * 0.92 - 309)
    // Photo 1000 × 1000 → 412 px de haut, donc 103 px de plus.
    expect(etirementMax(412, 309, 1000, 1000, 839)).toBeCloseTo(103)
    // Photo plus large que le cadre, ou pas encore chargée : petit étirement élastique seulement.
    expect(etirementMax(412, 309, 1600, 900, 839)).toBeCloseTo(839 * 0.12)
    expect(etirementMax(412, 309, 0, 0, 839)).toBeCloseTo(839 * 0.12)
  })

  it('part du cadrage du repos et finit sur la photo entière', () => {
    // Photo portrait 200 × 579 dans un cadre 412 × 309 : au repos elle remplit la largeur (rognée en haut et en bas).
    expect(zoomDevoilement(412, 309, 200, 579, 0)).toBeCloseTo((412 / 200) / (309 / 579))
    expect(zoomDevoilement(412, 772, 200, 579, 1)).toBe(1) // entière : aucun agrandissement
    expect(zoomDevoilement(412, 540, 200, 579, 0.5)).toBeGreaterThan(1)
    expect(zoomDevoilement(412, 309, 0, 0, 0.5)).toBe(1) // photo pas encore chargée
  })

  it('zoom à deux doigts entre ×1 et ×3', () => {
    expect(zoomPincement(100, 200)).toBe(2)
    expect(zoomPincement(100, 50)).toBe(1)
    expect(zoomPincement(100, 900)).toBe(3)
    expect(zoomPincement(0, 100)).toBe(1)
  })
})
