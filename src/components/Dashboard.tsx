import { useMemo } from 'react'
import { ArrowRight, PlusCircle, ScanLine } from 'lucide-react'
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

/** Accueil de l'appli connectée, dans l'univers de la page d'accueil publique. */
export default function Dashboard({ canettes, nomUtilisateur, surScanner, surAjouter, surOuvrir }: Props) {
  const stats = useMemo(() => {
    const references = canettes.length
    const ceMois = canettes.filter((c) => estCeMois(c.ajout)).length
    const palier = references === 0 ? 50 : Math.ceil((references + 1) / 50) * 50
    const progres = Math.min(100, Math.round((references / palier) * 100))
    return { references, ceMois, palier, progres }
  }, [canettes])

  // Dernière canette ajoutée : sa photo remplace l'image fixe de la canette.
  const derniere = useMemo(
    () => canettes.reduce<Canette | undefined>((d, c) => (!d || c.ajout > d.ajout ? c : d), undefined),
    [canettes],
  )

  return (
    <section className="accueil-co">
      <span className="accueil-co-lueur" aria-hidden="true" />

      <div className="accueil-co-hero">
        <div className="accueil-co-texte">
          <h1 className="accueil-co-titre">
            {nomUtilisateur ? `Salut ${nomUtilisateur},` : 'Salut,'}
            <span>
              voici ta collection <b>Monster.</b>
            </span>
          </h1>
          <span className="accueil-public-trait" aria-hidden="true" />

          <dl className="accueil-co-stats">
            <div className="accent">
              <dt>Références</dt>
              <dd>{stats.references}</dd>
            </div>
            <div>
              <dt>Ce mois</dt>
              <dd>+{stats.ceMois}</dd>
            </div>
          </dl>
        </div>

        {derniere?.photo_version ? (
          // Photo de la dernière canette ajoutée, sur la même fumée verte ; un appui ouvre sa fiche.
          <figure className="accueil-public-canette accueil-co-canette">
            <span className="accueil-public-fumee" aria-hidden="true" />
            <button
              className="accueil-co-derniere"
              onClick={() => surOuvrir(derniere.ean)}
              aria-label={`Dernière canette ajoutée : ${derniere.nom || 'sans nom'}`}
            >
              <PhotoWiki source="collection" ean={derniere.ean} version={derniere.photo_version} taille={30} />
            </button>
            <span className="accueil-public-sol" aria-hidden="true" />
          </figure>
        ) : (
          <figure className="accueil-public-canette accueil-co-canette" aria-hidden="true">
            <span className="accueil-public-fumee" />
            <span className="accueil-public-canette-cadre">
              <img src="/images/monster-mega-detouree.webp" alt="" width={200} height={579} />
            </span>
            <span className="accueil-public-sol" />
          </figure>
        )}
      </div>

      <div className="accueil-co-palier">
        <div className="accueil-co-palier-tete">
          <span>Prochain palier</span>
          <b>
            {stats.references} / {stats.palier}
          </b>
        </div>
        <div className="accueil-co-barre" role="progressbar" aria-valuemin={0} aria-valuemax={stats.palier} aria-valuenow={stats.references} aria-label="Prochain palier de références">
          <i style={{ width: `${stats.progres}%` }} />
        </div>
      </div>

      <div className="accueil-co-actions">
        <button className="accueil-public-cta" onClick={surScanner}>
          <ScanLine size={26} strokeWidth={2} />
          <span className="accueil-public-cta-separateur" aria-hidden="true" />
          Scan canette
          <ArrowRight size={24} />
        </button>
        <button className="accueil-co-secondaire" onClick={surAjouter}>
          <PlusCircle size={20} />
          Ajouter sans code-barres
        </button>
      </div>
    </section>
  )
}
