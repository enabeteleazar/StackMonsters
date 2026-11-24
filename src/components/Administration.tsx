import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BarChart3, BellRing, BookOpen, Flag, Lock, LockOpen, Megaphone, Search, Send, ShieldQuestion, Trash2, Users,
} from 'lucide-react'
import { api, ErreurAPI, NonAutorise, type AccueilAdmin } from '../api'
import type { CompteAdmin, FicheWiki as Fiche } from '../types'
import FicheWiki from './FicheWiki'
import PhotoWiki from './PhotoWiki'
import SignalementsMembres from './SignalementsMembres'

type Props = {
  surRetour: () => void
  surStats: () => void
  surMessage: (m: string) => void
  surNonAutorise: () => void
}

type Onglet = 'comptes' | 'fiches' | 'membres' | 'message'

const ONGLETS: { valeur: Onglet; libelle: string; Icone: typeof Users }[] = [
  { valeur: 'comptes', libelle: 'Comptes', Icone: Users },
  { valeur: 'fiches', libelle: 'Fiches', Icone: BookOpen },
  { valeur: 'membres', libelle: 'Membres', Icone: Flag },
  { valeur: 'message', libelle: 'Message', Icone: Megaphone },
]

const jour = (secondes: number) => new Date(secondes * 1000).toLocaleDateString('fr-FR', { dateStyle: 'medium' })
const jourCourt = (secondes: number) => new Date(secondes * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })

/** Page Administration (propriétaire) : comptes, fiches signalées et proposées, membres signalés, message à tous. */
export default function Administration({ surRetour, surStats, surMessage, surNonAutorise }: Props) {
  const [onglet, setOnglet] = useState<Onglet>('comptes')

  const echec = useCallback(
    (e: unknown) => {
      if (e instanceof NonAutorise) surNonAutorise()
      else surMessage(e instanceof ErreurAPI ? `Refusé : ${e.detail}` : 'Impossible pour le moment, réessaie avec le réseau')
    },
    [surMessage, surNonAutorise],
  )

  return (
    <section className="collec admin">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu">
        <div className="wiki-tete">
          <h1 className="collec-titre">
            Admini<b>stration.</b>
          </h1>
        </div>

        <div className="collec-tri collec-onglets admin-onglets" role="tablist" aria-label="Administration">
          {ONGLETS.map(({ valeur, libelle, Icone }) => (
            <button key={valeur} role="tab" aria-selected={onglet === valeur} onClick={() => setOnglet(valeur)}>
              <Icone size={15} aria-hidden="true" />
              {libelle}
            </button>
          ))}
        </div>

        {onglet === 'comptes' && <Comptes echec={echec} surMessage={surMessage} />}
        {onglet === 'fiches' && <Fiches echec={echec} surNonAutorise={surNonAutorise} />}
        {onglet === 'membres' && <SignalementsMembres surNonAutorise={surNonAutorise} />}
        {onglet === 'message' && (
          <>
            <MessageATous echec={echec} surMessage={surMessage} />
            <MessageAccueil echec={echec} surMessage={surMessage} />
          </>
        )}

        <div className="reglages-actions stats-actions">
          <button className="accueil-co-secondaire" onClick={surStats}>
            <BarChart3 size={18} />
            Statistiques
          </button>
          <button className="accueil-co-secondaire" onClick={surRetour}>
            <ArrowLeft size={18} />
            Retour aux réglages
          </button>
        </div>
      </div>
    </section>
  )
}

/** Comptes : recherche par adresse, blocage (plus de connexion) et suppression (adresse à recopier). */
function Comptes({ echec, surMessage }: { echec: (e: unknown) => void; surMessage: (m: string) => void }) {
  const [comptes, setComptes] = useState<CompteAdmin[] | null>(null)
  const [q, setQ] = useState('')
  const [occupe, setOccupe] = useState<number | null>(null)

  const charger = useCallback(async () => {
    try {
      setComptes(await api.adminComptes())
    } catch (e) {
      echec(e)
    }
  }, [echec])

  useEffect(() => {
    void charger()
  }, [charger])

  const vus = useMemo(() => {
    const t = q.trim().toLowerCase()
    return (comptes ?? []).filter((c) => !t || c.email.includes(t))
  }, [comptes, q])

  const agir = async (c: CompteAdmin, action: () => Promise<unknown>, message: string) => {
    setOccupe(c.id)
    try {
      await action()
      surMessage(message)
      await charger()
    } catch (e) {
      echec(e)
    } finally {
      setOccupe(null)
    }
  }

  const bloquer = (c: CompteAdmin) => {
    const bloque = !c.bloque
    const question = bloque
      ? `Bloquer ${c.email} ? Toutes ses sessions sont fermées et il ne pourra plus se connecter.`
      : `Débloquer ${c.email} ? Il pourra de nouveau se connecter.`
    if (confirm(question)) void agir(c, () => api.adminBloquer(c.id, bloque), bloque ? 'Compte bloqué' : 'Compte débloqué')
  }

  const supprimer = (c: CompteAdmin) => {
    const saisie = prompt(
      `Supprimer définitivement ${c.email} ? Sa collection, ses échanges et ses messages seront effacés ; ` +
        'le Wiki reste. Sans blocage, il pourra recréer un compte. Recopie l’adresse pour confirmer :',
    )
    if (saisie === null) return
    if (saisie.trim().toLowerCase() !== c.email) {
      surMessage('Adresse différente : rien n’a été supprimé')
      return
    }
    void agir(c, () => api.adminSupprimer(c.id, saisie), 'Compte supprimé')
  }

  return (
    <div className="admin-section">
      <label className="collec-recherche">
        <Search size={18} />
        <input
          value={q}
          type="search"
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher une adresse"
          aria-label="Chercher une adresse"
        />
      </label>
      {comptes === null ? (
        <p className="collec-vide">Chargement…</p>
      ) : (
        <>
          <p className="wiki-resultats">
            {vus.length} compte{vus.length > 1 ? 's' : ''}
            {comptes.some((c) => c.bloque) && ` · ${comptes.filter((c) => c.bloque).length} bloqué(s)`}
          </p>
          <ul className="echanges-liste">
            {vus.map((c) => (
              <li key={c.id} className={`reglages-carte admin-compte${c.bloque ? ' bloque' : ''}`}>
                <div className="admin-compte-tete">
                  <b>{c.email}</b>
                  {c.proprietaire && <span className="admin-pastille">Propriétaire</span>}
                  {c.bloque && <span className="admin-pastille danger">Bloqué</span>}
                  {!!c.signalements && (
                    <span className="admin-pastille danger">
                      {c.signalements} signalement{c.signalements > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <p className="sous">
                  {c.canettes} canette{c.canettes > 1 ? 's' : ''} · créé {jourCourt(c.cree)} ·{' '}
                  {c.activite ? `actif ${jourCourt(c.activite)}` : 'pas de session'}
                </p>
                {!c.proprietaire && (
                  <div className="echange-notif-actions">
                    <button className="btn btn-fantome" disabled={occupe === c.id} onClick={() => bloquer(c)}>
                      {c.bloque ? <LockOpen size={17} /> : <Lock size={17} />}
                      {c.bloque ? 'Débloquer' : 'Bloquer'}
                    </button>
                    <button className="btn btn-fantome reglages-danger" disabled={occupe === c.id} onClick={() => supprimer(c)}>
                      <Trash2 size={17} /> Supprimer
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** Fiches signalées et fiches proposées (à vérifier) : un clic ouvre la fiche du Wiki, avec ses outils. */
function Fiches({ echec, surNonAutorise }: { echec: (e: unknown) => void; surNonAutorise: () => void }) {
  const [signalees, setSignalees] = useState<Fiche[] | null>(null)
  const [proposees, setProposees] = useState<Fiche[] | null>(null)
  const [ouverte, setOuverte] = useState<Fiche | null>(null)

  const charger = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        api.wikiRecherche({ signalees: true, tri: 'recent', par_page: 60 }),
        api.wikiRecherche({ a_verifier: true, tri: 'recent', par_page: 60 }),
      ])
      setSignalees(s.fiches)
      setProposees(p.fiches)
    } catch (e) {
      echec(e)
    }
  }, [echec])

  useEffect(() => {
    void charger()
  }, [charger])

  const liste = (titre: string, Icone: typeof Flag, fiches: Fiche[] | null, vide: string) => (
    <div className="admin-fiches">
      <h2 className="reglages-titre">
        <Icone size={16} aria-hidden="true" /> {titre}
        {fiches ? ` · ${fiches.length}` : ''}
      </h2>
      {fiches === null ? (
        <p className="sous">Chargement…</p>
      ) : fiches.length ? (
        <ul className="collec-liste">
          {fiches.map((f) => (
            <li key={f.ean}>
              <button className="collec-ligne" onClick={() => setOuverte(f)}>
                <span className="collec-photo">
                  <PhotoWiki ean={f.ean} version={f.photo} taille={20} />
                </span>
                <span className="collec-nom echange-conv">
                  {f.nom || 'Sans nom'}
                  {!!f.signalements?.length && <small>{f.signalements.map((s) => s.motif).join(' · ')}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sous">{vide}</p>
      )}
    </div>
  )

  return (
    <div className="admin-section">
      {liste('Fiches signalées', Flag, signalees, 'Aucune fiche signalée.')}
      {liste('Fiches proposées, à vérifier', ShieldQuestion, proposees, 'Aucune fiche à vérifier.')}
      {ouverte && (
        <FicheWiki
          fiche={ouverte}
          peutEditer
          surFermeture={() => {
            setOuverte(null)
            void charger()
          }}
          surNonAutorise={surNonAutorise}
          surEnregistree={(_, maj) => setOuverte((f) => (f ? { ...f, ...maj } : f))}
          surSupprimee={() => {
            setOuverte(null)
            void charger()
          }}
        />
      )}
    </div>
  )
}

/** Message à tous : popup à l'ouverture de l'appli (une fois par compte) et notification système. */
function MessageATous({ echec, surMessage }: { echec: (e: unknown) => void; surMessage: (m: string) => void }) {
  const [titre, setTitre] = useState('')
  const [texte, setTexte] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [etat, setEtat] = useState<Awaited<ReturnType<typeof api.adminAnnonces>> | null>(null)
  const [test, setTest] = useState<{ occupe: boolean; resultat: string | null }>({ occupe: false, resultat: null })

  // Notification de test : seulement vers les appareils abonnés de ce compte ; rien n'est montré aux membres.
  const tester = async () => {
    setTest({ occupe: true, resultat: null })
    try {
      const r = await api.adminPushTest()
      let resultat: string
      if (!r.push) resultat = 'Notifications non configurées sur le serveur (clés VAPID absentes) : aucun envoi.'
      else if (r.appareils === 0) {
        resultat = 'Aucun appareil abonné sur ce compte. Active « Notifications » dans les Réglages de l’appli installée, puis réessaie.'
      } else {
        resultat = `Notification de test envoyée sur ${r.notifies} appareil${r.notifies > 1 ? 's' : ''} (sur ${r.appareils}).`
        if (r.erreurs.length) resultat += ` Échec : ${r.erreurs.map((e) => `${e.service} (${e.code})`).join(', ')}.`
        if (r.expires) resultat += ` ${r.expires} abonnement${r.expires > 1 ? 's' : ''} expiré${r.expires > 1 ? 's' : ''} retiré${r.expires > 1 ? 's' : ''}.`
      }
      setTest({ occupe: false, resultat })
    } catch (e) {
      setTest({ occupe: false, resultat: null })
      echec(e)
    }
  }

  // Seule la lecture la plus récente compte : une lecture lente lancée à l'ouverture ne doit pas écraser
  // l'historique relu juste après un envoi.
  const lecture = useRef(0)
  const charger = useCallback(async () => {
    const numero = ++lecture.current
    try {
      const r = await api.adminAnnonces()
      if (numero === lecture.current) setEtat(r)
    } catch (e) {
      if (numero === lecture.current) echec(e)
    }
  }, [echec])

  useEffect(() => {
    void charger()
  }, [charger])

  const envoyer = async () => {
    const t = texte.trim()
    const tt = titre.trim()
    if (!t || !confirm(`Envoyer ce message à tous les membres ?\n\n${tt ? `${tt}\n` : ''}« ${t} »`)) return
    setEnvoi(true)
    try {
      const r = await api.adminAnnoncer(tt, t)
      surMessage(
        r.push
          ? `Message envoyé : notification sur ${r.notifies} appareil${r.notifies > 1 ? 's' : ''}, popup pour tous`
          : 'Message envoyé : popup pour tous (notifications non configurées)',
      )
      setTexte('')
      setTitre('')
      await charger()
    } catch (e) {
      echec(e)
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <div className="admin-section">
      <p className="sous">
        Chaque membre le verra une fois, en popup, à l’ouverture de l’appli. Les appareils qui ont activé les
        notifications le reçoivent aussi en notification système
        {etat ? ` (${etat.appareils} appareil${etat.appareils > 1 ? 's' : ''} abonné${etat.appareils > 1 ? 's' : ''})` : ''}.
      </p>
      {etat && !etat.push && (
        <p className="reglages-alerte">
          Notifications non configurées sur le serveur (clés VAPID absentes) : seule la popup sera affichée.
        </p>
      )}
      <input
        className="admin-message admin-titre"
        value={titre}
        maxLength={60}
        placeholder="Titre (facultatif)"
        aria-label="Titre du message"
        onChange={(e) => setTitre(e.target.value)}
      />
      <textarea
        className="admin-message"
        value={texte}
        maxLength={1000}
        rows={10}
        placeholder="Ton message à tous les membres"
        aria-label="Message à tous les membres"
        onChange={(e) => setTexte(e.target.value)}
      />
      <p className="sous admin-compteur">{texte.length} / 1000</p>
      <button className="btn btn-primaire" disabled={envoi || !texte.trim()} onClick={() => void envoyer()}>
        <Send size={17} /> Envoyer à tous
      </button>

      {/* Notification de test (#31) : seulement là où le serveur l'active (Preview), pas en production. */}
      {etat?.notif_test && (
        <>
          <h2 className="reglages-titre">Tester sur mes appareils</h2>
          <p className="sous">
            Envoie une notification système uniquement aux appareils abonnés de ton compte. Les membres ne voient rien.
          </p>
          <button className="btn btn-fantome" disabled={test.occupe} onClick={() => void tester()}>
            <BellRing size={17} /> M’envoyer une notification de test
          </button>
          {test.resultat && <p className="admin-test-resultat" role="status">{test.resultat}</p>}
        </>
      )}

      {!!etat?.annonces.length && (
        <>
          <h2 className="reglages-titre">Messages envoyés</h2>
          <ul className="echanges-liste">
            {etat.annonces.map((a) => (
              <li key={a.id} className="reglages-carte">
                {a.titre && <p className="admin-annonce-titre">{a.titre}</p>}
                <p className="admin-annonce-texte">{a.texte}</p>
                <p className="sous">
                  {jour(a.cree)} · notification sur {a.notifies} appareil{a.notifies > 1 ? 's' : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * Message d'accueil des nouveaux comptes (#34) : popup une seule fois par compte (tous appareils), à la première
 * ouverture de l'appli, seulement s'il est actif. Les comptes créés avant la mise en place ne le voient pas.
 */
function MessageAccueil({ echec, surMessage }: { echec: (e: unknown) => void; surMessage: (m: string) => void }) {
  const [enregistre, setEnregistre] = useState<AccueilAdmin | null>(null)
  const [titre, setTitre] = useState('')
  const [texte, setTexte] = useState('')
  const [actif, setActif] = useState(false)
  const [occupe, setOccupe] = useState(false)

  const appliquer = (a: AccueilAdmin) => {
    setEnregistre(a)
    setTitre(a.titre)
    setTexte(a.texte)
    setActif(a.actif)
  }

  useEffect(() => {
    api.adminAccueil().then(appliquer).catch(echec)
  }, [echec])

  const modifie = !!enregistre && (titre !== enregistre.titre || texte !== enregistre.texte || actif !== enregistre.actif)

  const enregistrer = async () => {
    setOccupe(true)
    try {
      const r = await api.adminAccueilEnregistrer({ titre: titre.trim(), texte: texte.trim(), actif })
      appliquer(r)
      surMessage(r.actif ? 'Message d’accueil enregistré et actif' : 'Message d’accueil enregistré, désactivé')
    } catch (e) {
      echec(e)
    } finally {
      setOccupe(false)
    }
  }

  if (!enregistre) return null
  return (
    <div className="admin-section admin-accueil">
      <h2 className="reglages-titre">Message d’accueil des nouveaux comptes</h2>
      <p className="sous">
        Une popup, une seule fois par compte, à la première ouverture de l’appli. Les comptes déjà inscrits ne la
        voient pas. Aucune notification n’est envoyée.
        {enregistre.maj === null && ' Texte provisoire, jamais enregistré.'}
      </p>
      <input
        className="admin-message admin-titre"
        value={titre}
        maxLength={60}
        placeholder="Titre (par défaut : Bienvenue sur StackMonsters)"
        aria-label="Titre du message d’accueil"
        onChange={(e) => setTitre(e.target.value)}
      />
      <textarea
        className="admin-message admin-accueil-texte"
        value={texte}
        maxLength={1000}
        rows={6}
        placeholder="Texte du message d’accueil"
        aria-label="Texte du message d’accueil"
        onChange={(e) => setTexte(e.target.value)}
      />
      <p className="sous admin-compteur">{texte.length} / 1000</p>
      <label className="admin-accueil-actif">
        <input type="checkbox" role="switch" checked={actif} onChange={(e) => setActif(e.target.checked)} />
        <span>{actif ? 'Actif : montré aux nouveaux comptes' : 'Désactivé : personne ne le voit'}</span>
      </label>
      {enregistre.actif && (
        <p className="sous">
          {enregistre.comptes_en_attente} compte{enregistre.comptes_en_attente > 1 ? 's' : ''} ne l’{enregistre.comptes_en_attente > 1 ? 'ont' : 'a'} pas encore vu.
        </p>
      )}
      <button
        className="btn btn-primaire"
        disabled={occupe || !modifie || (actif && !texte.trim())}
        onClick={() => void enregistrer()}
      >
        Enregistrer le message d’accueil
      </button>
    </div>
  )
}
