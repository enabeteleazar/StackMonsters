export type Canette = {
  ean: string
  nom: string
  edition: string
  volume: string
  etat: string
  nb: number
  notes: string
  photo: string | null
  ajout: string
}

export const CANETTE_VIDE = (ean: string): Canette => ({
  ean,
  nom: '',
  edition: '',
  volume: '',
  etat: 'Vide',
  nb: 1,
  notes: '',
  photo: null,
  ajout: new Date().toISOString(),
})

export const ETATS = ['Pleine', 'Vide', 'Ouverte proprement', 'Cabossée'] as const
