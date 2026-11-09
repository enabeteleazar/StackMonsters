export type Canette = {
  ean: string
  nom: string
  edition: string
  volume: string
  categorie: string
  flavor: string
  status: string
  region: string
  etat: string
  nb: number
  notes: string
  /** Présent seulement quand la photo change : absent à l'enregistrement, le serveur conserve l'ancienne. */
  photo?: string | null
  /** Marqueur de version de la photo (null : pas de photo). Les octets se chargent à part. */
  photo_version: string | null
  ajout: string
}

export const CANETTE_VIDE = (ean: string): Canette => ({
  ean,
  nom: '',
  edition: '',
  volume: '',
  categorie: '',
  flavor: '',
  status: '',
  region: '',
  etat: 'Vide',
  nb: 1,
  notes: '',
  photo: null,
  photo_version: null,
  ajout: new Date().toISOString(),
})

export const ETATS = ['Pleine', 'Vide', 'Ouverte proprement', 'Cabossée'] as const

/** Fiche du Wiki (catalogue partagé) : jamais de donnée de collection personnelle. */
export type FicheWiki = {
  ean: string
  nom: string
  edition: string
  volume: string
  categorie: string
  flavor: string
  status: string
  region: string
  description: string
  /** Marqueur de version de la photo (null : pas de photo). Les octets se chargent à part. */
  photo: string | null
}

export type ReponseWiki = { peut_editer: boolean; fiches: FicheWiki[] }

export type ModifFicheWiki = Pick<
  FicheWiki,
  'ean' | 'nom' | 'edition' | 'volume' | 'categorie' | 'flavor' | 'status' | 'region' | 'description'
>
