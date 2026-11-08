export type Canette = {
  ean: string
  nom: string
  edition: string
  volume: string
  etat: string
  nb: number
  notes: string
  photo: string | null
  ajout: string
}

export const CANETTE_VIDE = (ean: string): Canette => ({
  ean,
  nom: '',
  edition: '',
  volume: '',
  etat: 'Vide',
  nb: 1,
  notes: '',
  photo: null,
  ajout: new Date().toISOString(),
})

export const ETATS = ['Pleine', 'Vide', 'Ouverte proprement', 'Cabossée'] as const

/** Fiche du Wiki (catalogue partagé) : jamais de donnée de collection personnelle. */
export type FicheWiki = {
  ean: string
  nom: string
  edition: string
  volume: string
  pays: string
  description: string
  /** Marqueur de version de la photo (null : pas de photo). Les octets se chargent à part. */
  photo: string | null
}

export type ReponseWiki = { peut_editer: boolean; fiches: FicheWiki[] }

export type ModifFicheWiki = Pick<FicheWiki, 'ean' | 'nom' | 'edition' | 'volume' | 'pays' | 'description'>
