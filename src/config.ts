// Une seule source d'adresse pour tout le front.
// Chemin RELATIF volontairement : le bundle ne doit jamais contenir
// de port ni de nom d'hôte, sinon il casse dès qu'on change d'accès.
export const API_URL = '/monsters/api'

// Nombre de lectures identiques d'affilée exigées avant de valider un code.
export const LECTURES_CONFIRMATION = 2

// Taille maximale d'une photo enregistrée, en pixels sur le grand côté.
export const PHOTO_MAX = 640
