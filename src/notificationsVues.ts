import type { EtatEchanges } from './types'
import { texteNotification } from './components/Echanges'

/** Notification d'échange à montrer en popup : une clé unique par étape (une nouvelle étape = nouvelle popup). */
export type NotificationAMontrer = { cle: string; texte: string }

/** Notifications qui attendent ce compte : réponse à une mise en relation, ou validation de l'échange par l'autre. */
export function notificationsAMontrer(etat: EtatEchanges): NotificationAMontrer[] {
  return [
    ...etat.notifications
      .filter((n) => n.action)
      .map((n) => ({ cle: `n-${n.id}-${n.statut}`, texte: texteNotification(n) })),
    ...etat.conversations
      .filter((c) => c.a_valider)
      .map((c) => ({
        cle: `v-${c.id}`,
        texte: `L’autre collectionneur a validé l’échange de ${c.fiche.nom || 'la canette'} : valide à ton tour une fois la canette reçue.`,
      })),
  ]
}

// Popups déjà montrées, par compte et par appareil (une notification revue ailleurs reste dans l'onglet).
const cle = (email: string) => `sm-notifs-vues:${email}`

export function popupsVues(email: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(cle(email)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function marquerPopupVue(email: string, id: string): void {
  try {
    const vues = [...popupsVues(email), id].slice(-300)
    localStorage.setItem(cle(email), JSON.stringify(vues))
  } catch {
    // stockage indisponible (navigation privée) : la popup pourra revenir, sans gravité
  }
}
