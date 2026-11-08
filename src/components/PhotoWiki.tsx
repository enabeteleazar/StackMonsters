import { useEffect, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'
import { api } from '../api'

// URL locales déjà chargées (clé : EAN + version). Évite de retélécharger à chaque ouverture du Wiki.
const dejaChargees = new Map<string, string>()

type Props = {
  ean: string
  /** Marqueur de version renvoyé par /wiki ; null quand la fiche n'a pas de photo. */
  version: string | null
  taille?: number
  legende?: string
}

/**
 * Photo d'une fiche du Wiki. L'image n'est demandée que lorsque la vignette approche de l'écran :
 * le catalogue peut compter beaucoup de fiches, et la liste, elle, ne transporte aucune photo.
 */
export default function PhotoWiki({ ean, version, taille = 26, legende }: Props) {
  const cle = `${ean}:${version}`
  const [url, setUrl] = useState<string | null>(() => (version ? (dejaChargees.get(cle) ?? null) : null))
  const racine = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!version) {
      setUrl(null)
      return
    }
    const connue = dejaChargees.get(cle)
    if (connue) {
      setUrl(connue)
      return
    }
    setUrl(null)

    let actif = true
    const charger = () =>
      api
        .wikiPhoto(ean, version)
        .then((u) => {
          dejaChargees.set(cle, u)
          if (actif) setUrl(u)
        })
        .catch(() => {
          /* la vignette reste sur l'icône : une photo manquante ne doit rien bloquer */
        })

    const el = racine.current
    if (!el || !('IntersectionObserver' in window)) {
      void charger()
      return () => {
        actif = false
      }
    }
    const obs = new IntersectionObserver(
      (entrees) => {
        if (entrees.some((e) => e.isIntersecting)) {
          obs.disconnect()
          void charger()
        }
      },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => {
      actif = false
      obs.disconnect()
    }
  }, [ean, version, cle])

  return (
    <div ref={racine} className="photo-wiki">
      {url ? (
        <img src={url} alt="" />
      ) : (
        <div className="ph-vide">
          <ImageOff size={taille} />
          {legende && <span>{legende}</span>}
        </div>
      )}
    </div>
  )
}
