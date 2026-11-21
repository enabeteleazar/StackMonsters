import { api } from './api'

/** Notifications système (Web Push). Sur iPhone, seulement dans l'appli installée (iOS 16.4 et plus). */
export function notificationsPossibles(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** Clé publique VAPID (base64url) → octets attendus par pushManager.subscribe. */
function octets(cle: string): Uint8Array {
  const b64 = (cle + '='.repeat((4 - (cle.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

function versBase64Url(tampon: ArrayBuffer | null): string {
  if (!tampon) return ''
  return btoa(String.fromCharCode(...new Uint8Array(tampon))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function abonnementActuel(): Promise<PushSubscription | null> {
  if (!notificationsPossibles()) return null
  const enregistrement = await navigator.serviceWorker.getRegistration()
  return (await enregistrement?.pushManager.getSubscription()) ?? null
}

/** Vrai si cet appareil reçoit déjà les notifications. */
export async function notificationsActives(): Promise<boolean> {
  return Notification.permission === 'granted' && (await abonnementActuel()) !== null
}

export type ResultatActivation = 'active' | 'refusee' | 'indisponible'

/** Demande l'autorisation (à appeler depuis un geste de l'utilisateur), abonne l'appareil et l'enregistre. */
export async function activerNotifications(): Promise<ResultatActivation> {
  if (!notificationsPossibles()) return 'indisponible'
  const { cle } = await api.pushCle()
  if (!cle) return 'indisponible'
  if ((await Notification.requestPermission()) !== 'granted') return 'refusee'
  const enregistrement = await navigator.serviceWorker.ready
  const abonnement =
    (await enregistrement.pushManager.getSubscription()) ??
    (await enregistrement.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: octets(cle) }))
  await api.pushAbonner({
    endpoint: abonnement.endpoint,
    p256dh: versBase64Url(abonnement.getKey('p256dh')),
    auth: versBase64Url(abonnement.getKey('auth')),
  })
  return 'active'
}

/** Arrête les notifications sur cet appareil. */
export async function desactiverNotifications(): Promise<void> {
  const abonnement = await abonnementActuel()
  if (!abonnement) return
  await api
    .pushDesabonner({
      endpoint: abonnement.endpoint,
      p256dh: versBase64Url(abonnement.getKey('p256dh')),
      auth: versBase64Url(abonnement.getKey('auth')),
    })
    .catch(() => {})
  await abonnement.unsubscribe()
}
