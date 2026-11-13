import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Flag, ImageOff, ImagePlus, Trash2, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import { CATEGORIES, libelleStatut, REGIONS, STATUTS } from '../categories'
import { reduirePhoto } from '../photo'
import type { FicheWiki as Fiche, ModifFicheWiki } from '../types'
import PhotoWiki from './PhotoWiki'

/** Libellé de la provenance (anonyme) d'une fiche, pour le propriétaire. */
const SOURCES: Record<string, string> = {
  'code-barres': 'ajout par code-barres',
  'sans-code': 'ajout sans code-barres',
  migration: 'reprise d’une collection existante',
  restauration: 'restauration d’une sauvegarde',
}
const dateCourte = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '')

type Props = {
  fiche: Fiche
  peutEditer: boolean
  surFermeture: () => void
  surEnregistree: (eanOriginal: string, f: Fiche) => void
  surSupprimee: (ean: string) => void
  surNonAutorise: () => void
}

export default function FicheWiki({
  fiche,
  peutEditer,
  surFermeture,
  surEnregistree,
  surSupprimee,
  surNonAutorise,
}: Props) {
  const [edition, setEdition] = useState(false)
  const [suppressionOccupe, setSuppressionOccupe] = useState(false)
  const [erreurSuppression, setErreurSuppression] = useState<string | null>(null)
  const [codeOccupe, setCodeOccupe] = useState(false)
  const [photoOccupee, setPhotoOccupee] = useState(false)
  const [erreurPhoto, setErreurPhoto] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  // Signalement d'une erreur (tous les comptes) et traitement des signalements (propriétaire).
  const [signalementOuvert, setSignalementOuvert] = useState(false)
  const [motif, setMotif] = useState('')
  const [etatSignalement, setEtatSignalement] = useState<{ ok: boolean; texte: string } | null>(null)
  const [signalementOccupe, setSignalementOccupe] = useState(false)

  const signaler = async () => {
    setSignalementOccupe(true)
    setEtatSignalement(null)
    try {
      await api.wikiSignaler(fiche.ean, motif.trim())
      setSignalementOuvert(false)
      setMotif('')
      setEtatSignalement({ ok: true, texte: 'Merci : ton signalement a été transmis.' })
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setEtatSignalement({
        ok: false,
        texte: e instanceof ErreurAPI && e.status === 429
          ? 'Trop de signalements pour le moment, réessaie plus tard.'
          : 'Signalement non envoyé, réessaie.',
      })
    } finally {
      setSignalementOccupe(false)
    }
  }

  const traiter = async (id: number) => {
    setSignalementOccupe(true)
    try {
      surEnregistree(fiche.ean, await api.wikiSignalementTraite(id))
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
    } finally {
      setSignalementOccupe(false)
    }
  }

  const changerPhoto = async (action: () => Promise<Fiche>) => {
    setPhotoOccupee(true)
    setErreurPhoto(null)
    try {
      surEnregistree(fiche.ean, await action())
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurPhoto(e instanceof ErreurAPI ? `Photo non modifiée — ${e.detail}` : 'Photo non modifiée, réessaie.')
    } finally {
      setPhotoOccupee(false)
    }
  }

  const retirerCode = async (code: string) => {
    if (!confirm(`Retirer le code-barres ${code} de cette fiche ?`)) return
    setCodeOccupe(true)
    setErreurPhoto(null)
    try {
      surEnregistree(fiche.ean, await api.wikiRetirerCode(fiche.ean, code))
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurPhoto(e instanceof ErreurAPI ? `Code non retiré — ${e.detail}` : 'Code non retiré, réessaie.')
    } finally {
      setCodeOccupe(false)
    }
  }

  const supprimer = async () => {
    if (!confirm(`Supprimer la fiche « ${fiche.nom || fiche.ean} » du Wiki ? Ce n’est possible que si aucune collection ne la contient.`)) return
    setSuppressionOccupe(true)
    setErreurSuppression(null)
    try {
      await api.wikiSupprimer(fiche.ean)
      surSupprimee(fiche.ean)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurSuppression(
        e instanceof ErreurAPI ? `Suppression refusée — ${e.detail}` : 'Suppression impossible, réessaie.',
      )
      setSuppressionOccupe(false)
    }
  }

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermeture()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [surFermeture])

  return (
    <div className="verdict" role="dialog" aria-modal="true" aria-label={fiche.nom || 'Fiche de canette'}>
      <div className="photo-hero photo-hero-plein">
        <PhotoWiki ean={fiche.ean} version={fiche.photo} taille={34} legende="Pas de photo" />
        {fiche.status === 'Nouveauté' && <span className="bandeau-nouveaute">Nouveauté</span>}
        <button className="btn-icone fermer" onClick={surFermeture} aria-label="Fermer">
          <X size={20} />
        </button>
      </div>

      <div className="verdict-scroll">
        <div className="bandeau-info">
          {/* Codes-barres réservés au propriétaire : les autres comptes ne voient que la fiche. */}
          {peutEditer && <div className="ean">{fiche.ean}</div>}
          <h2>{fiche.nom || 'Sans nom'}</h2>
          {peutEditer && fiche.provenance && (
            <p className="fiche-provenance">
              {fiche.provenance.cree ? `Créée le ${dateCourte(fiche.provenance.cree)}` : 'Créée'} —{' '}
              {SOURCES[fiche.provenance.source] ?? 'avant le suivi de la provenance'}
              {fiche.provenance.corrigee && ` · corrigée le ${dateCourte(fiche.provenance.corrigee)}`}
            </p>
          )}
          {peutEditer && fiche.codes.length > 0 && (
            <div className="autres-codes">
              <span>Autres codes-barres</span>
              {fiche.codes.map((code) => (
                <span key={code} className="autre-code">
                  {code}
                  <button disabled={codeOccupe} onClick={() => void retirerCode(code)} aria-label={`Retirer le code ${code}`}>
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {edition ? (
          <Formulaire
            fiche={fiche}
            surAnnuler={() => setEdition(false)}
            surEnregistree={(f) => {
              surEnregistree(fiche.ean, f)
              setEdition(false)
            }}
            surNonAutorise={surNonAutorise}
          />
        ) : (
          <>
            {/* Même ordre que la fiche de collection (sans État ni Quantité, propres à chaque collection). */}
            <div className="meta-grille">
              <div className="meta-item meta-item-large">
                <span>Saveur</span>
                <b>{fiche.flavor || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Catégorie</span>
                <b>{fiche.categorie || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Pays</span>
                <b>{fiche.region || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Volume</span>
                <b>{fiche.volume || '—'}</b>
              </div>
              <div className="meta-item">
                <span>Status</span>
                <b>{fiche.status || '—'}</b>
              </div>
            </div>

            {peutEditer && !!fiche.signalements?.length && (
              <div className="fiche-signalements" role="region" aria-label="Erreurs signalées">
                <span className="etiquette">
                  <Flag size={14} /> Erreurs signalées ({fiche.signalements.length})
                </span>
                {fiche.signalements.map((s) => (
                  <div className="fiche-signalement" key={s.id}>
                    <p>
                      <small>{dateCourte(s.cree)}</small> {s.motif}
                    </p>
                    <button className="btn btn-fantome" disabled={signalementOccupe} onClick={() => void traiter(s.id)}>
                      <CheckCircle2 size={16} /> Marquer comme traité
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="fiche-description">
              <span className="etiquette">Description</span>
              {fiche.description ? (
                <p>{fiche.description}</p>
              ) : (
                <p className="fiche-description-vide">Pas encore de description pour cette canette.</p>
              )}
            </div>

            {peutEditer && (
              <div className="actions">
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  aria-label="Choisir la photo de la fiche"
                  hidden
                  onChange={(e) => {
                    const input = e.currentTarget
                    const fichier = input.files?.[0]
                    input.value = ''
                    if (fichier) {
                      void changerPhoto(async () => api.wikiPhotoRemplacer(fiche.ean, await reduirePhoto(fichier)))
                    }
                  }}
                />
                <button
                  className="btn btn-fantome"
                  disabled={photoOccupee || suppressionOccupe}
                  onClick={() => photoInput.current?.click()}
                >
                  <ImagePlus size={17} />
                  {fiche.photo ? 'Remplacer la photo' : 'Ajouter une photo'}
                </button>
                {fiche.photo && (
                  <button
                    className="btn btn-fantome"
                    disabled={photoOccupee || suppressionOccupe}
                    onClick={() => {
                      if (confirm('Retirer la photo de cette fiche ?')) void changerPhoto(() => api.wikiPhotoRetirer(fiche.ean))
                    }}
                  >
                    <ImageOff size={17} />
                    Retirer la photo
                  </button>
                )}
                {erreurPhoto && <p className="sous" role="alert">{erreurPhoto}</p>}
                <button className="btn btn-fantome" disabled={suppressionOccupe} onClick={() => setEdition(true)}>
                  Modifier la fiche
                </button>
                <button
                  className="btn btn-fantome btn-danger"
                  disabled={suppressionOccupe}
                  onClick={() => void supprimer()}
                >
                  <Trash2 size={17} />
                  {suppressionOccupe ? 'Suppression…' : 'Supprimer la fiche du Wiki'}
                </button>
                {erreurSuppression && <p className="sous" role="alert">{erreurSuppression}</p>}
              </div>
            )}

            {!peutEditer && (
              <div className="actions fiche-signaler">
                {signalementOuvert ? (
                  <div className="champs">
                    <div>
                      <label htmlFor="w-signalement">Quelle erreur as-tu repérée ?</label>
                      <textarea
                        id="w-signalement"
                        maxLength={500}
                        placeholder="Ex. : le volume est 355 ml, pas 500 ml."
                        value={motif}
                        onChange={(e) => setMotif(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn-primaire actions-principal"
                      disabled={signalementOccupe || motif.trim().length < 3}
                      onClick={() => void signaler()}
                    >
                      {signalementOccupe ? 'Envoi…' : 'Envoyer le signalement'}
                    </button>
                    <button className="btn btn-fantome" onClick={() => setSignalementOuvert(false)}>
                      Annuler
                    </button>
                  </div>
                ) : (
                  <button className="btn btn-fantome" onClick={() => { setSignalementOuvert(true); setEtatSignalement(null) }}>
                    <Flag size={17} /> Signaler une erreur
                  </button>
                )}
                {etatSignalement && (
                  <p className={etatSignalement.ok ? 'sous' : 'sous fiche-alerte'} role="status">
                    {etatSignalement.texte}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Formulaire({
  fiche,
  surAnnuler,
  surEnregistree,
  surNonAutorise,
}: {
  fiche: Fiche
  surAnnuler: () => void
  surEnregistree: (f: Fiche) => void
  surNonAutorise: () => void
}) {
  const [f, setF] = useState<ModifFicheWiki>({
    ean: fiche.ean,
    nom: fiche.nom,
    volume: fiche.volume,
    categorie: fiche.categorie,
    flavor: fiche.flavor,
    status: fiche.status,
    region: fiche.region,
    description: fiche.description,
  })
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const champ = <K extends keyof ModifFicheWiki>(k: K, v: ModifFicheWiki[K]) => setF((p) => ({ ...p, [k]: v }))

  const valider = async () => {
    setOccupe(true)
    setErreur(null)
    try {
      surEnregistree(await api.wikiModifier(fiche.ean, f))
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreur(e instanceof ErreurAPI ? `Enregistrement refusé — ${e.detail}` : 'Enregistrement impossible, réessaie.')
      setOccupe(false)
    }
  }

  return (
    <>
      <div className="champs">
        <div>
          <label htmlFor="w-ean">Code-barres</label>
          <input
            id="w-ean"
            value={f.ean}
            maxLength={64}
            required
            onChange={(e) => champ('ean', e.target.value.trim())}
          />
        </div>
        <div>
          <label htmlFor="w-nom">Nom</label>
          <input id="w-nom" value={f.nom} maxLength={200} onChange={(e) => champ('nom', e.target.value)} />
        </div>
        <div>
          <label htmlFor="w-volume">Volume</label>
          <input
            id="w-volume"
            value={f.volume}
            maxLength={40}
            placeholder="500 ml"
            onChange={(e) => champ('volume', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="w-categorie">Catégorie</label>
          <select
            id="w-categorie"
            value={f.categorie}
            onChange={(e) => champ('categorie', e.target.value)}
          >
            <option value="">Non renseignée</option>
            {CATEGORIES.map((categorie) => (
              <option key={categorie} value={categorie}>{categorie}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="w-flavor">Saveur</label>
          <input
            id="w-flavor"
            value={f.flavor}
            maxLength={200}
            onChange={(e) => champ('flavor', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="w-status">Status</label>
          <select
            id="w-status"
            value={f.status}
            onChange={(e) => champ('status', e.target.value)}
          >
            <option value="">Non renseigné</option>
            {STATUTS.map((status) => (
              <option key={status} value={status}>{libelleStatut(status)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="w-region">Pays</label>
          <select
            id="w-region"
            value={f.region}
            onChange={(e) => champ('region', e.target.value)}
          >
            <option value="">Non renseignée</option>
            {REGIONS.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="w-description">Description</label>
          <textarea
            id="w-description"
            rows={7}
            value={f.description}
            maxLength={4000}
            onChange={(e) => champ('description', e.target.value)}
          />
        </div>
      </div>
      {erreur && (
        <p className="sous" role="alert">
          {erreur}
        </p>
      )}
      <div className="actions">
        <button className="btn btn-primaire actions-principal" disabled={occupe} onClick={valider}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button className="btn btn-fantome" disabled={occupe} onClick={surAnnuler}>
          Annuler
        </button>
      </div>
    </>
  )
}
