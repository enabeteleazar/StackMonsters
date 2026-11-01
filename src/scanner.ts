import { LECTURES_CONFIRMATION } from './config'

/**
 * Lecture de code-barres, un seul chemin de code.
 *
 * Le navigateur fournit BarcodeDetector (Chrome Android) : on l'utilise.
 * Sinon (iOS Safari, Firefox) on charge un polyfill fondé sur zxing-wasm,
 * c'est-à-dire ZXing compilé depuis le C++ vers WebAssembly — nettement
 * plus rapide et plus tolérant que l'ancienne implémentation JavaScript,
 * ce qui compte sur une canette, dont le code-barres est courbé.
 *
 * Le fichier .wasm est servi par le site lui-même, jamais par un CDN.
 */

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

export type Scanner = { arreter: () => void }

type Options = {
  video: HTMLVideoElement
  surCode: (ean: string) => void
  surEtat: (message: string) => void
  surErreur: (message: string) => void
}

export const moteurNatif = () => 'BarcodeDetector' in window

type Detecteur = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }

async function construireDetecteur(): Promise<Detecteur> {
  if (moteurNatif()) {
    // @ts-expect-error API non typée dans lib.dom
    return new window.BarcodeDetector({ formats: FORMATS })
  }
  const polyfill = await import('barcode-detector/pure')
  const wasm = await import('../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm?url')
  polyfill.setZXingModuleOverrides({
    locateFile: (chemin: string, prefixe: string) =>
      chemin.endsWith('.wasm') ? wasm.default : prefixe + chemin,
  })
  return new polyfill.BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detecteur
}

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

  let flux: MediaStream | null = null
  try {
    flux = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      audio: false,
    })
  } catch {
    o.surErreur('Accès caméra refusé')
    return { arreter: () => {} }
  }

  o.video.srcObject = flux
  await o.video.play().catch(() => {})

  o.surEtat(moteurNatif() ? 'Cadre le code-barres' : 'Préparation du lecteur…')
  let detecteur: Detecteur
  try {
    detecteur = await construireDetecteur()
  } catch (e) {
    flux.getTracks().forEach((t) => t.stop())
    o.surErreur(`Lecteur indisponible — ${(e as Error).message}`)
    return { arreter: () => {} }
  }
  o.surEtat('Cadre le code-barres')

  const confirmer = confirmateur(o.surCode)
  const debut = Date.now()
  let actif = true
  let minuteur: number | undefined
  let conseille = false

  const scruter = async () => {
    if (!actif) return
    try {
      const codes = await detecteur.detect(o.video)
      if (codes.length) {
        o.surEtat('Ne bouge plus…')
        if (confirmer(codes[0].rawValue)) return
      } else if (!conseille && Date.now() - debut > 8000) {
        conseille = true
        o.surEtat('Éloigne un peu, et aplatis le code face à toi')
      }
    } catch {
      /* image ignorée */
    }
    minuteur = window.setTimeout(scruter, 120)
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
