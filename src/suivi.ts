// Suivi du trafic vers le tableau de bord StackMonsters (https://stackmonster-dashboard.vercel.app).
// Actif seulement en production. VITE_TRACK_URL permet de changer l'adresse de collecte (vide : adresse par défaut).
// Rien ne part sans consentement. Pour ne pas compter vos propres visites : localStorage.setItem('sm_ignore', '1')

type Evenement = 'visit' | 'connection' | 'can_added'

const COLLECTE = (import.meta.env.VITE_TRACK_URL as string | undefined) || 'https://stackmonster-dashboard.vercel.app/api/collect'
const actif = import.meta.env.PROD

const lire = (cle: string): string | null => {
  try {
    return localStorage.getItem(cle)
  } catch {
    return null
  }
}

export type Consentement = 'oui' | 'non' | null
export const EVENEMENT_CONSENTEMENT = 'sm-consentement'

// Recommandations de la CNIL : redemander après 6 mois un refus, après 13 mois un accord ;
// l'identifiant de mesure ne vit pas plus longtemps que l'accord.
const MOIS = 30 * 86_400_000
export const DUREE_CHOIX = { oui: 13 * MOIS, non: 6 * MOIS } as const

/** Choix encore valable à la date donnée ; null s'il est absent, illisible ou expiré. */
export function choixValide(enregistre: string | null, maintenant: number): Consentement {
  try {
    const { choix, date } = JSON.parse(enregistre ?? '') as { choix?: unknown; date?: unknown }
    if ((choix === 'oui' || choix === 'non') && typeof date === 'number' && maintenant - date < DUREE_CHOIX[choix]) {
      return choix
    }
  } catch {
    /* ancien format ou valeur illisible : on redemande */
  }
  return null
}

export function consentement(): Consentement {
  const choix = choixValide(lire('sm_consentement'), Date.now())
  if (choix !== 'oui') {
    try {
      localStorage.removeItem('sm_vid')
    } catch {
      /* rien à effacer */
    }
  }
  return choix
}

export function definirConsentement(valeur: 'oui' | 'non'): void {
  try {
    localStorage.setItem('sm_consentement', JSON.stringify({ choix: valeur, date: Date.now() }))
    if (valeur === 'non') localStorage.removeItem('sm_vid')
  } catch {
    /* navigation privée : le choix vaut pour cette page seulement */
  }
  window.dispatchEvent(new CustomEvent(EVENEMENT_CONSENTEMENT, { detail: valeur }))
}

function identifiant(): string {
  const existant = lire('sm_vid')
  if (existant) return existant
  const nouveau = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
  try {
    localStorage.setItem('sm_vid', nouveau)
  } catch {
    /* navigation privée : identifiant valable pour cette page seulement */
  }
  return nouveau
}

// Les tablettes comptent comme « mobile ».
function appareil(): 'mobile' | 'desktop' {
  const ua = navigator.userAgent
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const mobile =
    nav.userAgentData?.mobile ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return mobile ? 'mobile' : 'desktop'
}

/** Plateforme désignée par une valeur d'utm_source ou par l'hôte du site référent (en minuscules) ; null sinon. */
function plateformeDe(t: string): string | null {
  if (!t) return null
  if (/instagram/.test(t)) return 'instagram'
  if (/facebook|^fb$|(^|\.)fb\.(com|me)$/.test(t)) return 'facebook'
  if (/tiktok/.test(t)) return 'tiktok'
  if (/twitter|^t\.co$|^x$|(^|\.)x\.com$/.test(t)) return 'twitter'
  return null
}

/** Plateforme dont le navigateur intégré a ouvert la page (user-agent) ; null sinon. */
function plateformeDuNavigateur(ua: string): string | null {
  if (/Instagram/.test(ua)) return 'instagram'
  if (/FBAN|FBAV|FB_IAB/.test(ua)) return 'facebook'
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return 'tiktok'
  return null
}

/**
 * Site d'origine d'une visite (Instagram, Facebook, TikTok, Twitter/X, autre site, accès direct). Ordre de priorité
 * fixe : utm_source (le lien posté par l'équipe), puis le site référent, puis le navigateur intégré d'une appli.
 * Aucune donnée supplémentaire : seulement la catégorie renvoyée.
 */
export function provenanceDe(ua: string, referent: string, recherche: string, hoteActuel: string): string {
  let hote = ''
  try {
    hote = referent ? new URL(referent).hostname.toLowerCase() : ''
  } catch {
    /* référent invalide */
  }
  const utm = (new URLSearchParams(recherche).get('utm_source') ?? '').trim().toLowerCase()
  return (
    plateformeDe(utm) ??
    plateformeDe(hote) ??
    plateformeDuNavigateur(ua) ??
    (hote && hote !== hoteActuel ? 'other' : 'direct')
  )
}

function provenance(): string {
  return provenanceDe(navigator.userAgent, document.referrer, location.search, location.hostname)
}

/** Envoie un événement ; n'échoue jamais et ne bloque jamais l'appli. */
export function suivre(type: Evenement): void {
  if (!actif || lire('sm_ignore') || consentement() !== 'oui') return
  try {
    void fetch(COLLECTE, {
      method: 'POST',
      keepalive: true,
      body: JSON.stringify({ type, vid: identifiant(), device: appareil(), source: provenance() }),
    }).catch(() => {})
  } catch {
    /* le suivi est facultatif */
  }
}

/** À appeler une fois au chargement : compte une visite par session. */
export function initSuivi(): void {
  if (consentement() !== 'oui') return
  try {
    if (sessionStorage.getItem('sm_s')) return
    sessionStorage.setItem('sm_s', '1')
  } catch {
    /* sessionStorage indisponible : on compte quand même */
  }
  suivre('visit')
}
