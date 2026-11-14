import { useEffect, useState } from 'react'
import { BookOpen, Camera as CameraIcon, CheckCircle2, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import { CATEGORIES, categorieDuNom, REGIONS } from '../categories'
import { normaliserCodeBarres } from '../codeBarres'
import { reduirePhoto } from '../photo'
import type { FicheWiki, PropositionWiki as Proposition } from '../types'

type Props = {
  /** Vrai pour le propriétaire : sa proposition est acceptée d'emblée. */
  proprietaire: boolean
  surFermeture: () => void
  surProposee: (fiche: FicheWiki) => void
  surNonAutorise: () => void
}

const VIDE: Proposition = { ean: '', nom: '', volume: '', categorie: '', flavor: '', region: '', photo: null }

/**
 * Proposer une canette au catalogue partagé, sans l'ajouter à sa collection. La fiche reste « à vérifier »
 * jusqu'à la décision du propriétaire. Les fiches au nom proche sont montrées avant l'envoi (doublons).
 */
export default function PropositionWiki({ proprietaire, surFermeture, surProposee, surNonAutorise }: Props) {
  const [p, setP] = useState<Proposition>(VIDE)
  const [categorieChoisie, setCategorieChoisie] = useState(false)
  const [proches, setProches] = useState<string[]>([])
  const [doublon, setDoublon] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [envoyee, setEnvoyee] = useState<FicheWiki | null>(null)
  const champ = <K extends keyof Proposition>(k: K, v: Proposition[K]) => setP((avant) => ({ ...avant, [k]: v }))

  // Fiches déjà présentes au nom proche : montrées pendant la saisie pour éviter un doublon.
  useEffect(() => {
    const nom = p.nom.trim()
    if (nom.length < 3) {
      setProches([])
      return
    }
    const t = window.setTimeout(() => {
      // Résultats de la recherche, ou à défaut les noms proches (« Mango Loko » → « Mango Loco »).
      api
        .wikiRecherche({ q: nom })
        .then((r) => setProches(r.fiches.length ? r.fiches.slice(0, 3).map((f) => f.nom || 'Sans nom') : r.suggestions))
        .catch(() => setProches([]))
    }, 300)
    return () => window.clearTimeout(t)
  }, [p.nom])

  useEffect(() => {
    const touche = (e: KeyboardEvent) => e.key === 'Escape' && surFermeture()
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [surFermeture])

  const codeInvalide = !!p.ean.trim() && normaliserCodeBarres(p.ean.trim()) === null

  const envoyer = async (confirmer = false) => {
    setOccupe(true)
    setErreur(null)
    try {
      const fiche = await api.wikiProposer({ ...p, ean: p.ean.trim(), confirmer_doublon: confirmer })
      setEnvoyee(fiche)
      surProposee(fiche)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else if (e instanceof ErreurAPI && e.status === 409 && e.detail.startsWith('doublon probable')) {
        setDoublon(e.detail.replace(/^doublon probable\s*:\s*/, ''))
      } else setErreur(e instanceof ErreurAPI ? e.detail : 'Proposition non envoyée, réessaie.')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="verdict verdict-sans-photo" role="dialog" aria-modal="true" aria-label="Proposer une canette">
      <button className="btn-icone fermer" onClick={surFermeture} aria-label="Fermer">
        <X size={20} />
      </button>
      <div className="verdict-scroll">
        <div className="bandeau-info">
          <h2>Proposer une canette</h2>
          <p>
            {proprietaire
              ? 'Elle sera ajoutée au Wiki tout de suite.'
              : 'Elle apparaîtra dans le Wiki « à vérifier » jusqu\u2019à sa validation. Elle n\u2019est pas ajoutée à ta collection.'}
          </p>
        </div>

        {envoyee ? (
          <div className="proposition-envoyee">
            <CheckCircle2 size={40} />
            <p>
              Merci{'\u00a0'}! <b>{envoyee.nom}</b>{' '}
              {envoyee.moderation === 'acceptee' ? 'est dans le Wiki.' : 'sera vérifiée avant d\u2019être validée.'}
            </p>
            <button className="btn btn-primaire actions-principal" onClick={surFermeture}>
              Retour au Wiki
            </button>
          </div>
        ) : (
          <>
            <div className="champs">
              <div>
                <label htmlFor="p-nom">Nom</label>
                <input
                  id="p-nom"
                  maxLength={200}
                  placeholder="Monster Mango Loco"
                  value={p.nom}
                  onChange={(e) => {
                    const nom = e.target.value
                    champ('nom', nom)
                    setDoublon(null)
                    if (!categorieChoisie) champ('categorie', categorieDuNom(nom))
                  }}
                />
              </div>
              {proches.length > 0 && (
                <div className="suggestions-wiki" aria-live="polite">
                  <div className="suggestions-wiki-titre">
                    <BookOpen size={17} /> Déjà dans le Wiki{'\u00a0'}?
                  </div>
                  <p className="suggestions-wiki-etat">
                    Vérifie qu’il ne s’agit pas de l’une de ces canettes avant de proposer la tienne.
                  </p>
                  <ul className="proposition-proches">
                    {proches.map((nom) => (
                      <li key={nom}>{nom}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <label htmlFor="p-ean">Code-barres (facultatif)</label>
                <input
                  id="p-ean"
                  inputMode="numeric"
                  maxLength={64}
                  placeholder="EAN à 8 ou 13 chiffres"
                  value={p.ean}
                  onChange={(e) => champ('ean', e.target.value)}
                />
              </div>
              <div className="duo">
                <div>
                  <label htmlFor="p-categorie">Catégorie</label>
                  <select
                    id="p-categorie"
                    value={p.categorie}
                    onChange={(e) => {
                      setCategorieChoisie(true)
                      champ('categorie', e.target.value)
                    }}
                  >
                    <option value="">Non renseignée</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="p-region">Pays</label>
                  <select id="p-region" value={p.region} onChange={(e) => champ('region', e.target.value)}>
                    <option value="">Non renseigné</option>
                    {REGIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="p-saveur">Saveur</label>
                <input id="p-saveur" maxLength={200} value={p.flavor} onChange={(e) => champ('flavor', e.target.value)} />
              </div>
              <div>
                <label htmlFor="p-volume">Volume</label>
                <input id="p-volume" maxLength={40} placeholder="500 ml" value={p.volume} onChange={(e) => champ('volume', e.target.value)} />
              </div>
              <div className="photo-zone">
                <CameraIcon size={22} />
                Photo (facultatif)
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Photo de la canette proposée"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (f) champ('photo', await reduirePhoto(f))
                  }}
                />
                {p.photo && <img src={p.photo} alt="" />}
              </div>
            </div>

            {codeInvalide && (
              <p className="suggestions-wiki-erreur" role="alert">
                Code-barres invalide{'\u00a0'}: il doit compter 8, 12 ou 13 chiffres, clé de contrôle comprise.
              </p>
            )}
            {erreur && <p className="suggestions-wiki-erreur" role="alert">{erreur}</p>}
            {doublon && (
              <div className="suggestions-wiki proposition-doublon" role="alert">
                <p className="suggestions-wiki-etat">
                  Une canette très proche existe déjà{'\u00a0'}: <b>{doublon}</b>. Si la tienne est bien différente,
                  confirme l’envoi.
                </p>
                <button className="btn btn-fantome" disabled={occupe} onClick={() => void envoyer(true)}>
                  C’est une autre canette, proposer quand même
                </button>
              </div>
            )}

            <div className="actions">
              <button
                className="btn btn-primaire actions-principal"
                disabled={occupe || !p.nom.trim() || codeInvalide || !!doublon}
                onClick={() => void envoyer()}
              >
                {occupe ? 'Envoi…' : 'Proposer'}
              </button>
              <button className="btn btn-fantome" onClick={surFermeture}>
                Annuler
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
