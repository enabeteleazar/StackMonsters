import { useEffect, useRef, useState } from 'react'
import { Loader2, ScanLine, X } from 'lucide-react'
import { normaliserCodeBarres } from '../codeBarres'
import { demarrerScanner, type Scanner } from '../scanner'

type Props = {
  surCode: (ean: string) => void
  surFermeture: () => void
  surErreur: (message: string) => void
}

export default function Camera({ surCode, surFermeture, surErreur }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const [indice, setIndice] = useState('Cadre le code-barres')
  const [indisponible, setIndisponible] = useState(false)
  const [saisie, setSaisie] = useState('')
  const codeManuel = normaliserCodeBarres(saisie.trim())

  useEffect(() => {
    let scanner: Scanner | null = null
    let vivant = true

    demarrerScanner({
      video: video.current!,
      surEtat: setIndice,
      surCode: (ean) => {
        if (!vivant) return
        navigator.vibrate?.(40)
        surCode(ean)
      },
      surErreur: (m) => {
        if (!vivant) return
        // L'écran reste ouvert : le code peut encore être saisi à la main.
        surErreur(m)
        setIndice(m)
        setIndisponible(true)
      },
    }).then((s) => {
      scanner = s
      if (!vivant) s.arreter()
    })

    return () => {
      vivant = false
      scanner?.arreter()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const preparation = indice.startsWith('Préparation')

  return (
    <div className="camera">
      <video ref={video} playsInline muted autoPlay />
      <div className="viseur">
        <div className="fenetre" />
        <div className="etat-scan">
          {preparation ? <Loader2 size={15} className="anim-tourne" /> : <ScanLine size={15} />}
          <p className="indice">{indice}</p>
        </div>
      </div>
      <form
        className="manuel camera-manuel"
        onSubmit={(e) => {
          e.preventDefault()
          if (codeManuel) surCode(codeManuel)
        }}
      >
        <input
          value={saisie}
          name="code-manuel"
          inputMode="numeric"
          placeholder={indisponible ? 'Saisir le code-barres' : 'Illisible ? Saisir le code'}
          aria-label="Code saisi à la main"
          onChange={(e) => setSaisie(e.target.value)}
        />
        <button type="submit" disabled={!codeManuel}>
          OK
        </button>
      </form>
      <button className="btn-icone fermer" onClick={surFermeture} aria-label="Fermer le scanner">
        <X size={20} />
      </button>
    </div>
  )
}
