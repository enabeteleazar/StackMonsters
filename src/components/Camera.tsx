import { useEffect, useRef, useState } from 'react'
import { Loader2, ScanLine, X } from 'lucide-react'
import { demarrerScanner, type Scanner } from '../scanner'

type Props = {
  surCode: (ean: string) => void
  surFermeture: () => void
  surErreur: (message: string) => void
}

export default function Camera({ surCode, surFermeture, surErreur }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const [indice, setIndice] = useState('Cadre le code-barres')

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
        surErreur(m)
        surFermeture()
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
      <button className="btn-icone fermer" onClick={surFermeture} aria-label="Fermer le scanner">
        <X size={20} />
      </button>
    </div>
  )
}
