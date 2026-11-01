import { useMemo, useState } from 'react'
import { ImageOff, PlusCircle, ScanLine, Settings2 } from 'lucide-react'
import type { Canette } from '../types'

type Props = {
  canettes: Canette[]
  surScanner: () => void
  surAjouter: () => void
  surOuvrir: (ean: string) => void
  surReglages: () => void
  surCodeManuel: (ean: string) => void
  toast: (m: string) => void
}

function estCeMois(iso: string) {
  const d = new Date(iso)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()
}

export default function Dashboard({
  canettes,
  surScanner,
  surAjouter,
  surOuvrir,
  surReglages,
  surCodeManuel,
  toast,
}: Props) {
  const [saisie, setSaisie] = useState('')

  const rayures = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => {
        const d = ((i * 37 + 11) % 10) + 1
        return { largeur: 1 + (d % 4), opacite: 0.3 + (d % 5) / 10 }
      }),
    [],
  )

  const stats = useMemo(() => {
    const total = canettes.reduce((n, c) => n + c.nb, 0)
    const references = canettes.length
    const variantes = new Set(canettes.map((c) => c.edition || '—')).size
    const ceMois = canettes.filter((c) => estCeMois(c.ajout)).length
    const palier = total === 0 ? 50 : Math.ceil((total + 1) / 50) * 50
    const progres = Math.min(100, Math.round((total / palier) * 100))
    return { total, references, variantes, ceMois, palier, progres }
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
      <span className="eyebrow">StackMonster · Collection</span>
      <h1 className="tb-titre">
        Ta collection
        <span>en un coup d'œil</span>
      </h1>

      <div className="stats-grille">
        <div className="stat-tuile accent">
          <b>{stats.total}</b>
          <span>Canettes</span>
        </div>
        <div className="stat-tuile">
          <b>{stats.references}</b>
          <span>Références</span>
        </div>
        <div className="stat-tuile">
          <b>{stats.variantes}</b>
          <span>Variantes</span>
        </div>
        <div className="stat-tuile">
          <b>+{stats.ceMois}</b>
          <span>Ce mois</span>
        </div>
      </div>

      <div className="palier">
        <div className="palier-tete">
          <span>Prochain palier</span>
          <span>{stats.total} / {stats.palier}</span>
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
        <button className="raccourci" onClick={surReglages}>
          <Settings2 size={22} />
          <span>Réglages</span>
        </button>
      </div>

      <div className="manuel">
        <input
          value={saisie}
          name="code-manuel"
          inputMode="numeric"
          placeholder="Code saisi à la main"
          aria-label="Code saisi à la main"
          onChange={(e) => setSaisie(e.target.value)}
        />
        <button
          onClick={() => {
            const v = saisie.trim()
            if (!v) return toast('Entre un code')
            setSaisie('')
            surCodeManuel(v)
          }}
        >
          OK
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
                {c.photo ? (
                  <img src={c.photo} alt="" />
                ) : (
                  <div className="ph-vide">
                    <ImageOff size={18} />
                  </div>
                )}
                <b>{c.nom || 'Sans nom'}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
