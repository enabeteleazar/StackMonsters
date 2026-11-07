// Suivi du trafic vers le dashboard StackMonsters (via ntfy.sh).
// Actif seulement en production et si VITE_TRACK_TOPIC est défini (Vercel → Environment Variables).
// Pour ne pas compter vos propres visites : localStorage.setItem('sm_ignore', '1')

type Evenement = 'visit' | 'connection' | 'can_added'

const TOPIC = import.meta.env.VITE_TRACK_TOPIC as string | undefined
const actif = import.meta.env.PROD && !!TOPIC

const lire = (cle: string): string | null => {
  try {
    return localStorage.getItem(cle)
  } catch {
    return null
  }
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

function provenance(): string {
  const ua = navigator.userAgent
  let hote = ''
  try {
    hote = document.referrer ? new URL(document.referrer).hostname : ''
  } catch {
    /* référent invalide */
  }
  const utm = new URLSearchParams(location.search).get('utm_source') ?? ''
  const s = `${utm} ${hote}`.toLowerCase()
  if (/instagram/.test(s) || /Instagram/.test(ua)) return 'instagram'
  if (/facebook|fb\.com|fb\.me|(^|\s)fb(\s|$)/.test(s) || /FBAN|FBAV|FB_IAB/.test(ua)) return 'facebook'
  if (/twitter|(^|[\s.])t\.co(\s|$)|(^|[\s.])x\.com|(^|\s)x(\s|$)/.test(s)) return 'twitter'
  return hote && hote !== location.hostname ? 'other' : 'direct'
}

/** Envoie un événement ; n'échoue jamais et ne bloque jamais l'appli. */
export function suivre(type: Evenement): void {
  if (!actif || lire('sm_ignore')) return
  try {
    void fetch(`https://ntfy.sh/${TOPIC}`, {
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
  try {
    if (sessionStorage.getItem('sm_s')) return
    sessionStorage.setItem('sm_s', '1')
  } catch {
    /* sessionStorage indisponible : on compte quand même */
  }
  suivre('visit')
}
