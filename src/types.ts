export type Canette = {
  ean: string
  nom: string
  volume: string
  categorie: string
  flavor: string
  status: string
  region: string
  /** Variante de la référence (Standard, Zero Sugar, Shot…), venue du Wiki. */
  variante?: string
  /** Réglage du compte : faux quand le partage des doublons est désactivé (rien n'est alors compté). */
  partage_doubles?: boolean
  /** Nombre de collectionneurs qui cherchent cette canette (aucun nom). */
  recherches?: number
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
  /** Variante (valeurs contrôlées : VARIANTES), vide si non renseignée. */
  variante: string
  description: string
  /** Marqueur de version de la photo (null : pas de photo). Les octets se chargent à part. */
  photo: string | null
  /** Échanges : collectionneurs qui en ont des doubles (partage activé), et qui la cherchent (des nombres, jamais des noms). */
  doubles?: number
  recherches?: number
  /** Pour le compte connecté : il la cherche / il l'a dans sa collection. */
  je_cherche?: boolean
  je_possede?: boolean
  /** Réglage « Partage des doublons » du compte connecté : faux, le bloc Échanges de la fiche est masqué. */
  partage_doubles?: boolean
  /** Propriétaire seulement : champs hors des valeurs contrôlées, à corriger (fiches d'avant la normalisation). */
  a_reprendre?: string[]
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
  /** Nombre de canettes que le compte connecté cherche. */
  je_cherche?: number
}

/** Canette proposée au catalogue (sans l'ajouter à sa collection). */
export type PropositionWiki = {
  ean: string
  nom: string
  volume: string
  categorie: string
  flavor: string
  region: string
  variante: string
  photo: string | null
  confirmer_doublon?: boolean
}

export type TriWiki = 'pertinence' | 'nom' | 'recent'

export type ModifFicheWiki = Pick<
  FicheWiki,
  'ean' | 'nom' | 'volume' | 'categorie' | 'flavor' | 'status' | 'region' | 'variante' | 'description'
>

/** Échanges, étape 2 : mise en relation entre un collectionneur qui cherche et un autre qui a la canette en double.
 * Jamais d'adresse ni de nom de l'autre membre. */
export type MiseEnRelation = {
  id: number
  /** Ce compte cherche la canette (chercheur) ou en a des doubles (possesseur). */
  role: 'chercheur' | 'possesseur'
  /** signalee : paire repérée, notifiée au chercheur ; demandee : le chercheur veut échanger, notifiée au
   * possesseur ; acceptee : la messagerie est ouverte ; annulee : arrêtée par l'un des deux. */
  statut: 'signalee' | 'demandee' | 'acceptee' | 'annulee'
  maj: string
  fiche: { ean: string; nom: string; photo: string | null }
}

export type NotificationEchange = MiseEnRelation & {
  /** Vrai quand ce compte doit répondre (Échange ou Annuler). */
  action: boolean
}

export type ConversationEchange = MiseEnRelation & { non_lus: number; dernier: string | null }

export type EtatEchanges = {
  notifications: NotificationEchange[]
  conversations: ConversationEchange[]
  /** Pastille : notifications à traiter + messages non lus. */
  non_lus: number
}

export type MessageEchange = { id: number; de_moi: boolean; texte: string; cree: string }
