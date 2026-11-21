import { useEffect, type RefObject } from 'react'

/**
 * Agrandissement du cadre (en pixels) pour un déplacement du doigt : il suit le doigt puis résiste, sans dépasser
 * `max` (la hauteur qui manque pour voir toute la photo).
 */
export function etirementPour(deplacement: number, max: number): number {
  if (deplacement <= 0 || max <= 0) return 0
  return max * (1 - Math.exp(-deplacement / max))
}

/**
 * Hauteur qui manque au cadre pour montrer la photo en entier, sur toute sa largeur (même proportions que l'image),
 * sans dépasser la place disponible à l'écran. Photo plus large que le cadre ou pas encore chargée : un petit
 * étirement élastique seulement.
 */
export function etirementMax(largeur: number, hauteurCadre: number, largeurImage: number, hauteurImage: number,
  hauteurEcran: number): number {
  const elastique = hauteurEcran * 0.12
  if (!largeurImage || !hauteurImage || largeur <= 0) return elastique
  const entiere = Math.min(largeur * (hauteurImage / largeurImage), hauteurEcran * 0.92)
  return Math.max(elastique, entiere - hauteurCadre)
}

/**
 * Pendant l'étirement, la photo est affichée « entière » (object-fit: contain) puis agrandie de ce facteur : au départ
 * (progression 0) elle remplit le cadre comme au repos, à la fin (progression 1) elle est entière, sans rien couper.
 */
export function zoomDevoilement(largeur: number, hauteur: number, largeurImage: number, hauteurImage: number,
  progression: number): number {
  if (!largeurImage || !hauteurImage || largeur <= 0 || hauteur <= 0) return 1
  const remplir = Math.max(largeur / largeurImage, hauteur / hauteurImage)
  const entiere = Math.min(largeur / largeurImage, hauteur / hauteurImage)
  const t = Math.min(1, Math.max(0, progression))
  return (remplir * (1 - t) + entiere * t) / entiere
}

/** Zoom à deux doigts : rapport des écarts, entre ×1 et ×3. */
export function zoomPincement(ecartDepart: number, ecart: number): number {
  if (ecartDepart <= 0) return 1
  return Math.min(3, Math.max(1, ecart / ecartDepart))
}

/**
 * Photo d'une fiche « étirable » : au repos, le cadre la recadre ; en haut de la fiche, tirer vers le bas agrandit
 * le cadre jusqu'à montrer la photo en entier, puis tout revient en place au relâchement. À deux doigts, la photo
 * se zoome directement.
 * `zone` est l'élément qui défile (la fiche), `photo` le cadre de la photo.
 */
export function usePhotoEtirable(zone: RefObject<HTMLElement | null>, photo: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const z = zone.current
    const p = photo.current
    if (!z || !p) return
    const reduit = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let departY: number | null = null
    let hauteur = 0
    let ecartDepart = 0
    let actif = false

    let max = 0
    let largeur = 0
    let image = { l: 0, h: 0 }
    const mesurer = () => {
      const cadre = p.getBoundingClientRect()
      hauteur = cadre.height
      largeur = cadre.width
      const img = p.querySelector('img')
      image = { l: img?.naturalWidth ?? 0, h: img?.naturalHeight ?? 0 }
      max = etirementMax(largeur, hauteur, image.l, image.h, window.innerHeight)
    }
    /** Étire le cadre et dévoile la photo : recadrée au départ, entière quand l'étirement est au maximum. */
    const devoiler = (deplacement: number) => {
      const etirement = etirementPour(deplacement, max)
      // Photo entière dès 90 % de l'étirement (le dernier dixième ne s'atteint qu'en tirant très loin).
      appliquer(etirement, zoomDevoilement(largeur, hauteur + etirement, image.l, image.h, max ? etirement / (max * 0.9) : 0))
    }
    const appliquer = (etirement: number, zoom: number) => {
      p.style.setProperty('--etirement', `${etirement}px`)
      p.style.setProperty('--zoom', String(zoom))
    }
    const relacher = () => {
      if (!actif) return
      actif = false
      departY = null
      ecartDepart = 0
      p.classList.remove('photo-etiree')
      p.classList.add('photo-retour')
      appliquer(0, 1)
      window.setTimeout(() => p.classList.remove('photo-retour'), reduit ? 0 : 320)
    }
    const ecart = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

    const debut = (e: TouchEvent) => {
      mesurer()
      if (e.touches.length === 2 && p.contains(e.target as Node)) {
        ecartDepart = ecart(e.touches)
        departY = null
      } else if (e.touches.length === 1 && z.scrollTop <= 0) {
        departY = e.touches[0].clientY
      }
    }
    const mouvement = (e: TouchEvent) => {
      if (ecartDepart && e.touches.length === 2) {
        e.preventDefault()
        actif = true
        p.classList.add('photo-etiree')
        appliquer(0, zoomPincement(ecartDepart, ecart(e.touches)))
        return
      }
      if (departY === null || e.touches.length !== 1) return
      const dy = e.touches[0].clientY - departY
      if (dy <= 0 || z.scrollTop > 0) {
        if (actif) relacher()
        return
      }
      e.preventDefault() // le geste dévoile la photo au lieu de faire défiler la page
      actif = true
      p.classList.add('photo-etiree')
      devoiler(dy)
    }

    // Souris (ordinateur, tablette avec pointeur) : glisser la photo vers le bas.
    let sourisY: number | null = null
    const sourisDebut = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || z.scrollTop > 0) return
      if ((e.target as HTMLElement).closest('button')) return
      sourisY = e.clientY
      mesurer()
      p.setPointerCapture?.(e.pointerId)
    }
    const sourisMouvement = (e: PointerEvent) => {
      if (sourisY === null) return
      const dy = e.clientY - sourisY
      if (dy <= 0) return
      actif = true
      p.classList.add('photo-etiree')
      devoiler(dy)
    }
    const sourisFin = () => {
      sourisY = null
      relacher()
    }

    z.addEventListener('touchstart', debut, { passive: true })
    z.addEventListener('touchmove', mouvement, { passive: false })
    z.addEventListener('touchend', relacher)
    z.addEventListener('touchcancel', relacher)
    p.addEventListener('pointerdown', sourisDebut)
    p.addEventListener('pointermove', sourisMouvement)
    p.addEventListener('pointerup', sourisFin)
    p.addEventListener('pointercancel', sourisFin)
    return () => {
      z.removeEventListener('touchstart', debut)
      z.removeEventListener('touchmove', mouvement)
      z.removeEventListener('touchend', relacher)
      z.removeEventListener('touchcancel', relacher)
      p.removeEventListener('pointerdown', sourisDebut)
      p.removeEventListener('pointermove', sourisMouvement)
      p.removeEventListener('pointerup', sourisFin)
      p.removeEventListener('pointercancel', sourisFin)
    }
  }, [zone, photo])
}
