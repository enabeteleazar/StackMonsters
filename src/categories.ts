export const CATEGORIES = [
  'Original',
  'Ultra',
  'Juiced',
  'Reserve',
  'Special',
  'Java',
  'Killer Brew',
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
 * citées, la première dans le nom l'emporte. Une catégorie de plusieurs mots (« Killer Brew ») doit être citée
 * en entier, dans l'ordre. Chaîne vide si aucune n'est citée.
 */
export function categorieDuNom(nom: string): string {
  const mots = sansAccents(nom).split(/[^a-z0-9]+/).filter(Boolean)
  for (let i = 0; i < mots.length; i++) {
    const trouvee =
      CATEGORIES.find((c) => {
        const motsCategorie = sansAccents(c).split(' ')
        return motsCategorie.every((m, j) => mots[i + j] === m)
      }) ?? SYNONYMES[mots[i]]
    if (trouvee) return trouvee
  }
  return ''
}

export const REGIONS = ['Global', 'US', 'Canada', 'Europe', 'Europe/Aus', 'US/Global', 'Japan'] as const

/** Variante d'une référence (valeurs contrôlées, mêmes que VARIANTES dans api/index.py). */
export const VARIANTES = ['Standard', 'Zero Sugar', 'Shot', 'Édition limitée', 'Collaboration'] as const

/** Volumes les plus courants, en ml ; « Autre » permet de saisir un nombre. */
export const VOLUMES_COURANTS = [250, 355, 443, 473, 500, 550, 568, 710] as const

/** Longueur maximale d'une saveur : les détails vont dans la description. */
export const SAVEUR_MAX = 60

/** Volume en ml d'une valeur « 500 ml » (ou « 500 »), null si illisible ou vide. */
export function volumeEnMl(volume: string): number | null {
  const m = /^\s*(\d{2,4})\s*(ml)?\s*$/i.exec(volume)
  return m ? Number(m[1]) : null
}

/**
 * Variante d'après le nom d'une canette, dans cet ordre : « … Shot » → Shot, « Zero » → Zero Sugar, collaboration
 * connue (VR46, Lando Norris, McLaren, « … X … ») → Collaboration, « Limited » ou « Édition limitée » → Édition
 * limitée, sinon Standard. Chaîne vide tant qu'il n'y a pas de nom (mêmes règles que les migrations 14 et 15).
 */
export function varianteDuNom(nom: string): string {
  const n = sansAccents(nom)
  if (!n.trim()) return ''
  if (/\bshots?\b/.test(n)) return 'Shot'
  if (/\bzero\b/.test(n)) return 'Zero Sugar'
  if (/\b(vr46|rossi|lando|norris|mclaren)\b/.test(n) || /\s[x×]\s/.test(n)) return 'Collaboration'
  if (/\b(limited|limitee)\b/.test(n)) return 'Édition limitée'
  return 'Standard'
}

export const STATUTS = ['Active', 'Stop', 'Nouveauté'] as const

/** « Nouveauté » est réservée au propriétaire, depuis la fiche du Wiki. */
export const STATUTS_COLLECTION = STATUTS.filter((s) => s !== 'Nouveauté')

/** Libellé d'un statut dans les listes de choix. */
export const libelleStatut = (status: string) => (status === 'Nouveauté' ? 'Nouveauté (30 jours)' : status)
