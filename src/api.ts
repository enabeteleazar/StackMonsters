import { API_URL, CLE_JETON } from './config'
import type {
  Canette, EtatEchanges, FicheWiki, MessageEchange, MiseEnRelation, ModifFicheWiki, PropositionWiki, ReponseWiki,
  CompteAdmin, ResultatRechercheWiki, SignalementMembre, TriWiki,
} from './types'

/** Levée quand le service répond 401 : jeton absent ou refusé. */
export class NonAutorise extends Error {
  constructor() {
    super('Accès refusé')
  }
}

export class ErreurAPI extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    /** Secondes avant de pouvoir réessayer (en-tête Retry-After d'une réponse 429). */
    readonly attente: number | null = null,
  ) {
    super(`${status} ${detail}`)
  }
}

function blobEnDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader()
    lecteur.onload = () => {
      if (typeof lecteur.result === 'string') resolve(lecteur.result)
      else reject(new Error('Impossible de lire la photo du Wiki'))
    }
    lecteur.onerror = () => reject(lecteur.error ?? new Error('Impossible de lire la photo du Wiki'))
    lecteur.readAsDataURL(blob)
  })
}

// localStorage peut lever une exception (navigation privée de Safari, par exemple).
/** Remplace le jeton s'il a plus d'un jour ; sans effet hors ligne ou si le serveur le garde. */
export async function renouvelerJeton(): Promise<void> {
  try {
    const { token } = await api.renouveler()
    if (token) jeton.ecrire(token)
  } catch {
    /* l'ancien jeton reste valable ; nouvel essai à la prochaine ouverture */
  }
}

export const jeton = {
  lire: (): string => {
    try {
      return localStorage.getItem(CLE_JETON) ?? ''
    } catch {
      return ''
    }
  },
  ecrire: (valeur: string) => {
    try {
      localStorage.setItem(CLE_JETON, valeur)
    } catch {
      /* le jeton sera redemandé au prochain chargement */
    }
  },
  effacer: () => {
    try {
      localStorage.removeItem(CLE_JETON)
      // Verrouiller vide aussi le cache hors ligne : la collection ne reste pas lisible.
      if ('caches' in window) void caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
    } catch {
      /* rien à effacer */
    }
  },
}

async function requete<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_URL + chemin, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jeton.lire()}`,
      ...(init?.headers ?? {}),
    },
  })
  if (r.status === 401) throw new NonAutorise()
  if (!r.ok) {
    const corps = await r.text().catch(() => '')
    let detail = corps.slice(0, 120)
    try {
      const json: { detail?: unknown } = JSON.parse(corps)
      if (typeof json.detail === 'string') detail = json.detail
    } catch {
      // Certaines erreurs de proxy ne renvoient pas de JSON.
    }
    const attente = Number(r.headers.get('Retry-After'))
    throw new ErreurAPI(r.status, detail, Number.isFinite(attente) && attente > 0 ? attente : null)
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}

export const api = {
  liste: () => requete<Canette[]>('/cans'),
  /** Échanges : notifications de mise en relation et conversations ouvertes (repère aussi les nouvelles paires). */
  echanges: () => requete<EtatEchanges>('/echanges'),
  /** « Échange » : demande (chercheur) ou acceptation (possesseur). */
  accepterEchange: (id: number) => requete<MiseEnRelation>(`/echanges/${id}/accepter`, { method: 'POST' }),
  annulerEchange: (id: number) => requete<MiseEnRelation>(`/echanges/${id}/annuler`, { method: 'POST' }),
  messages: (id: number, apres = 0) =>
    requete<MiseEnRelation & { messages: MessageEchange[] }>(`/echanges/${id}/messages?apres=${apres}`),
  envoyerMessage: (id: number, texte: string) =>
    requete<MessageEchange>(`/echanges/${id}/messages`, { method: 'POST', body: JSON.stringify({ texte }) }),
  /** « Valider l'échange » : appliqué (-1 / +1) quand les deux ont validé. */
  validerEchange: (id: number) => requete<MiseEnRelation>(`/echanges/${id}/valider`, { method: 'POST' }),
  /** Signale l'autre membre : la conversation se ferme et la paire n'est plus proposée. */
  signalerMembre: (id: number, motif: string, detail: string) =>
    requete<MiseEnRelation>(`/echanges/${id}/signaler`, { method: 'POST', body: JSON.stringify({ motif, detail }) }),
  /** Propriétaire : tous les comptes, blocage et suppression. */
  adminComptes: () => requete<CompteAdmin[]>('/admin/comptes'),
  adminBloquer: (id: number, bloque: boolean) =>
    requete<{ id: number; bloque: string | null }>(`/admin/comptes/${id}/blocage`, { method: 'POST', body: JSON.stringify({ bloque }) }),
  adminSupprimer: (id: number, confirmation: string) =>
    requete<void>(`/admin/comptes/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) }),
  /** Propriétaire : message à tous (popup à l'ouverture + notification système). */
  adminAnnoncer: (texte: string) =>
    requete<{ id: number; notifies: number; appareils: number; push: boolean }>('/admin/annonces', {
      method: 'POST',
      body: JSON.stringify({ texte }),
    }),
  adminAnnonces: () =>
    requete<{ annonces: { id: number; texte: string; cree: number; notifies: number }[]; appareils: number; push: boolean }>(
      '/admin/annonces',
    ),
  /** Dernier message du propriétaire pas encore vu par ce compte. */
  annonce: () => requete<{ annonce: { id: number; texte: string; cree: number } | null }>('/annonce'),
  annonceVue: (id: number) => requete<void>(`/annonce/${id}/vue`, { method: 'POST' }),
  /** Notifications système : clé publique, abonnement de l'appareil. */
  pushCle: () => requete<{ cle: string | null }>('/push/cle'),
  pushAbonner: (a: { endpoint: string; p256dh: string; auth: string }) =>
    requete<void>('/push/abonnement', { method: 'POST', body: JSON.stringify(a) }),
  pushDesabonner: (a: { endpoint: string; p256dh: string; auth: string }) =>
    requete<void>('/push/desabonnement', { method: 'POST', body: JSON.stringify(a) }),
  /** Propriétaire : signalements de membres à examiner. */
  signalementsMembres: () => requete<SignalementMembre[]>('/admin/signalements-membres'),
  signalementMembreTraite: (id: number) =>
    requete<{ id: number }>(`/admin/signalements-membres/${id}/traite`, { method: 'POST' }),
  enregistrer: (c: Canette) =>
    requete<Canette>('/cans', { method: 'PUT', body: JSON.stringify(c) }),
  ajuster: (ean: string, delta: number) =>
    requete<Canette>(`/cans/${encodeURIComponent(ean)}/nb`, { method: 'PATCH', body: JSON.stringify({ delta }) }),
  lire: (ean: string) => requete<Canette>(`/cans/${encodeURIComponent(ean)}`),
  /** Retire toutes les canettes de la collection ; renvoie leur nombre. */
  viderCollection: () =>
    requete<{ retirees: number }>('/cans', { method: 'DELETE', body: JSON.stringify({ confirmation: 'vider' }) }),
  supprimer: (ean: string) =>
    requete<void>(`/cans/${encodeURIComponent(ean)}`, { method: 'DELETE' }),
  demande: (email: string) =>
    requete<{ ok: boolean }>('/auth/demande', { method: 'POST', body: JSON.stringify({ email }) }),
  verification: (email: string, code: string) =>
    requete<{ token: string; email: string }>('/auth/verification', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  moi: () => requete<{ email: string; partage_doubles?: boolean }>('/auth/moi'),
  /** Réglage du compte : partager ou non ses doublons (interrupteur général). */
  reglerPartageDoubles: (actif: boolean) =>
    requete<{ partage_doubles: boolean }>('/auth/partage-doubles', { method: 'PATCH', body: JSON.stringify({ echange: actif }) }),
  deconnexion: () => requete<void>('/auth/deconnexion', { method: 'POST' }),
  /** Révoque toutes les sessions du compte (tous les appareils), celle-ci comprise. */
  deconnexionPartout: () => requete<void>('/auth/deconnexion-partout', { method: 'POST' }),
  /** Rotation du jeton (au plus une fois par jour) : null si le jeton actuel reste valable. */
  renouveler: () => requete<{ token: string | null }>('/auth/renouveler', { method: 'POST' }),
  /** « confirmation » : l'adresse du compte, saisie par l'utilisateur ; vérifiée aussi par le serveur. */
  supprimerCompte: (confirmation: string) =>
    requete<void>('/auth/compte', { method: 'DELETE', body: JSON.stringify({ confirmation }) }),
  stats: () =>
    requete<{ utilisateurs: number; references: number; connexions_uniques: number }>('/stats'),
  sante: () => requete<{ status: string; version: string; references: number }>('/health'),
  wiki: () => requete<ReponseWiki>('/wiki'),
  /** Saveurs déjà connues dans le Wiki, les plus fréquentes d'abord (suggestions des formulaires). */
  wikiSaveurs: () => requete<string[]>('/wiki/saveurs'),
  /** Échanges : noter (ou ne plus noter) une canette du Wiki comme recherchée. */
  wikiChercher: (ean: string, cherche: boolean) =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(ean)}/recherche`, { method: cherche ? 'POST' : 'DELETE' }),
  /** Recherche paginée côté serveur dans le catalogue partagé. */
  wikiRecherche: (p: {
    q?: string
    categorie?: string
    region?: string
    tri?: TriWiki
    page?: number
    signalees?: boolean
    a_verifier?: boolean
    sans_categorie?: boolean
    variante?: string
    nouveautes?: boolean
    je_cherche?: boolean
    doubles?: boolean
    par_page?: number
  }) => {
    const params = new URLSearchParams()
    for (const [cle, valeur] of Object.entries(p)) if (valeur) params.set(cle, String(valeur))
    return requete<ResultatRechercheWiki>(`/wiki/recherche?${params}`)
  },
  wikiModifier: (ean: string, f: ModifFicheWiki) =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(ean)}`, { method: 'PUT', body: JSON.stringify(f) }),
  wikiSupprimer: (ean: string) =>
    requete<void>(`/wiki/${encodeURIComponent(ean)}`, { method: 'DELETE' }),
  wikiPhotoRemplacer: (ean: string, photo: string) =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(ean)}/photo`, { method: 'PUT', body: JSON.stringify({ photo }) }),
  /** Donne le code-barres scanné à une fiche du Wiki qui n'avait qu'un code interne. */
  wikiAssocierCode: (eanInterne: string, ean: string) =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(eanInterne)}/code-barres`, {
      method: 'POST',
      body: JSON.stringify({ ean }),
    }),
  wikiRetirerCode: (ean: string, code: string) =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(ean)}/code-barres/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  /** Propose une canette au catalogue : créée « à vérifier » (acceptée d'emblée pour le propriétaire). */
  wikiProposer: (p: PropositionWiki) =>
    requete<FicheWiki>('/wiki/propositions', { method: 'POST', body: JSON.stringify(p) }),
  /** Propriétaire : accepte ou refuse une fiche. */
  wikiModerer: (ean: string, decision: 'acceptee' | 'refusee', motif = '') =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(ean)}/moderation`, {
      method: 'POST',
      body: JSON.stringify({ decision, motif }),
    }),
  /** Signale une erreur sur une fiche ; le motif est transmis sans lien avec le compte. */
  wikiSignaler: (ean: string, motif: string) =>
    requete<{ ok: boolean }>(`/wiki/${encodeURIComponent(ean)}/signalement`, {
      method: 'POST',
      body: JSON.stringify({ motif }),
    }),
  /** Propriétaire : classe un signalement (corrigé ou rejeté) et récupère la fiche à jour. */
  wikiSignalementTraite: (id: number) =>
    requete<FicheWiki>(`/wiki/signalements/${id}/traite`, { method: 'POST' }),
  wikiPhotoRetirer: (ean: string) =>
    requete<FicheWiki>(`/wiki/${encodeURIComponent(ean)}/photo`, { method: 'DELETE' }),
  wikiPhoto: (ean: string, version: string) => photoLocale('wiki', ean, version),
  wikiPhotoData: (ean: string, version: string) => photoEnDataUrl('wiki', ean, version),
  photo: (ean: string, version: string) => photoLocale('cans', ean, version),
}

async function photoBlob(espace: 'wiki' | 'cans', ean: string, version: string): Promise<Blob> {
  const r = await fetch(`${API_URL}/${espace}/${encodeURIComponent(ean)}/photo?v=${encodeURIComponent(version)}`, {
    headers: { Authorization: `Bearer ${jeton.lire()}` },
  })
  if (r.status === 401) throw new NonAutorise()
  if (!r.ok) throw new ErreurAPI(r.status, 'photo indisponible')
  return r.blob()
}

/** Une <img> ne peut pas envoyer l'en-tête Authorization : on charge l'image puis on la sert par URL locale. */
const photoLocale = async (espace: 'wiki' | 'cans', ean: string, version: string): Promise<string> =>
  URL.createObjectURL(await photoBlob(espace, ean, version))

const photoEnDataUrl = async (espace: 'wiki' | 'cans', ean: string, version: string): Promise<string> =>
  blobEnDataUrl(await photoBlob(espace, ean, version))
