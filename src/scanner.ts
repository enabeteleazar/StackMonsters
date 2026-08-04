import { LECTURES_CONFIRMATION } from './config'

/**
 * Lecture de code-barres avec deux moteurs :
 *  - BarcodeDetector natif quand le navigateur le fournit (Chrome Android) ;
 *  - ZXing sinon (iOS Safari, Firefox), importé en morceau séparé et servi
 *    par Homebox — aucun CDN, donc rien à charger depuis l'extérieur.
 *
 * Un code n'est validé qu'après LECTURES_CONFIRMATION lectures identiques :
 * ZXing se trompe parfois d'un chiffre sur une canette bombée, et une fiche
 * fausse pollue la collection durablement.
 */

const FORMATS_NATIFS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

export type Scanner = { arreter: () => void }

type Options = {
  video: HTMLVideoElement
  surCode: (ean: string) => void
  surEtat: (message: string) => void
  surErreur: (message: string) => void
}

export const moteurNatif = () => 'BarcodeDetector' in window

function confirmateur(surCode: (ean: string) => void) {
  let dernier: string | null = null
  let compte = 0
  return (ean: string) => {
    if (ean !== dernier) {
      dernier = ean
      compte = 1
      return false
    }
    compte += 1
    if (compte < LECTURES_CONFIRMATION) return false
    surCode(ean)
    return true
  }
}

export async function demarrerScanner(o: Options): Promise<Scanner> {
  if (!navigator.mediaDevices?.getUserMedia) {
    o.surErreur('Caméra indisponible sur ce navigateur')
    return { arreter: () => {} }
  }
  if (!window.isSecureContext) {
    o.surErreur('La caméra exige une adresse https://')
    return { arreter: () => {} }
  }
  return moteurNatif() ? scannerNatif(o) : scannerZXing(o)
}

async function scannerNatif(o: Options): Promise<Scanner> {
  let flux: MediaStream | null = null
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false,
    })
  } catch {
    o.surErreur('Accès caméra refusé')
    return { arreter: () => {} }
  }
  o.video.srcObject = flux
  await o.video.play().catch(() => {})

  // @ts-expect-error API non typée dans lib.dom
  const detecteur = new window.BarcodeDetector({ formats: FORMATS_NATIFS })
  const confirmer = confirmateur(o.surCode)
  let actif = true
  let minuteur: number | undefined

  const scruter = async () => {
    if (!actif) return
    try {
      const codes = await detecteur.detect(o.video)
      if (codes.length) {
        o.surEtat('Ne bouge plus…')
        if (confirmer(codes[0].rawValue)) return
      }
    } catch {
      /* image ignorée */
    }
    minuteur = window.setTimeout(scruter, 220)
  }
  scruter()

  return {
    arreter: () => {
      actif = false
      window.clearTimeout(minuteur)
      flux?.getTracks().forEach((t) => t.stop())
      o.video.srcObject = null
    },
  }
}

async function scannerZXing(o: Options): Promise<Scanner> {
  o.surEtat('Préparation du lecteur…')
  const ZX = await import('@zxing/library')
  const hints = new Map()
  hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, [
    ZX.BarcodeFormat.EAN_13,
    ZX.BarcodeFormat.EAN_8,
    ZX.BarcodeFormat.UPC_A,
    ZX.BarcodeFormat.UPC_E,
  ])
  hints.set(ZX.DecodeHintType.TRY_HARDER, true)

  const lecteur = new ZX.BrowserMultiFormatReader(hints, 180)
  const confirmer = confirmateur(o.surCode)
  o.surEtat('Cadre le code-barres')

  try {
    await lecteur.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } } },
      o.video,
      (res) => {
        if (!res) return
        o.surEtat('Ne bouge plus…')
        confirmer(res.getText())
      },
    )
  } catch {
    o.surErreur('Accès caméra refusé')
  }

  return {
    arreter: () => {
      try {
        lecteur.reset()
      } catch {
        /* déjà arrêté */
      }
    },
  }
}
