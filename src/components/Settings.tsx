import { useEffect, useState } from 'react'
import { BarChart3, Cpu, Database, Download, FileJson, Lock, Radio, Server, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import { api, jeton, NonAutorise } from '../api'
import { ficheSauvegarde } from '../sauvegarde'
import { consentement, definirConsentement, EVENEMENT_CONSENTEMENT } from '../suivi'
import { moteurNatif } from '../scanner'
import LienInstagram from './LienInstagram'
import type { Canette } from '../types'

type Props = {
  canettes: Canette[]
  emailUtilisateur: string
  joignable: boolean
  surVerrouiller: () => void
  surStats: () => void
}

export default function Settings({ canettes, emailUtilisateur, joignable, surVerrouiller, surStats }: Props) {
  const [sante, setSante] = useState<{ status: string; version: string; references: number } | null>(null)

  // Seul le propriétaire (OWNER_EMAIL) obtient une réponse : sinon l'API répond 403 et le bouton reste caché.
  const [proprietaire, setProprietaire] = useState(false)
  const [sauvegardeEnCours, setSauvegardeEnCours] = useState(false)
  const [erreurSauvegarde, setErreurSauvegarde] = useState<string | null>(null)
  const [erreurCompte, setErreurCompte] = useState<string | null>(null)
  const [mesure, setMesure] = useState(consentement)

  useEffect(() => {
    const maj = () => setMesure(consentement())
    window.addEventListener(EVENEMENT_CONSENTEMENT, maj)
    return () => window.removeEventListener(EVENEMENT_CONSENTEMENT, maj)
  }, [])

  const quitter = () => {
    jeton.effacer()
    surVerrouiller()
  }

  const deconnecterPartout = async () => {
    if (!confirm('Déconnecter tous tes appareils, celui-ci compris ?')) return
    setErreurCompte(null)
    try {
      await api.deconnexionPartout()
      quitter()
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Déconnexion impossible, réessaie avec le réseau.')
    }
  }

  const supprimerCompte = async () => {
    const saisie = prompt(
      `Suppression définitive du compte et de toute ta collection. Pense à faire une sauvegarde.\n\nPour confirmer, saisis ${emailUtilisateur} :`,
    )
    if (saisie === null) return
    if (saisie.trim().toLowerCase() !== emailUtilisateur.toLowerCase()) {
      setErreurCompte('Adresse différente : le compte n’a pas été supprimé.')
      return
    }
    setErreurCompte(null)
    try {
      await api.supprimerCompte()
      quitter()
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurCompte('Suppression impossible, réessaie avec le réseau.')
    }
  }

  useEffect(() => {
    api.sante().then(setSante).catch(() => setSante(null))
    api.stats().then(() => setProprietaire(true)).catch(() => setProprietaire(false))
  }, [joignable])

  const telecharger = (nom: string, contenu: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([contenu], { type }))
    a.download = nom
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // Une photo illisible annule tout : une sauvegarde ne doit jamais être incomplète sans le dire.
  const exportJson = async () => {
    setSauvegardeEnCours(true)
    setErreurSauvegarde(null)
    try {
      const fiches = []
      for (const c of canettes) {
        fiches.push(ficheSauvegarde(c, c.photo_version ? await api.photoData(c.ean, c.photo_version) : null))
      }
      telecharger(
        `stackmonsters-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(fiches, null, 2),
        'application/json',
      )
    } catch (e) {
      if (e instanceof NonAutorise) surVerrouiller()
      else setErreurSauvegarde('Sauvegarde annulée : une photo n’a pas pu être lue. Aucun fichier n’a été créé.')
    } finally {
      setSauvegardeEnCours(false)
    }
  }

  const exportCsv = () => {
    const cols: (keyof Canette)[] = ['ean', 'nom', 'edition', 'volume', 'ajout']
    const csv = [cols.join(';')]
      .concat(
        canettes.map((c) =>
          cols.map((k) => `"${String(c[k] ?? '').replace(/"/g, '""')}"`).join(';'),
        ),
      )
      .join('\n')
    telecharger('stackmonsters.csv', '﻿' + csv, 'text/csv')
  }

  return (
    <section>
      <span className="eyebrow">StackMonsters</span>
      <h1 className="tb-titre" style={{ fontSize: 'clamp(26px,7vw,34px)' }}>
        Réglages
      </h1>

      <div className="reglages-groupe">
        <div className="section-titre">
          <h2>Service</h2>
        </div>
        <div className="reglages-ligne">
          <span className="libelle">
            <Server size={17} />
            Connexion au service
          </span>
          <span className={`valeur ${joignable ? 'ok' : 'ko'}`}>
            {joignable ? 'En ligne' : 'Injoignable'}
          </span>
        </div>
        <div className="reglages-ligne">
          <span className="libelle">
            <UserRound size={17} />
            Compte
          </span>
          <span className="valeur">{emailUtilisateur || '—'}</span>
        </div>
        <div className="reglages-ligne">
          <span className="libelle">
            <Database size={17} />
            Fiches en base
          </span>
          <span className="valeur">{sante ? sante.references : '—'}</span>
        </div>
        <div className="reglages-ligne">
          <span className="libelle">
            <Radio size={17} />
            Version
          </span>
          <span className="valeur">
            {/* Une version d'API différente signale un déploiement incomplet ou un cache périmé. */}
            {!sante || sante.version === __VERSION_APP__ ? __VERSION_APP__ : `${__VERSION_APP__} · service ${sante.version}`}
          </span>
        </div>
        <div className="reglages-ligne">
          <span className="libelle">
            <Cpu size={17} />
            Lecteur de code-barres
          </span>
          <span className="valeur">{moteurNatif() ? 'Natif (BarcodeDetector)' : 'ZXing (polyfill wasm)'}</span>
        </div>
      </div>

      <div className="reglages-groupe">
        <div className="section-titre">
          <h2>Données</h2>
        </div>
        <div className="outils">
          <button disabled={sauvegardeEnCours} onClick={() => void exportJson()}>
            <FileJson size={15} />
            {sauvegardeEnCours ? 'Sauvegarde…' : 'Sauvegarde JSON'}
          </button>
          <button onClick={exportCsv}>
            <Download size={15} />
            Export CSV
          </button>
          {proprietaire && (
            <button onClick={surStats}>
              <BarChart3 size={15} />
              Statistiques
            </button>
          )}
          <button
            onClick={() => {
              void api.deconnexion().catch(() => {})
              jeton.effacer()
              surVerrouiller()
            }}
          >
            <Lock size={15} />
            Se déconnecter
          </button>
          <button onClick={() => void deconnecterPartout()}>
            <Lock size={15} />
            Se déconnecter partout
          </button>
          <button onClick={() => { window.location.hash = 'confidentialite' }}>
            <ShieldCheck size={15} />
            Confidentialité
          </button>
          {import.meta.env.PROD && (
            <button onClick={() => definirConsentement(mesure === 'oui' ? 'non' : 'oui')}>
              <Radio size={15} />
              {mesure === 'oui' ? 'Refuser la mesure d’audience' : 'Accepter la mesure d’audience'}
            </button>
          )}
          {!proprietaire && (
            <button onClick={() => void supprimerCompte()}>
              <Trash2 size={15} />
              Supprimer mon compte
            </button>
          )}
        </div>
        {erreurSauvegarde && <p className="sous" role="alert">{erreurSauvegarde}</p>}
        {erreurCompte && <p className="sous" role="alert">{erreurCompte}</p>}
        <p className="sous" style={{ marginTop: 14 }}>
          La collection vit dans la base en ligne, pas sur ce téléphone. Ces exports sont une copie locale,
          pas une sauvegarde de remplacement.
        </p>
      </div>
      <LienInstagram />
    </section>
  )
}
