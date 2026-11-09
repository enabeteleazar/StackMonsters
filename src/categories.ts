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

export const REGIONS = ['Global', 'US', 'Europe', 'Europe/Aus', 'US/Global', 'Japan'] as const

export const STATUTS = ['Active', 'Stop', 'Nouveauté'] as const

/** Libellé d'un statut dans les listes de choix. */
export const libelleStatut = (status: string) => (status === 'Nouveauté' ? 'Nouveauté (30 jours)' : status)
