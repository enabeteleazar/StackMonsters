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

/** Recherche une fiche par son code-barres exact, principal ou supplémentaire. */
export function trouverFicheParCodeBarres(fiches: FicheWiki[], codeBarres: string): FicheWiki | undefined {
  const code = codeBarres.trim()
  return code ? fiches.find((fiche) => fiche.ean === code || (fiche.codes ?? []).includes(code)) : undefined
}

// Mots qui ne distinguent pas deux canettes : la marque, les liaisons et les volumes.
const MOTS_VIDES = new Set(['monster', 'energy', 'drink', 'boisson', 'energisante', 'the', 'and', 'de', 'la', 'le', 'et'])
const motsSignificatifs = (texte: string) =>
  normaliser(texte)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((m) => m && !MOTS_VIDES.has(m) && !/^\d+(ml|cl|l|oz)?$/.test(m) && !/^(ml|cl|l|oz)$/.test(m))

/**
 * Fiches dont le nom correspond à une saisie libre, mot par mot : « Monster Mango Loco 500ml » trouve
 * « Mango Loco ». Le dernier mot peut être incomplet (saisie en cours). Les plus proches d'abord.
 */
export function fichesCorrespondantes(fiches: FicheWiki[], saisie: string, limite = 4): FicheWiki[] {
  const mots = motsSignificatifs(saisie)
  if (mots.join('').length < 2) return []
  const debut = mots.slice(0, -1)
  const dernier = mots[mots.length - 1]
  const ecart = (n: string[]) => Math.abs(n.length - mots.length)
  return fiches
    .map((fiche) => ({ fiche, mots: motsSignificatifs(fiche.nom) }))
    .filter(
      ({ mots: n }) =>
        n.length > 0 &&
        ((debut.every((m) => n.includes(m)) && n.some((m) => m.startsWith(dernier))) || n.every((m) => mots.includes(m))),
    )
    .sort((a, b) => ecart(a.mots) - ecart(b.mots) || a.fiche.nom.localeCompare(b.fiche.nom))
    .slice(0, limite)
    .map(({ fiche }) => fiche)
}
