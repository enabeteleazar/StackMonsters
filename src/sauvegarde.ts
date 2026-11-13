import type { Canette } from './types'

/** Fiche complète de la sauvegarde JSON ; la photo est lue à part, car la liste ne la transporte plus. */
export const ficheSauvegarde = (c: Canette, photo: string | null) => ({
  ean: c.ean,
  nom: c.nom,
  volume: c.volume,
  categorie: c.categorie,
  flavor: c.flavor,
  status: c.status,
  region: c.region,
  etat: c.etat,
  nb: c.nb,
  notes: c.notes,
  photo,
  ajout: c.ajout,
})
