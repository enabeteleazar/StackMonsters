import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Search, WifiOff } from 'lucide-react'
import { api, NonAutorise } from '../api'
import { CATEGORIES } from '../categories'
import type { FicheWiki as Fiche } from '../types'
import { filtrerFiches } from '../wiki'
import FicheWiki from './FicheWiki'
import PhotoWiki from './PhotoWiki'

type Props = {
  surNonAutorise: () => void
}

/** Catalogue global : toutes les canettes répertoriées dans l'application, tous comptes confondus. */
export default function Wiki({ surNonAutorise }: Props) {
  const [fiches, setFiches] = useState<Fiche[] | null>(null)
  const [peutEditer, setPeutEditer] = useState(false)
  const [erreur, setErreur] = useState(false)
  const [q, setQ] = useState('')
  const [gamme, setGamme] = useState('')
  const [ouverte, setOuverte] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setErreur(false)
    try {
      const r = await api.wiki()
      setFiches(r.fiches)
      setPeutEditer(r.peut_editer)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreur(true)
    }
  }, [surNonAutorise])

  useEffect(() => {
    void charger()
  }, [charger])

  const vues = useMemo(() => filtrerFiches(fiches ?? [], q, gamme), [fiches, q, gamme])
  const fiche = ouverte ? (fiches?.find((f) => f.ean === ouverte) ?? null) : null
  const fermer = useCallback(() => setOuverte(null), [])

  return (
    <section>
      <span className="eyebrow">Wiki</span>

      {fiches && (
        <>
          <div className="stats">
            <div className="stat">
              <b>{fiches.length}</b>
              <span>Canettes répertoriées</span>
            </div>
          </div>

          <div className="filtres">
            <div className="recherche">
              <Search size={16} />
              <input
                value={q}
                name="recherche-wiki"
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher une canette"
                aria-label="Chercher dans le Wiki"
              />
            </div>
            <select
              value={gamme}
              name="gamme-wiki"
              onChange={(e) => setGamme(e.target.value)}
              aria-label="Filtrer par gamme"
            >
              <option value="">Toutes les gammes</option>
              {CATEGORIES.map((categorie) => (
                <option key={categorie} value={categorie}>{categorie}</option>
              ))}
            </select>
          </div>
        </>
      )}

      {fiches === null && !erreur && <p className="vide">Chargement du Wiki…</p>}

      {erreur && (
        <div className="vide">
          <WifiOff size={30} />
          Le Wiki a besoin de la connexion.
          <button className="btn btn-fantome" onClick={() => void charger()}>
            Réessayer
          </button>
        </div>
      )}

      {fiches &&
        (vues.length ? (
          <div className="grille-collection">
            {vues.map((f) => (
              <button key={f.ean} className="carte-canette carte-wiki" onClick={() => setOuverte(f.ean)}>
                <div className="carte-photo">
                  <PhotoWiki ean={f.ean} version={f.photo} />
                </div>
                <div className="carte-corps">
                  <span className="nom">{f.nom || 'Sans nom'}{f.edition ? ` - ${f.edition}` : ''}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="vide">
            <BookOpen size={30} />
            {fiches.length
              ? 'Aucune canette ne correspond à cette recherche.'
              : "Le Wiki est vide pour l'instant : il se remplit avec les canettes ajoutées à l'application."}
          </p>
        ))}

      {fiche && (
        <FicheWiki
          fiche={fiche}
          peutEditer={peutEditer}
          surFermeture={fermer}
          surNonAutorise={surNonAutorise}
          surEnregistree={(eanOriginal, maj) => {
            setFiches((liste) => liste?.map((f) => (f.ean === eanOriginal ? maj : f)) ?? liste)
            setOuverte(maj.ean)
          }}
          surSupprimee={(ean) => {
            setFiches((liste) => liste?.filter((f) => f.ean !== ean) ?? liste)
            fermer()
          }}
        />
      )}
    </section>
  )
}
