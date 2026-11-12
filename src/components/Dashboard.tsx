import { useMemo } from 'react'
import { PlusCircle, ScanLine } from 'lucide-react'
import type { Canette } from '../types'
import PhotoWiki from './PhotoWiki'

type Props = {
  canettes: Canette[]
  nomUtilisateur: string
  surScanner: () => void
  surAjouter: () => void
  surOuvrir: (ean: string) => void
}

function estCeMois(iso: string) {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()
}

export default function Dashboard({
  canettes,
  nomUtilisateur,
  surScanner,
  surAjouter,
  surOuvrir,
}: Props) {

  const rayures = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const d = ((i * 37 + 11) % 10) + 1
        return { largeur: 1 + (d % 4), opacite: 0.3 + (d % 5) / 10 }
      }),
    [],
  )

  const stats = useMemo(() => {
    const references = canettes.length
    const ceMois = canettes.filter((c) => estCeMois(c.ajout)).length
    const palier = references === 0 ? 50 : Math.ceil((references + 1) / 50) * 50
    const progres = Math.min(100, Math.round((references / palier) * 100))
    return { references, ceMois, palier, progres }
  }, [canettes])

  const recentes = useMemo(
    () => [...canettes].sort((a, b) => b.ajout.localeCompare(a.ajout)).slice(0, 8),
    [canettes],
  )

  return (
    <section className="tableau-bord">
      <div className="zebre" aria-hidden="true">
        {rayures.map((r, i) => (
          <i key={i} style={{ width: r.largeur, opacity: r.opacite }} />
        ))}
      </div>
      <span className="eyebrow">
        StackMonster · {nomUtilisateur ? `Bonjour, ${nomUtilisateur}` : 'Collection'}
      </span>
      <h1 className="tb-titre">
        Ta collection
        <span>en un coup d'œil</span>
      </h1>

      <div className="stats-grille">
        <div className="stat-tuile accent">
          <b>{stats.references}</b>
          <span>Références</span>
        </div>
        <div className="stat-tuile">
          <b>+{stats.ceMois}</b>
          <span>Ce mois</span>
        </div>
      </div>

      <div className="palier">
        <div className="palier-tete">
          <span>Prochain palier de références</span>
          <span>{stats.references} / {stats.palier}</span>
        </div>
        <div className="barre-progres">
          <i style={{ width: `${stats.progres}%` }} />
        </div>
      </div>

      <button className="scan-cta" onClick={surScanner}>
        <ScanLine size={26} strokeWidth={2.4} />
        Scan canette
      </button>

      <div className="raccourcis">
        <button className="raccourci" onClick={surAjouter}>
          <PlusCircle size={22} />
          <span>Ajouter sans code-barres</span>
        </button>
      </div>

      {recentes.length > 0 && (
        <>
          <div className="section-titre">
            <h2>Ajoutées récemment</h2>
          </div>
          <div className="flux-recent">
            {recentes.map((c) => (
              <button key={c.ean} className="flux-carte" onClick={() => surOuvrir(c.ean)}>
                <PhotoWiki source="collection" ean={c.ean} version={c.photo_version} taille={18} />
                <b>{c.nom || 'Sans nom'}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
