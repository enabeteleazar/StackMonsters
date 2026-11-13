export const CATEGORIES = [
  'Original',
  'Ultra',
  'Juiced',
  'Reserve',
  'Special',
  'Java',
  'Rehab',
  'Nitro',
  'Water',
  'Asia',
] as const

/** Autres mots qui désignent une catégorie dans un nom de canette (« Juice Monster » → Juiced). */
const SYNONYMES: Record<string, (typeof CATEGORIES)[number]> = { juice: 'Juiced' }

const sansAccents = (texte: string) => texte.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Catégorie mentionnée dans le nom d'une canette, en mot entier, sans tenir compte des majuscules ni des accents :
 * « Monster Energy Ultra White » → Ultra, « Juice Monster Mango Loco » → Juiced. Si plusieurs catégories sont
 * citées, la première dans le nom l'emporte. Chaîne vide si aucune n'est citée.
 */
export function categorieDuNom(nom: string): string {
  const mots = sansAccents(nom).split(/[^a-z0-9]+/).filter(Boolean)
  for (const mot of mots) {
    const trouvee = CATEGORIES.find((c) => c.toLowerCase() === mot) ?? SYNONYMES[mot]
    if (trouvee) return trouvee
  }
  return ''
}

export const REGIONS = ['Global', 'US', 'Canada', 'Europe', 'Europe/Aus', 'US/Global', 'Japan'] as const

export const STATUTS = ['Active', 'Stop', 'Nouveauté'] as const

/** « Nouveauté » est réservée au propriétaire, depuis la fiche du Wiki. */
export const STATUTS_COLLECTION = STATUTS.filter((s) => s !== 'Nouveauté')

/** Libellé d'un statut dans les listes de choix. */
export const libelleStatut = (status: string) => (status === 'Nouveauté' ? 'Nouveauté (30 jours)' : status)
