export type Canette = {
  ean: string
  nom: string
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
  /** Vrai quand la photo affichée est celle de la fiche du Wiki (la photo personnelle est alors masquée). */
  photo_wiki?: boolean
  /** Vrai quand la canette a une fiche dans le Wiki : nom, volume, description... en viennent. */
  dans_wiki?: boolean
  /** Description de la fiche du Wiki (lecture seule depuis la collection). */
  description?: string
  ajout: string
}

export const CANETTE_VIDE = (ean: string): Canette => ({
  ean,
  nom: '',
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
  volume: string
  categorie: string
  flavor: string
  status: string
  region: string
  description: string
  /** Marqueur de version de la photo (null : pas de photo). Les octets se chargent à part. */
  photo: string | null
  /** Codes-barres supplémentaires (autre pays, autre format) qui désignent aussi cette fiche. */
  codes: string[]
  /** Propriétaire seulement : d'où vient la fiche (sans lien avec un compte) et sa dernière correction. */
  provenance?: { source: string; cree: string; corrigee: string | null }
  /** Modération : fiche créée par un membre « à vérifier », puis acceptée ou refusée par le propriétaire. */
  moderation?: 'en_attente' | 'acceptee' | 'refusee'
  /** Propriétaire seulement : historique des décisions de modération. */
  moderations?: { decision: 'acceptee' | 'refusee'; motif: string; cree: string }[]
  /** Propriétaire seulement : erreurs signalées par les comptes, pas encore traitées. */
  signalements?: { id: number; motif: string; cree: string }[]
}

export type ReponseWiki = { peut_editer: boolean; fiches: FicheWiki[] }

/** Une page de résultats de la recherche dans le catalogue (jamais les collections). */
export type ResultatRechercheWiki = {
  peut_editer: boolean
  fiches: FicheWiki[]
  /** Nombre de fiches qui correspondent à la recherche et aux filtres. */
  total: number
  /** Nombre de fiches dans tout le catalogue. */
  total_catalogue: number
  page: number
  pages: number
  /** Noms proches proposés quand rien ne correspond (« Tu cherchais… ? »). */
  suggestions: string[]
  /** Propriétaire : nombre de fiches avec un signalement ouvert. */
  signalees: number
  /** Propriétaire : nombre de fiches à vérifier. */
  a_verifier: number
}

/** Canette proposée au catalogue (sans l'ajouter à sa collection). */
export type PropositionWiki = {
  ean: string
  nom: string
  volume: string
  categorie: string
  flavor: string
  region: string
  photo: string | null
  confirmer_doublon?: boolean
}

export type TriWiki = 'pertinence' | 'nom' | 'recent'

export type ModifFicheWiki = Pick<
  FicheWiki,
  'ean' | 'nom' | 'volume' | 'categorie' | 'flavor' | 'status' | 'region' | 'description'
>
