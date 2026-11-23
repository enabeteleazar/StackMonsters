import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bell, Check, CheckCheck, ChevronRight, Flag, Lock, Megaphone, MessagesSquare, Repeat2, Send, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import { MOTIFS_SIGNALEMENT_MEMBRE, type ConversationEchange, type EtatEchanges, type MessageEchange, type NotificationEchange } from '../types'
import PhotoWiki from './PhotoWiki'

type Props = {
  etat: EtatEchanges | null
  /** Vrai quand la dernière lecture a échoué (hors ligne…). */
  erreur: boolean
  surRecharger: () => Promise<void>
  surMessage: (m: string) => void
  /** Après un échange validé par les deux : la collection a changé (-1 ou +1). */
  surCollectionChangee: () => Promise<void>
  surNonAutorise: () => void
}

type Onglet = 'notifications' | 'messagerie'

const jourCourt = (secondes: number) =>
  new Date(secondes * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

/** Relecture des messages pendant qu'une conversation est ouverte. */
const RELECTURE_MS = 5000

/** Texte d'une notification : jamais de nom ni d'adresse, seulement « un collectionneur ». */
export function texteNotification(n: NotificationEchange) {
  const nom = n.fiche.nom || 'cette canette'
  if (n.role === 'chercheur' && n.statut === 'signalee') return `Un collectionneur a ${nom} en double.`
  if (n.role === 'chercheur') return `Demande envoyée pour ${nom}. En attente de sa réponse.`
  return `Un collectionneur est intéressé par ton double de ${nom}.`
}

/**
 * Échanges entre collectionneurs : notifications de mise en relation (Échange ou Annuler) et messagerie interne,
 * ouverte quand les deux ont choisi « Échange ».
 */
export default function Echanges({ etat, erreur, surRecharger, surMessage, surCollectionChangee, surNonAutorise }: Props) {
  const aTraiter = etat?.notifications.filter((n) => n.action).length ?? 0
  const nonLus = etat?.conversations.reduce((t, c) => t + c.non_lus + (c.a_valider ? 1 : 0), 0) ?? 0
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
  const desynchronise = useCallback(() => void surRecharger(), [surRecharger])

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
          etat.notifications.length || etat.annonces?.length ? (
            <ul className="echanges-liste">
              {[
                ...etat.notifications.map((n) => ({ date: Date.parse(n.maj), n, a: null })),
                ...(etat.annonces ?? []).map((a) => ({ date: a.cree * 1000, n: null, a })),
              ]
                .sort((x, y) => y.date - x.date)
                .map(({ n, a }) =>
                  a ? (
                    // Message du service à tous : déjà vu en popup, il reste ici pour être relu.
                    <li key={`annonce-${a.id}`} className="echange-notif annonce-notif">
                      <span className="annonce-icone annonce-icone-petite" aria-hidden="true">
                        <Megaphone size={20} />
                      </span>
                      <div className="echange-notif-corps">
                        <p className="annonce-notif-titre">
                          {a.titre || 'Message de StackMonsters'} · {jourCourt(a.cree)}
                        </p>
                        <p className="annonce-notif-texte">{a.texte}</p>
                      </div>
                    </li>
                  ) : n ? (
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
                  ) : null,
                )}
            </ul>
          ) : (
            <p className="collec-vide">
              <Repeat2 size={34} />
              Aucune notification.
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
                    <small>
                      {c.statut === 'terminee'
                        ? 'Échange validé ✓'
                        : c.statut === 'fermee'
                          ? 'Conversation fermée'
                          : c.a_valider
                            ? 'L’autre a validé l’échange : à toi'
                            : (c.dernier ?? 'Aucun message pour l’instant')}
                    </small>
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
          surChange={async (statut) => {
            await surRecharger()
            if (statut === 'terminee') {
              await surCollectionChangee()
              surMessage('Échange validé : collections mises à jour')
            } else if (statut === 'fermee') surMessage('Signalement envoyé : la conversation est fermée')
            else surMessage('Validation enregistrée : l’autre doit valider à son tour')
          }}
          surDesynchronise={desynchronise}
          surNonAutorise={surNonAutorise}
        />
      )}
    </section>
  )
}

/** Fil de discussion entre les deux membres d'un échange accepté (relu toutes les 5 secondes). */
function Conversation({ conversation, surFermeture, surChange, surDesynchronise, surNonAutorise }: {
  conversation: ConversationEchange
  surFermeture: () => void
  /** Validation ou signalement enregistré (statut renvoyé par le serveur). */
  surChange: (statut: ConversationEchange['statut']) => Promise<void>
  /** L'autre a validé ou signalé pendant que la conversation est affichée : relire les échanges. */
  surDesynchronise: () => void
  surNonAutorise: () => void
}) {
  const [messages, setMessages] = useState<MessageEchange[]>([])
  const [texte, setTexte] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [action, setAction] = useState(false)
  const [signalement, setSignalement] = useState(false)
  const [motif, setMotif] = useState<string>(MOTIFS_SIGNALEMENT_MEMBRE[0])
  const [detail, setDetail] = useState('')
  const ouverte = conversation.statut === 'acceptee'
  const nom = conversation.fiche.nom || 'cette canette'

  const agir = async (appel: () => Promise<{ statut: ConversationEchange['statut'] }>) => {
    setAction(true)
    setErreur(null)
    try {
      const r = await appel()
      setSignalement(false)
      await surChange(r.statut)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else if (e instanceof ErreurAPI && (e.status === 409 || e.status === 429)) setErreur(e.detail)
      else setErreur('Impossible pour le moment, réessaie avec le réseau.')
    } finally {
      setAction(false)
    }
  }

  const valider = () => {
    const texte =
      conversation.role === 'possesseur'
        ? `Confirmer que tu as donné ton double de ${nom} ? Quand vous aurez validé tous les deux, il sera retiré de ta collection (−1).`
        : `Confirmer que tu as reçu ${nom} ? Quand vous aurez validé tous les deux, elle sera ajoutée à ta collection (+1).`
    if (confirm(texte)) void agir(() => api.validerEchange(conversation.id))
  }

  const dernier = useRef(0)
  const fin = useRef<HTMLDivElement>(null)

  const relire = useCallback(async () => {
    try {
      const r = await api.messages(conversation.id, dernier.current)
      if (r.statut !== conversation.statut || r.valide_autre !== conversation.valide_autre) surDesynchronise()
      if (r.messages.length) {
        dernier.current = r.messages[r.messages.length - 1].id
        setMessages((liste) => [...liste, ...r.messages.filter((m) => !liste.some((x) => x.id === m.id))])
      }
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
    }
  }, [conversation.id, conversation.statut, conversation.valide_autre, surDesynchronise, surNonAutorise])

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

      {/* Fin de l'échange : validation par les deux (-1 / +1), ou signalement de l'autre membre. */}
      <div className="conversation-actions">
        {conversation.statut === 'terminee' ? (
          <p className="conversation-etat ok">
            <CheckCheck size={17} aria-hidden="true" /> Échange validé : collections mises à jour.
          </p>
        ) : conversation.statut === 'fermee' ? (
          <p className="conversation-etat">
            <Lock size={17} aria-hidden="true" /> Conversation fermée après un signalement.
          </p>
        ) : (
          <>
            <button
              className={`btn ${conversation.valide_moi ? 'btn-fantome' : 'btn-primaire'}`}
              disabled={action || conversation.valide_moi}
              onClick={valider}
            >
              <CheckCheck size={17} />
              {conversation.valide_moi ? 'Validé, en attente de l’autre' : 'Valider l’échange'}
            </button>
            <button className="btn btn-fantome conversation-signaler" disabled={action} onClick={() => setSignalement((v) => !v)}>
              <Flag size={17} /> Signaler
            </button>
          </>
        )}
      </div>
      {ouverte && conversation.valide_autre && !conversation.valide_moi && (
        <p className="conversation-etat a-toi" role="status">L’autre a validé l’échange : valide à ton tour une fois la canette reçue.</p>
      )}

      {signalement && ouverte && (
        <form
          className="conversation-signalement"
          aria-label="Signaler ce membre"
          onSubmit={(e) => {
            e.preventDefault()
            void agir(() => api.signalerMembre(conversation.id, motif, detail))
          }}
        >
          <p>
            La conversation sera fermée pour vous deux et vous ne serez plus mis en relation. Le responsable du service
            examinera le signalement et pourra lire cette conversation.
          </p>
          <fieldset>
            <legend>Motif</legend>
            {MOTIFS_SIGNALEMENT_MEMBRE.map((m) => (
              <label key={m}>
                <input type="radio" name="motif" value={m} checked={motif === m} onChange={() => setMotif(m)} /> {m}
              </label>
            ))}
          </fieldset>
          <textarea
            value={detail}
            maxLength={500}
            rows={2}
            placeholder="Précisions (facultatif)"
            aria-label="Précisions"
            onChange={(e) => setDetail(e.target.value)}
          />
          <div className="conversation-signalement-actions">
            <button type="button" className="btn btn-fantome" onClick={() => setSignalement(false)}>Annuler</button>
            <button type="submit" className="btn btn-primaire reglages-danger" disabled={action}>
              <Flag size={17} /> Envoyer le signalement
            </button>
          </div>
        </form>
      )}

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

      {conversation.statut !== 'fermee' && (
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
      )}
      {conversation.statut === 'fermee' && erreur && <p className="sous" role="alert">{erreur}</p>}
    </div>
  )
}
