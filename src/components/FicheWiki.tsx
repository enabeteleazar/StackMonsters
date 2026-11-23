import { useEffect, useRef, useState } from 'react'
import { usePhotoEtirable } from '../etirement'
import { Ban, CheckCircle2, EyeOff, Flag, ImageOff, ImagePlus, SearchCheck, ShieldQuestion, Trash2, X } from 'lucide-react'
import { api, ErreurAPI, NonAutorise } from '../api'
import { CATEGORIES, libelleStatut, REGIONS, STATUTS } from '../categories'
import { ChampSaveur, ChampVariante, ChampVolume } from './ChampsFiche'
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
  const [rechercheOccupee, setRechercheOccupee] = useState(false)
  const [erreurRecherche, setErreurRecherche] = useState<string | null>(null)
  // Suppression refusée (canette encore dans une collection) : la fiche peut être masquée à la place.
  const [masquable, setMasquable] = useState(false)
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

  // Modération (propriétaire) : accepter ou refuser la fiche, avec un motif facultatif.
  const [motifRefus, setMotifRefus] = useState('')
  const [refusOuvert, setRefusOuvert] = useState(false)
  const moderer = async (decision: 'acceptee' | 'refusee') => {
    setSignalementOccupe(true)
    try {
      surEnregistree(fiche.ean, await api.wikiModerer(fiche.ean, decision, decision === 'refusee' ? motifRefus.trim() : ''))
      setRefusOuvert(false)
      setMotifRefus('')
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
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

  /** Échanges : noter la canette comme recherchée, ou ne plus la chercher. */
  const basculerRecherche = async () => {
    setRechercheOccupee(true)
    setErreurRecherche(null)
    try {
      surEnregistree(fiche.ean, await api.wikiChercher(fiche.ean, !fiche.je_cherche))
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurRecherche(
        e instanceof ErreurAPI && e.status === 409 ? 'Elle est déjà dans ta collection.' : 'Impossible pour le moment, réessaie avec le réseau.',
      )
    } finally {
      setRechercheOccupee(false)
    }
  }

  const supprimer = async () => {
    if (!confirm(`Supprimer la fiche « ${fiche.nom || fiche.ean} » du Wiki ? Ce n’est possible que si aucune collection ne la contient.`)) return
    setSuppressionOccupe(true)
    setErreurSuppression(null)
    setMasquable(false)
    try {
      await api.wikiSupprimer(fiche.ean)
      surSupprimee(fiche.ean)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else if (e instanceof ErreurAPI && e.status === 409) {
        setMasquable(true)
        setErreurSuppression(
          fiche.moderation === 'refusee'
            ? 'Suppression impossible : cette canette est dans au moins une collection. La fiche est déjà masquée du Wiki des membres.'
            : 'Suppression impossible : cette canette est dans au moins une collection. Tu peux la masquer du Wiki : les membres ne la verront plus, mais la gardent dans leur collection.',
        )
      } else setErreurSuppression(
        e instanceof ErreurAPI ? `Suppression refusée — ${e.detail}` : 'Suppression impossible, réessaie.',
      )
      setSuppressionOccupe(false)
    }
  }

  /** Masquer = refuser la fiche : elle disparaît du Wiki des membres ; « Accepter la fiche » la fait revenir. */
  const masquer = async () => {
    setSuppressionOccupe(true)
    try {
      surEnregistree(fiche.ean, await api.wikiModerer(fiche.ean, 'refusee', 'Masquée : encore dans une collection'))
      setMasquable(false)
      setErreurSuppression(null)
    } catch (e) {
      if (e instanceof NonAutorise) surNonAutorise()
      else setErreurSuppression('Masquage impossible, réessaie avec le réseau.')
    } finally {
      setSuppressionOccupe(false)
    }
  }

  // Photo étirable : tirer vers le bas en haut de la fiche l'agrandit et zoome dessus pendant le geste.
  const zoneFiche = useRef<HTMLDivElement>(null)
  const cadrePhoto = useRef<HTMLDivElement>(null)
  usePhotoEtirable(zoneFiche, cadrePhoto)

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (e.key === 'Escape') surFermeture()
    }
    window.addEventListener('keydown', touche)
    return () => window.removeEventListener('keydown', touche)
  }, [surFermeture])

  return (
    <div ref={zoneFiche} className="verdict fiche-wiki" role="dialog" aria-modal="true" aria-label={fiche.nom || 'Fiche de canette'}>
      <div ref={cadrePhoto} className="photo-hero photo-hero-plein photo-etirable">
        <PhotoWiki ean={fiche.ean} version={fiche.photo} taille={34} legende="Pas de photo" />
        {fiche.status === 'Nouveauté' && <span className="bandeau-nouveaute">Nouveauté</span>}
        {/* Même badge que la fiche de collection : la canette est dans la collection du compte. */}
        {fiche.je_possede && !edition && (
          <span className="badge badge-possede badge-etat">
            <CheckCircle2 size={13} /> Possédée
          </span>
        )}
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
            {/* La saveur seule, puis toutes les autres informations réunies dans un seul bloc compact. */}
            <div className="fiche-saveur">
              <span className="etiquette">Saveur</span>
              <b>{fiche.flavor || '—'}</b>
            </div>
            <div className="fiche-infos">
              <span className="etiquette">Informations</span>
              <dl>
                {(
                  [
                    ['Catégorie', fiche.categorie],
                    ['Pays', fiche.region],
                    ['Volume', fiche.volume],
                    ['Variante', fiche.variante],
                    ['Status', fiche.status],
                  ] as const
                ).map(([libelle, valeur]) => (
                  <div key={libelle}>
                    <dt>{libelle}</dt>
                    <dd>{valeur || '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Bloc Échanges : seulement « Je la cherche », sans aucun compteur. Absent quand la canette est déjà
                dans la collection, ou quand le partage des doublons est désactivé dans les Réglages. */}
            {fiche.partage_doubles !== false && !fiche.je_possede && (
              <div className="fiche-echanges" role="region" aria-label="Échanges">
                <span className="etiquette">Échanges</span>
                <button
                  className={`btn ${fiche.je_cherche ? 'btn-fantome' : 'btn-primaire'}`}
                  aria-pressed={!!fiche.je_cherche}
                  disabled={rechercheOccupee}
                  onClick={() => void basculerRecherche()}
                >
                  <SearchCheck size={18} />
                  {fiche.je_cherche ? 'Je ne la cherche plus' : 'Je la cherche'}
                </button>
                {erreurRecherche && <p className="sous" role="alert">{erreurRecherche}</p>}
              </div>
            )}

            {peutEditer && !!fiche.a_reprendre?.length && (
              <div className="fiche-moderation en_attente" role="status">
                <ShieldQuestion size={18} />
                <span>
                  Fiche d’avant la normalisation : {fiche.a_reprendre.join(', ')} à reprendre (« Modifier la fiche »).
                </span>
              </div>
            )}

            {peutEditer && fiche.moderation && fiche.moderation !== 'acceptee' && (
              <div className={`fiche-moderation ${fiche.moderation}`} role="status">
                {fiche.moderation === 'en_attente' ? <ShieldQuestion size={18} /> : <Ban size={18} />}
                <span>
                  {fiche.moderation === 'en_attente'
                    ? 'Fiche à vérifier : ajoutée par un membre, pas encore validée.'
                    : 'Fiche refusée ou masquée : elle n’apparaît plus dans le Wiki des membres. « Accepter la fiche » la fait revenir.'}
                </span>
              </div>
            )}

            {peutEditer && (
              <div className="fiche-moderer" role="region" aria-label="Modération">
                {fiche.moderation !== 'acceptee' && (
                  <button
                    className="btn btn-primaire actions-principal"
                    disabled={signalementOccupe}
                    onClick={() => void moderer('acceptee')}
                  >
                    <CheckCircle2 size={18} /> Accepter la fiche
                  </button>
                )}
                {fiche.moderation !== 'refusee' &&
                  (refusOuvert ? (
                    <div className="champs">
                      <div>
                        <label htmlFor="w-refus">Motif du refus (facultatif)</label>
                        <textarea
                          id="w-refus"
                          maxLength={500}
                          placeholder="Ex. : doublon de Mango Loco"
                          value={motifRefus}
                          onChange={(e) => setMotifRefus(e.target.value)}
                        />
                      </div>
                      <button className="btn btn-fantome btn-danger" disabled={signalementOccupe} onClick={() => void moderer('refusee')}>
                        <Ban size={17} /> Confirmer le refus
                      </button>
                      <button className="btn btn-fantome" onClick={() => setRefusOuvert(false)}>
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button className="btn btn-fantome btn-danger" onClick={() => setRefusOuvert(true)}>
                      <Ban size={17} /> Refuser la fiche
                    </button>
                  ))}
                {!!fiche.moderations?.length && (
                  <ul className="fiche-historique" aria-label="Historique de modération">
                    {fiche.moderations.map((m, i) => (
                      <li key={i}>
                        <small>{dateCourte(m.cree)}</small> {m.decision === 'acceptee' ? 'Acceptée' : 'Refusée'}
                        {m.motif && ` — ${m.motif}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

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

            {/* Description masquée dans la fiche du Wiki ; elle reste modifiable par le propriétaire (« Modifier la fiche »). */}

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
                {masquable && fiche.moderation !== 'refusee' && (
                  <button className="btn btn-fantome btn-danger" disabled={suppressionOccupe} onClick={() => void masquer()}>
                    <EyeOff size={17} />
                    Masquer du Wiki
                  </button>
                )}
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
    variante: fiche.variante ?? '',
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
          <ChampVolume id="w-volume" valeur={f.volume} surChange={(v) => champ('volume', v)} />
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
          <ChampSaveur id="w-flavor" valeur={f.flavor} surChange={(v) => champ('flavor', v)} />
        </div>
        <div>
          <label htmlFor="w-variante">Variante</label>
          <ChampVariante id="w-variante" valeur={f.variante} surChange={(v) => champ('variante', v)} />
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
