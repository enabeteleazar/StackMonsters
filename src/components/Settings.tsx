import { useEffect, useState } from 'react'
import { BarChart3, Cpu, Database, Download, FileJson, Lock, Radio, Server } from 'lucide-react'
import { api, jeton } from '../api'
import { moteurNatif } from '../scanner'
import type { Canette } from '../types'

type Props = {
  canettes: Canette[]
  joignable: boolean
  surVerrouiller: () => void
  surStats: () => void
}

export default function Settings({ canettes, joignable, surVerrouiller, surStats }: Props) {
  const [sante, setSante] = useState<{ status: string; version: string; references: number } | null>(null)

  // Seul le propriétaire (OWNER_EMAIL) obtient une réponse : sinon l'API répond 403 et le bouton reste caché.
  const [proprietaire, setProprietaire] = useState(false)

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

  const exportJson = () => {
    const fiches = canettes.map((c) => ({
      ean: c.ean,
      nom: c.nom,
      edition: c.edition,
      volume: c.volume,
      photo: c.photo,
      ajout: c.ajout,
    }))
    telecharger(
      `canstack-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(fiches, null, 2),
      'application/json',
    )
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
    telecharger('canstack.csv', '﻿' + csv, 'text/csv')
  }

  return (
    <section>
      <span className="eyebrow">StackMonster</span>
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
            <Database size={17} />
            Fiches en base
          </span>
          <span className="valeur">{sante ? sante.references : '—'}</span>
        </div>
        <div className="reglages-ligne">
          <span className="libelle">
            <Radio size={17} />
            Version du service
          </span>
          <span className="valeur">{sante?.version ?? '—'}</span>
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
          <button onClick={exportJson}>
            <FileJson size={15} />
            Sauvegarde JSON
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
        </div>
        <p className="sous" style={{ marginTop: 14 }}>
          La collection vit dans la base en ligne, pas sur ce téléphone. Ces exports sont une copie locale,
          pas une sauvegarde de remplacement.
        </p>
      </div>
    </section>
  )
}
