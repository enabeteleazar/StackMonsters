import { describe, expect, it } from 'vitest'
import { CATEGORIES, REGIONS, STATUTS } from './categories'
import type { FicheWiki } from './types'
import { fichesCorrespondantes, filtrerFiches, suggererFiches, trouverFicheParCodeBarres } from './wiki'

const f = (ean: string, nom: string): FicheWiki => ({
  ean,
  nom,
  edition: '',
  volume: '500 ml',
  categorie: '',
  flavor: '',
  status: '',
  region: '',
  description: '',
  photo: null,
  codes: [],
})

const fiches = [f('1', 'Monster Mango Loco'), f('2', 'Ultra White'), f('3016', '')]

describe('fichesCorrespondantes', () => {
  const catalogue = [
    f('a', 'Mango Loco'),
    f('b', 'Monster Energy Original'),
    f('c', 'Ultra Zero / Ultra White'),
    f('d', 'Ultra Paradise'),
  ]
  const noms = (saisie: string) => fichesCorrespondantes(catalogue, saisie).map((x) => x.nom)

  it('ignore la marque, la casse et le volume', () => {
    expect(noms('Monster Mango Loco')).toEqual(['Mango Loco'])
    expect(noms('Mango Loco 500ml')).toEqual(['Mango Loco'])
    expect(noms('Monster Original')).toEqual(['Monster Energy Original'])
    expect(noms('monster ultra white')).toEqual(['Ultra Zero / Ultra White'])
  })

  it('suit une saisie en cours et classe les plus proches d’abord', () => {
    expect(noms('Mango')).toEqual(['Mango Loco'])
    expect(noms('ultra para')).toEqual(['Ultra Paradise'])
    expect(noms('Ultra')).toEqual(['Ultra Paradise', 'Ultra Zero / Ultra White'])
  })

  it('ne propose rien pour une saisie trop vague ou sans rapport', () => {
    expect(noms('M')).toEqual([])
    expect(noms('Monster')).toEqual([])
    expect(noms('Pipeline Punch')).toEqual([])
  })
})

describe('filtrerFiches', () => {
  it('renvoie tout sans recherche', () => {
    expect(filtrerFiches(fiches, '  ')).toHaveLength(3)
  })

  it('cherche dans le nom sans tenir compte de la casse', () => {
    expect(filtrerFiches(fiches, 'mango').map((x) => x.ean)).toEqual(['1'])
  })

  it('filtre par gamme et combine le filtre avec la recherche textuelle', () => {
    const catalogue = [
      { ...fiches[0], categorie: 'Juiced' },
      { ...fiches[1], categorie: 'Ultra' },
      { ...fiches[2], nom: 'Monster Juiced', categorie: 'Juiced' },
    ]
    expect(filtrerFiches(catalogue, '', 'juiced').map((x) => x.ean)).toEqual(['1', '3016'])
    expect(filtrerFiches(catalogue, 'mango', 'Juiced').map((x) => x.ean)).toEqual(['1'])
    expect(filtrerFiches(catalogue, '', 'Original')).toEqual([])
  })

  it('cherche dans les catégories descriptives sans tenir compte de la casse', () => {
    const catalogue = [{ ...fiches[0], categorie: 'Juiced', flavor: 'Mango', status: 'Active', region: 'Europe' }]
    expect(filtrerFiches(catalogue, 'juiced').map((x) => x.ean)).toEqual(['1'])
    expect(filtrerFiches(catalogue, 'mango').map((x) => x.ean)).toEqual(['1'])
    expect(filtrerFiches(catalogue, 'active').map((x) => x.ean)).toEqual(['1'])
    expect(filtrerFiches(catalogue, 'europe').map((x) => x.ean)).toEqual(['1'])
  })

  it('cherche par code-barres, y compris pour une fiche sans nom', () => {
    expect(filtrerFiches(fiches, '3016').map((x) => x.ean)).toEqual(['3016'])
  })

  describe('options du catalogue', () => {
    it('contient les 10 catégories et les 7 régions proposées', () => {
      expect(CATEGORIES).toEqual([
        'Original', 'Ultra', 'Juiced', 'Reserve', 'Special',
        'Java', 'Rehab', 'Nitro', 'Water', 'Asia',
      ])
      expect(REGIONS).toEqual(['Global', 'US', 'Canada', 'Europe', 'Europe/Aus', 'US/Global', 'Japan'])
      expect(STATUTS).toEqual(['Active', 'Stop', 'Nouveauté'])
    })
  })

  it('ne renvoie rien quand rien ne correspond', () => {
    expect(filtrerFiches(fiches, 'zzz')).toEqual([])
  })
})

describe('suggererFiches', () => {
  it('propose les fiches qui correspondent au nom saisi', () => {
    expect(suggererFiches(fiches, 'Mango').map((x) => x.ean)).toEqual(['1'])
  })

  it('corrige la variante Monsters vers la fiche Monster canonique', () => {
    expect(suggererFiches([f('1', 'Monster')], 'Monsters').map((x) => x.nom)).toEqual(['Monster'])
  })

  it('conserve plusieurs fiches de même nom pour des versions différentes', () => {
    const catalogue = [f('1', 'Monster Ultra'), f('2', 'Monster Ultra')]
    expect(suggererFiches(catalogue, 'Monster Ultra').map((x) => x.ean)).toEqual(['1', '2'])
  })

  it('priorise le nom exact et limite le nombre de propositions', () => {
    const catalogue = [f('1', 'Monster Energy'), f('2', 'Monster'), f('3', 'Monster Ultra'), f('4', 'Monster Mango')]
    expect(suggererFiches(catalogue, 'Monster', 2).map((x) => x.ean)).toEqual(['2', '1'])
  })

  it('attend au moins deux caractères', () => {
    expect(suggererFiches(fiches, 'M')).toEqual([])
  })
})

describe('trouverFicheParCodeBarres : codes supplémentaires', () => {
  it('retrouve une fiche par un de ses autres codes', () => {
    const catalogue = [{ ...f('3017620422003', 'Paradise'), codes: ['96385074'] }]
    expect(trouverFicheParCodeBarres(catalogue, '96385074')?.nom).toBe('Paradise')
    expect(filtrerFiches(catalogue, '9638')).toHaveLength(1)
  })
})

describe('trouverFicheParCodeBarres', () => {
  it('retrouve la fiche ayant exactement le code-barres saisi', () => {
    expect(trouverFicheParCodeBarres(fiches, ' 3016 ')?.nom).toBe('')
  })

  it('ne renvoie pas de fiche si le code-barres est inconnu', () => {
    expect(trouverFicheParCodeBarres(fiches, '999')).toBeUndefined()
  })
})
