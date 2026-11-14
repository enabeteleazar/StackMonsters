/**
 * Invitation à installer l'appli (PWA) après la première connexion sur un appareil.
 * Android (Chrome, Edge, Samsung…) : le navigateur fournit l'événement « beforeinstallprompt », gardé ici pour
 * ouvrir sa fenêtre d'installation au clic. iOS : aucune API, l'invitation explique le geste « Partager →
 * Sur l'écran d'accueil ».
 */

export type Plateforme = 'ios' | 'android' | 'autre'

/** Événement non standard de Chrome : fenêtre d'installation ouverte à la demande. */
type EvenementInstallation = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const CLE_INVITATION = 'sm_invitation_installation'
let installationDifferee: EvenementInstallation | null = null
const abonnes = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // pas de mini-bannière automatique : l'appli propose l'installation au bon moment
    installationDifferee = e as EvenementInstallation
    abonnes.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    installationDifferee = null
    abonnes.forEach((f) => f())
  })
}

/** iPadOS se présente comme un Mac : on le reconnaît à son écran tactile. */
export function plateformeDe(ua: string, pointsTactiles: number): Plateforme {
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && pointsTactiles > 1)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'autre'
}

export const plateforme = (): Plateforme => plateformeDe(navigator.userAgent, navigator.maxTouchPoints ?? 0)

/** Déjà ouverte depuis l'écran d'accueil : inutile de proposer l'installation. */
export function estInstallee(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function invitationDejaVue(): boolean {
  try {
    return localStorage.getItem(CLE_INVITATION) !== null
  } catch {
    return false
  }
}

export function marquerInvitationVue(): void {
  try {
    localStorage.setItem(CLE_INVITATION, String(Date.now()))
  } catch {
    /* l'invitation pourra revenir à la prochaine connexion */
  }
}

/** Faut-il inviter à installer, juste après une connexion sur cet appareil ? */
export const inviterAInstaller = (): boolean => plateforme() !== 'autre' && !estInstallee() && !invitationDejaVue()

export const installationDirecte = (): boolean => installationDifferee !== null

/** Prévenu quand l'installation directe devient possible (ou ne l'est plus). */
export function suivreInstallation(f: () => void): () => void {
  abonnes.add(f)
  return () => abonnes.delete(f)
}

/** Ouvre la fenêtre d'installation du navigateur ; vrai si l'utilisateur l'a acceptée. */
export async function installer(): Promise<boolean> {
  const e = installationDifferee
  if (!e) return false
  installationDifferee = null
  await e.prompt()
  return (await e.userChoice).outcome === 'accepted'
}
