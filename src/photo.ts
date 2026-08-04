import { PHOTO_MAX } from './config'

/** Réduit une photo prise au téléphone à ~40 ko avant de l'envoyer au service. */
export function reduirePhoto(fichier: File): Promise<string> {
  return new Promise((resoudre, rejeter) => {
    const url = URL.createObjectURL(fichier)
    const img = new Image()
    img.onload = () => {
      const r = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height))
      const cv = document.createElement('canvas')
      cv.width = Math.round(img.width * r)
      cv.height = Math.round(img.height * r)
      cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height)
      URL.revokeObjectURL(url)
      resoudre(cv.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      rejeter(new Error('Image illisible'))
    }
    img.src = url
  })
}
