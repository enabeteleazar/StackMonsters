import { API_URL, CLE_JETON } from './config'
import type { Canette, FicheWiki, ModifFicheWiki, ReponseWiki } from './types'

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
  enregistrer: (c: Canette) =>
    requete<Canette>('/cans', { method: 'PUT', body: JSON.stringify(c) }),
  ajuster: (ean: string, delta: number) =>
    requete<Canette>(`/cans/${encodeURIComponent(ean)}/nb`, { method: 'PATCH', body: JSON.stringify({ delta }) }),
  lire: (ean: string) => requete<Canette>(`/cans/${encodeURIComponent(ean)}`),
  supprimer: (ean: string) =>
    requete<void>(`/cans/${encodeURIComponent(ean)}`, { method: 'DELETE' }),
  demande: (email: string) =>
    requete<{ ok: boolean }>('/auth/demande', { method: 'POST', body: JSON.stringify({ email }) }),
  verification: (email: string, code: string) =>
    requete<{ token: string; email: string }>('/auth/verification', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),
  moi: () => requete<{ email: string }>('/auth/moi'),
  deconnexion: () => requete<void>('/auth/deconnexion', { method: 'POST' }),
  supprimerCompte: () => requete<void>('/auth/compte', { method: 'DELETE' }),
  stats: () =>
    requete<{ utilisateurs: number; references: number; connexions_uniques: number }>('/stats'),
  sante: () => requete<{ status: string; version: string; references: number }>('/health'),
  wiki: () => requete<ReponseWiki>('/wiki'),
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
