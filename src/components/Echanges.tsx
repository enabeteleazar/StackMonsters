import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bell, Check, ChevronRight, MessagesSquare, Repeat2, Send, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import type { ConversationEchange, EtatEchanges, MessageEchange, NotificationEchange } from '../types'
import PhotoWiki from './PhotoWiki'

type Props = {
  etat: EtatEchanges | null
  /** Vrai quand la dernière lecture a échoué (hors ligne…). */
  erreur: boolean
  surRecharger: () => Promise<void>
  surMessage: (m: string) => void
  surNonAutorise: () => void
}

type Onglet = 'notifications' | 'messagerie'

/** Relecture des messages pendant qu'une conversation est ouverte. */
const RELECTURE_MS = 5000

/** Texte d'une notification : jamais de nom ni d'adresse, seulement « un collectionneur ». */
function texteNotification(n: NotificationEchange) {
  const nom = n.fiche.nom || 'cette canette'
  if (n.role === 'chercheur' && n.statut === 'signalee') return `Un collectionneur a ${nom} en double.`
  if (n.role === 'chercheur') return `Demande envoyée pour ${nom}. En attente de sa réponse.`
  return `Un collectionneur est intéressé par ton double de ${nom}.`
}

/**
 * Échanges entre collectionneurs : notifications de mise en relation (Échange ou Annuler) et messagerie interne,
 * ouverte quand les deux ont choisi « Échange ».
 */
export default function Echanges({ etat, erreur, surRecharger, surMessage, surNonAutorise }: Props) {
  const aTraiter = etat?.notifications.filter((n) => n.action).length ?? 0
  const nonLus = etat?.conversations.reduce((t, c) => t + c.non_lus, 0) ?? 0
  const [onglet, setOnglet] = useState<Onglet>(() => (!aTraiter && nonLus ? 'messagerie' : 'notifications'))
  const [occupe, setOccupe] = useState<number | null>(null)
  const [ouverte, setOuverte] = useState<number | null>(null)

  const repondre = async (n: NotificationEchange, accepter: boolean) => {
    setOccupe(n.id)
    try {
      const r = accepter ? await api.accepterEchange(n.id) : await api.annulerEchange(n.id)
      await surRecharger()
      if (r.statut === 'acceptee') {
        surMessage('Échange accepté : la messagerie est ouverte')
        setOnglet('messagerie')
        setOuverte(r.id)
      } else if (r.statut === 'demandee') surMessage('Demande envoyée : il sera prévenu')
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else {
        surMessage(e instanceof ErreurAPI && e.status === 409 ? 'Cet échange n’est plus disponible' : 'Impossible pour le moment, réessaie avec le réseau')
        void surRecharger()
      }
    } finally {
      setOccupe(null)
    }
  }

  const conversation = ouverte ? (etat?.conversations.find((c) => c.id === ouverte) ?? null) : null

  return (
    <section className="collec echanges">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        <div className="wiki-tete">
          <h1 className="collec-titre">
            Mes <b>échanges.</b>
          </h1>
        </div>

        <div className="collec-tri collec-onglets" role="tablist" aria-label="Échanges">
          <button role="tab" aria-selected={onglet === 'notifications'} onClick={() => setOnglet('notifications')}>
            <Bell size={16} aria-hidden="true" />
            Notifications{aTraiter ? ` · ${aTraiter}` : ''}
          </button>
          <button role="tab" aria-selected={onglet === 'messagerie'} onClick={() => setOnglet('messagerie')}>
            <MessagesSquare size={16} aria-hidden="true" />
            Messagerie{nonLus ? ` · ${nonLus}` : ''}
          </button>
        </div>

        {etat === null ? (
          <p className="collec-vide">{erreur ? 'Les échanges ont besoin de la connexion.' : 'Chargement…'}</p>
        ) : onglet === 'notifications' ? (
          etat.notifications.length ? (
            <ul className="echanges-liste">
              {etat.notifications.map((n) => (
                <li key={n.id} className={`echange-notif${n.action ? ' a-traiter' : ''}`}>
                  <span className="collec-photo">
                    <PhotoWiki ean={n.fiche.ean} version={n.fiche.photo} taille={20} />
                  </span>
                  <div className="echange-notif-corps">
                    <p>{texteNotification(n)}</p>
                    <div className="echange-notif-actions">
                      {n.action && (
                        <button className="btn btn-primaire" disabled={occupe === n.id} onClick={() => void repondre(n, true)}>
                          <Check size={17} /> Échange
                        </button>
                      )}
                      <button className="btn btn-fantome" disabled={occupe === n.id} onClick={() => void repondre(n, false)}>
                        <X size={17} /> Annuler
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="collec-vide">
              <Repeat2 size={34} />
              Aucune notification. Marque des canettes « Je la cherche » dans le Wiki : tu seras prévenu dès qu’un
              collectionneur en a une en double.
            </p>
          )
        ) : etat.conversations.length ? (
          <ul className="collec-liste">
            {etat.conversations.map((c) => (
              <li key={c.id}>
                <button className="collec-ligne" onClick={() => setOuverte(c.id)}>
                  <span className="collec-photo">
                    <PhotoWiki ean={c.fiche.ean} version={c.fiche.photo} taille={20} />
                  </span>
                  <span className="collec-nom echange-conv">
                    {c.fiche.nom || 'Canette'}
                    <small>{c.dernier ?? 'Aucun message pour l’instant'}</small>
                  </span>
                  {!!c.non_lus && <b className="echange-pastille" aria-label={`${c.non_lus} non lu${c.non_lus > 1 ? 's' : ''}`}>{c.non_lus}</b>}
                  <ChevronRight size={20} className="collec-chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="collec-vide">
            <MessagesSquare size={34} />
            Aucune conversation. Elle s’ouvre quand vous choisissez tous les deux « Échange ».
          </p>
        )}
      </div>

      {conversation && (
        <Conversation
          conversation={conversation}
          surFermeture={() => {
            setOuverte(null)
            void surRecharger()
          }}
          surNonAutorise={surNonAutorise}
        />
      )}
    </section>
  )
}

/** Fil de discussion entre les deux membres d'un échange accepté (relu toutes les 5 secondes). */
function Conversation({ conversation, surFermeture, surNonAutorise }: {
  conversation: ConversationEchange
  surFermeture: () => void
  surNonAutorise: () => void
}) {
  const [messages, setMessages] = useState<MessageEchange[]>([])
  const [texte, setTexte] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const dernier = useRef(0)
  const fin = useRef<HTMLDivElement>(null)

  const relire = useCallback(async () => {
    try {
      const r = await api.messages(conversation.id, dernier.current)
      if (r.messages.length) {
        dernier.current = r.messages[r.messages.length - 1].id
        setMessages((liste) => [...liste, ...r.messages.filter((m) => !liste.some((x) => x.id === m.id))])
      }
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
    }
  }, [conversation.id, surNonAutorise])

  useEffect(() => {
    void relire()
    const minuterie = window.setInterval(() => {
      if (document.visibilityState === 'visible') void relire()
    }, RELECTURE_MS)
    return () => window.clearInterval(minuterie)
  }, [relire])

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermeture()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [surFermeture])

  const envoyer = async () => {
    const t = texte.trim()
    if (!t) return
    setEnvoi(true)
    setErreur(null)
    try {
      const m = await api.envoyerMessage(conversation.id, t)
      dernier.current = Math.max(dernier.current, m.id)
      setMessages((liste) => [...liste, m])
      setTexte('')
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreur(e instanceof ErreurAPI && e.status === 429 ? 'Trop de messages : réessaie un peu plus tard.' : 'Message non envoyé, réessaie avec le réseau.')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="verdict conversation" role="dialog" aria-modal="true" aria-label={`Conversation : ${conversation.fiche.nom}`}>
      <div className="scan-entete conversation-tete">
        <button className="btn-icone" onClick={surFermeture} aria-label="Retour aux échanges">
          <ArrowLeft size={20} />
        </button>
        <span className="collec-photo">
          <PhotoWiki ean={conversation.fiche.ean} version={conversation.fiche.photo} taille={18} />
        </span>
        <div className="conversation-titre">
          <b>{conversation.fiche.nom || 'Canette'}</b>
          <small>Échange avec un collectionneur</small>
        </div>
      </div>

      <div className="conversation-fil" aria-live="polite">
        <p className="conversation-note">
          Convenez ici de l’échange (canettes, envoi ou rencontre). Ne partage ton adresse qu’avec prudence.
        </p>
        {messages.map((m) => (
          <p key={m.id} className={`bulle${m.de_moi ? ' moi' : ''}`}>
            <span className="sr-only">{m.de_moi ? 'Toi : ' : 'Collectionneur : '}</span>
            {m.texte}
          </p>
        ))}
        <div ref={fin} />
      </div>

      <form
        className="conversation-saisie"
        onSubmit={(e) => {
          e.preventDefault()
          void envoyer()
        }}
      >
        {erreur && <p className="sous" role="alert">{erreur}</p>}
        <textarea
          value={texte}
          maxLength={1000}
          rows={1}
          placeholder="Ton message"
          aria-label="Ton message"
          onChange={(e) => setTexte(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void envoyer()
            }
          }}
        />
        <button type="submit" className="btn-icone conversation-envoyer" disabled={envoi || !texte.trim()} aria-label="Envoyer">
          <Send size={19} />
        </button>
      </form>
    </div>
  )
}
