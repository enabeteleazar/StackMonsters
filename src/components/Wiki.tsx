import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Search, WifiOff } from 'lucide-react'
import { api, NonAutorise } from '../api'
import { CATEGORIES } from '../categories'
import { estCodeInterne, normaliserCodeBarres } from '../codeBarres'
import type { FicheWiki as Fiche } from '../types'
import { filtrerFiches } from '../wiki'
import FicheWiki from './FicheWiki'
import PhotoWiki from './PhotoWiki'

type Props = {
  surNonAutorise: () => void
}

type TypeCode = 'reel' | 'genere' | 'autre'

const LIBELLES_CODE: Record<TypeCode, string> = {
  reel: 'Code-barres réel',
  genere: 'Code-barres généré',
  autre: 'Autre texte',
}

/** Vert : vrai code-barres ; orange : code interne « 20… » tiré du nom ; rouge : tout autre texte. */
function typeCode(ean: string): TypeCode {
  if (estCodeInterne(ean)) return 'genere'
  return normaliserCodeBarres(ean) ? 'reel' : 'autre'
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
    <section className="collec wiki">
      <span className="lueur-page" aria-hidden="true" />

      <div className="collec-contenu wiki-contenu">
        <div className="collec-tete">
          <h1 className="collec-titre">
            Le Wiki <b>Monster.</b>
          </h1>
          {fiches && (
            <p className="collec-compte">
              <b>{fiches.length}</b> Canettes répertoriées
            </p>
          )}
        </div>
        <span className="accueil-public-trait" aria-hidden="true" />

        {fiches && (
          <>
            <label className="collec-recherche wiki-recherche">
              <Search size={18} />
              <input
                value={q}
                name="recherche-wiki"
                type="search"
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher une canette"
                aria-label="Chercher dans le Wiki"
              />
            </label>
            <div className="wiki-gammes" role="radiogroup" aria-label="Filtrer par gamme">
              {['', ...CATEGORIES].map((categorie) => (
                <button
                  key={categorie || 'toutes'}
                  role="radio"
                  aria-checked={gamme === categorie}
                  onClick={() => setGamme(categorie)}
                >
                  {categorie || 'Toutes'}
                </button>
              ))}
            </div>
          </>
        )}

        {fiches === null && !erreur && <p className="collec-vide">Chargement du Wiki…</p>}

        {erreur && (
          <div className="collec-vide">
            <WifiOff size={34} />
            Le Wiki a besoin de la connexion.
            <button className="accueil-co-secondaire wiki-reessayer" onClick={() => void charger()}>
              Réessayer
            </button>
          </div>
        )}

        {fiches &&
          (vues.length ? (
            <>
              <p className="legende-codes" aria-hidden="true">
                {(['reel', 'genere', 'autre'] as const).map((t) => (
                  <span key={t}>
                    <span className={`point-code point-code-${t}`} />
                    {LIBELLES_CODE[t]}
                  </span>
                ))}
              </p>
              <div className="wiki-grille">
                {vues.map((f) => (
                  <button key={f.ean} className="carte-wiki wiki-carte" onClick={() => setOuverte(f.ean)}>
                    <span className="wiki-photo">
                      <PhotoWiki ean={f.ean} version={f.photo} />
                      {f.status === 'Nouveauté' && <span className="bandeau-nouveaute">Nouveauté</span>}
                      <span
                        className={`point-code point-code-${typeCode(f.ean)}`}
                        title={LIBELLES_CODE[typeCode(f.ean)]}
                        role="img"
                        aria-label={LIBELLES_CODE[typeCode(f.ean)]}
                      />
                    </span>
                    <span className="wiki-nom">{f.nom || 'Sans nom'}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="collec-vide">
              <BookOpen size={34} />
              {fiches.length
                ? 'Aucune canette ne correspond à cette recherche.'
                : "Le Wiki est vide pour l'instant : il se remplit avec les canettes ajoutées à l'application."}
            </p>
          ))}
      </div>

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
