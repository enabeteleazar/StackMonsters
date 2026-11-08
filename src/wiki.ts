import type { FicheWiki } from './types'

/** Minuscules sans accents, pour qu'une recherche « etats-unis » trouve « États-Unis ». */
const normaliser = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bmonsters\b/g, 'monster')
    .replace(/\s+/g, ' ')
    .trim()

/** Propose les fiches du Wiki correspondant au nom saisi, avec les correspondances les plus proches en premier. */
export function suggererFiches(fiches: FicheWiki[], recherche: string, limite = 4): FicheWiki[] {
  const q = normaliser(recherche)
  if (q.length < 2) return []
  return fiches
    .filter((f) => f.nom && normaliser(f.nom).includes(q))
    .sort((a, b) => {
      const nomA = normaliser(a.nom)
      const nomB = normaliser(b.nom)
      return Number(nomA !== q) - Number(nomB !== q) || nomA.localeCompare(nomB)
    })
    .slice(0, limite)
}

/** Recherche une fiche par son code-barres exact. */
export function trouverFicheParCodeBarres(fiches: FicheWiki[], codeBarres: string): FicheWiki | undefined {
  const code = codeBarres.trim()
  return code ? fiches.find((fiche) => fiche.ean === code) : undefined
}

/** Filtre le catalogue sur ses champs descriptifs ou son code-barres. */
export function filtrerFiches(fiches: FicheWiki[], recherche: string, gamme = ''): FicheWiki[] {
  const q = normaliser(recherche)
  const categorieRecherchee = normaliser(gamme)
  return fiches.filter(
    (f) =>
      (!categorieRecherchee || normaliser(f.categorie) === categorieRecherchee) &&
      (!q ||
        normaliser(f.nom).includes(q) ||
        normaliser(f.categorie).includes(q) ||
        normaliser(f.flavor).includes(q) ||
        normaliser(f.status).includes(q) ||
        normaliser(f.region).includes(q) ||
        normaliser(f.pays).includes(q) ||
        f.ean.includes(q)),
  )
}
